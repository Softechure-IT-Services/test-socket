import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";
import { getPreviewText } from "../utils/format.js";

function normalizeStoredReactionUsers(rawUsers = []) {
  if (!Array.isArray(rawUsers)) return [];

  return rawUsers.map((rawUser) => {
    if (rawUser && typeof rawUser === "object") {
      const parsedId = Number(rawUser.id);
      return {
        id: Number.isFinite(parsedId) ? parsedId : null,
        name: rawUser.username ?? rawUser.name ?? null,
      };
    }

    const parsedId = Number(rawUser);
    return {
      id: Number.isFinite(parsedId) ? parsedId : null,
      name: null,
    };
  });
}

async function hydrateStoredReactions(rawReactions) {
  const parsedReactions = Array.isArray(rawReactions) ? rawReactions : [];
  const normalizedReactions = parsedReactions.map((reaction) => ({
    ...reaction,
    users: normalizeStoredReactionUsers(reaction.users),
  }));

  const reactionUserIds = [
    ...new Set(
      normalizedReactions
        .flatMap((reaction) => reaction.users ?? [])
        .map((user) => user.id)
        .filter((userId) => userId !== null)
    ),
  ];

  const reactionUsers = reactionUserIds.length
    ? await prisma.users.findMany({
        where: { id: { in: reactionUserIds } },
        select: { id: true, name: true, username: true },
      })
    : [];

  const reactionUserMap = Object.fromEntries(
    reactionUsers.map((user) => [user.id, user.username || user.name || "Unknown"])
  );

  return normalizedReactions.map((reaction, reactionIndex) => ({
    emoji: reaction.emoji,
    count: reaction.count,
    users: (reaction.users ?? []).map((user, userIndex) => ({
      id: user.id ?? `reaction-${reactionIndex}-${userIndex}`,
      name:
        user.name ||
        (user.id !== null ? reactionUserMap[user.id] : null) ||
        "Unknown",
    })),
  }));
}

export const getThreadReplies = async (req, res) => {
  const { messageId } = req.params;
  try {
    // Always return the parent message so the client can open the thread panel
    // even when replies aren't loaded in the channel yet.
    const parent = await prisma.messages.findUnique({
      where: { id: Number(messageId) },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar_url: true,
          },
        },
      },
    });

    const parentReactionsRaw =
      parent?.reactions
        ? typeof parent.reactions === "string"
          ? (() => {
              try {
                return JSON.parse(parent.reactions);
              } catch {
                return [];
              }
            })()
          : parent.reactions
        : [];

    const parent_message = parent
      ? {
          id: parent.id,
          sender_id: parent.sender_id,
          content: parent.content,
          created_at: parent.created_at,
          sender_name: parent.users?.username || parent.users?.name || "Unknown",
          avatar_url: parent.users?.avatar_url || null,
          files:
            parent.files
              ? typeof parent.files === "string"
                ? (() => {
                    try {
                      return JSON.parse(parent.files);
                    } catch {
                      return [];
                    }
                  })()
                : parent.files
              : [],
          reactions: await hydrateStoredReactions(parentReactionsRaw),
          pinned: parent.pinned ?? false,
          is_edited: parent.is_edited ?? false,
        }
      : null;

    const thread = await prisma.threads.findFirst({
      where: { parent_message_id: Number(messageId) },
      select: { id: true },
    });

    // If the thread row doesn't exist yet, treat as a thread with 0 replies.
    if (!thread) {
      return res.json({ success: true, parent_message, replies: [] });
    }

    const replies = await prisma.messages.findMany({
      where: { thread_parent_id: thread.id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    const mapped = await Promise.all(
      replies.map(async (r) => {
        const replyReactionsRaw =
          r.reactions
            ? typeof r.reactions === "string"
              ? (() => {
                  try {
                    return JSON.parse(r.reactions);
                  } catch {
                    return [];
                  }
                })()
              : r.reactions
            : [];

        return {
          ...r,
          sender_name: r.users?.username || r.users?.name || "Unknown",
          avatar_url: r.users?.avatar_url || null,
          reactions: await hydrateStoredReactions(replyReactionsRaw),
        };
      })
    );

    res.json({ success: true, parent_message, replies: mapped });
  } catch (err) {
    console.error("getThreadReplies error:", err);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
};

export const getThreadCount = async (req, res) => {
  const { messageId } = req.params;
  try {
    const thread = await prisma.threads.findFirst({
      where: { parent_message_id: Number(messageId) },
      select: {
        _count: { select: { messages: true } },
      },
    });

    res.json({ count: thread?._count.messages || 0 });
  } catch (err) {
    console.error("getThreadCount error:", err);
    res.status(500).json({ error: "Failed to fetch count" });
  }
};

export const addThreadReply = async (req, res) => {
  const { messageId } = req.params;
  const { content, files } = req.body;
  const userId = req.user.id;

  try {
    // 1. Ensure thread exists or create it
    const parentMsg = await prisma.messages.findUnique({
      where: { id: Number(messageId) },
      select: { channel_id: true },
    });

    if (!parentMsg) return res.status(404).json({ error: "Parent message not found" });

    let thread = await prisma.threads.findFirst({
      where: { parent_message_id: Number(messageId) },
    });

    if (!thread) {
      thread = await prisma.threads.create({
        data: {
          parent_message_id: Number(messageId),
          channel_id: parentMsg.channel_id,
        },
      });
    }

    // 2. Add reply
    const reply = await prisma.messages.create({
      data: {
        content,
        sender_id: userId,
        thread_parent_id: thread.id,
        channel_id: parentMsg.channel_id,
        files: files ? JSON.stringify(files) : null,
      },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar_url: true,
          },
        },
      },
    });

    const broadcastData = {
      ...reply,
      sender_name: reply.users?.username || reply.users?.name || "Unknown",
      avatar_url: reply.users?.avatar_url || null,
      parent_message_id: Number(messageId),
    };

    if (io) {
      io.to(`channel_${parentMsg.channel_id}`).emit("threadReplyAdded", broadcastData);
      
      const cm = await prisma.channel_members.findMany({ where: { channel_id: parentMsg.channel_id }, select: { user_id: true } });
      const chnl = await prisma.channels.findUnique({ where: { id: parentMsg.channel_id }, select: { name: true, is_dm: true } });
      cm.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit("newThreadNotification", {
          channel_id: parentMsg.channel_id,
          channel_name: chnl?.name,
          is_dm: chnl?.is_dm === true,
          parent_message_id: Number(messageId),
          sender_id: userId,
          sender_name: broadcastData.sender_name,
          avatar_url: broadcastData.avatar_url,
          preview: getPreviewText(content, files),
          created_at: new Date().toISOString()
        });
      });
    }

    res.status(201).json({ success: true, data: broadcastData });
  } catch (err) {
    console.error("addThreadReply error:", err);
    res.status(500).json({ error: "Failed to add reply" });
  }
};

export const getAllThreads = async (req, res) => {
  const userId = req.user.id;
  try {
    const threads = await prisma.threads.findMany({
      where: {
        channel: {
          OR: [
            { is_private: false },
            { channel_members: { some: { user_id: userId } } },
          ],
        },
      },
      include: {
        parent_message: {
          include: {
            users: { select: { id: true, name: true, username: true, avatar_url: true } },
          },
        },
        channel: {
          select: { id: true, name: true, is_dm: true, is_private: true },
        },
        messages: {
          include: {
            users: { select: { id: true, name: true, username: true, avatar_url: true } },
          },
          orderBy: { created_at: "asc" },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { created_at: "desc" },
    });

    const shaped = threads.map((t) => ({
      thread_id: t.id,
      channel_id: t.channel_id,
      channel_name: t.channel?.name ?? null,
      is_dm: t.channel?.is_dm ?? false,
      is_private: t.channel?.is_private ?? false,
      parent_message: t.parent_message
        ? {
            id: t.parent_message.id,
            sender_id: t.parent_message.sender_id,
            content: t.parent_message.content,
            created_at: t.parent_message.created_at,
            sender_name:
              t.parent_message.users?.username ||
              t.parent_message.users?.name ||
              "Unknown",
            avatar_url: t.parent_message.users?.avatar_url ?? null,
          }
        : null,
      replies: (t.messages ?? []).map((r) => ({
        id: r.id,
        content: r.content,
        created_at: r.created_at,
        updated_at: r.updated_at,
        sender_id: r.sender_id,
        sender_name: r.users?.username || r.users?.name || "Unknown",
        avatar_url: r.users?.avatar_url ?? null,
        pinned: r.pinned ?? false,
        files: r.files ? (typeof r.files === "string" ? JSON.parse(r.files) : r.files) : [],
        reactions: [],
      })),
    }));

    res.json(shaped);
  } catch (err) {
    console.error("getAllThreads error:", err);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
};
