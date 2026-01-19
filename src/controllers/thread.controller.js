import prisma from "../config/prisma.js";

/**
 * Get all replies (messages) for a parent message
 * GET /threads/:messageId
 */
export const getThreadReplies = async (req, res) => {
  const messageId = Number(req.params.messageId);

  if (!messageId) {
    return res.status(400).json({ error: "Invalid message ID" });
  }

  try {
    const thread = await prisma.threads.findFirst({
      where: {
        parent_message_id: messageId,
      },
      include: {
        messages: {
          orderBy: {
            created_at: "asc",
          },
        },
      },
    });

    res.json(thread?.messages || []);
  } catch (err) {
    console.error("Fetch thread error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};

/**
 * Add a reply to a message
 * POST /threads/:messageId
 */
export const addThreadReply = async (req, res) => {
  const messageId = Number(req.params.messageId);
  const sender_id = req.user.id; // trusted from token
  const { content } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: "Invalid message ID" });
  }

  if (!content || content.trim() === "") {
    return res.status(400).json({ error: "Content required" });
  }

  try {
    // 1️⃣ Ensure thread exists
    let thread = await prisma.threads.findFirst({
      where: {
        parent_message_id: messageId,
      },
    });

    if (!thread) {
      thread = await prisma.threads.create({
        data: {
          parent_message_id: messageId,
        },
      });
    }

    // 2️⃣ Create reply message
    const reply = await prisma.messages.create({
      data: {
        content,
        sender_id,
        thread_parent_id: thread.id,
      },
    });

    res.json(reply);
  } catch (err) {
    console.error("Create reply error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};
