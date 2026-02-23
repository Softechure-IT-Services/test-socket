import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";

/**
 * GET /threads/:messageId
 * Returns all replies for a parent message, with sender user info.
 */
export const getThreadReplies = async (req, res) => {
  const messageId = Number(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: "Invalid message ID" });

  try {
    const thread = await prisma.threads.findFirst({
      where: { parent_message_id: messageId },
      include: {
        messages: {
          orderBy: { created_at: "asc" },
          include: {
            users: {
              select: { id: true, name: true, avatar_url: true },
            },
          },
        },
      },
    });

    const replies = (thread?.messages ?? []).map((m) => ({
      id: m.id,
      content: m.content,
      created_at: m.created_at,
      updated_at: m.updated_at,
      sender_id: m.sender_id,
      sender_name: m.users?.name ?? "Unknown",
      avatar_url: m.users?.avatar_url ?? null,
    }));

    res.json({ thread_id: thread?.id ?? null, replies });
  } catch (err) {
    console.error("Fetch thread error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};

/**
 * GET /threads/:messageId/count
 * Returns the reply count for a parent message (for the thread badge).
 */
export const getThreadCount = async (req, res) => {
  const messageId = Number(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: "Invalid message ID" });

  try {
    const thread = await prisma.threads.findFirst({
      where: { parent_message_id: messageId },
      include: { _count: { select: { messages: true } } },
    });

    res.json({ count: thread?._count?.messages ?? 0 });
  } catch (err) {
    res.status(500).json({ error: "DB Error" });
  }
};

/**
 * POST /threads/:messageId
 * Adds a reply. Creates thread row if needed. Emits socket event.
 */
export const addThreadReply = async (req, res) => {
  const messageId = Number(req.params.messageId);
  const sender_id = req.user.id;
  const { content } = req.body;

  if (!messageId) return res.status(400).json({ error: "Invalid message ID" });
  if (!content?.trim()) return res.status(400).json({ error: "Content required" });

  try {
    // 1️⃣ Upsert thread
    let thread = await prisma.threads.findFirst({
      where: { parent_message_id: messageId },
    });

    if (!thread) {
      thread = await prisma.threads.create({
        data: { parent_message_id: messageId },
      });
    }

    // 2️⃣ Create reply
    const reply = await prisma.messages.create({
      data: { content, sender_id, thread_parent_id: thread.id },
      include: {
        users: { select: { id: true, name: true, avatar_url: true } },
      },
    });

    // 3️⃣ Count total replies for updated badge
    const replyCount = await prisma.messages.count({
      where: { thread_parent_id: thread.id },
    });

    const payload = {
      id: reply.id,
      content: reply.content,
      created_at: reply.created_at,
      updated_at: reply.updated_at,
      sender_id: reply.sender_id,
      sender_name: reply.users?.name ?? "Unknown",
      avatar_url: reply.users?.avatar_url ?? null,
      thread_id: thread.id,
      parent_message_id: messageId,
      reply_count: replyCount,
    };

    // 4️⃣ Emit to everyone watching this thread
    io.emit("threadReplyAdded", payload);

    res.json(payload);
  } catch (err) {
    console.error("Create reply error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};