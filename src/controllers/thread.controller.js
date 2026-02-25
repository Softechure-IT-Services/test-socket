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

    const messages = thread?.messages ?? [];

    // ── Collect every user ID referenced in any reaction across all replies ──
    // One batch query instead of N+1 lookups per message.
    const reactionUserIds = new Set();
    for (const m of messages) {
      let rxList = [];
      try { rxList = JSON.parse(m.reactions || "[]"); } catch {}
      for (const rx of rxList) {
        for (const uid of (rx.users ?? [])) {
          const n = Number(uid);
          if (!isNaN(n)) reactionUserIds.add(n);
        }
      }
    }

    const reactionUsers = reactionUserIds.size > 0
      ? await prisma.users.findMany({
          where: { id: { in: [...reactionUserIds] } },
          select: { id: true, name: true },
        })
      : [];
    const reactionUserMap = Object.fromEntries(reactionUsers.map((u) => [u.id, u.name]));

    const replies = messages.map((m) => {
      let files = [];
      try { files = JSON.parse(m.files || "[]"); } catch { files = []; }

      let reactions = [];
      try {
        reactions = JSON.parse(m.reactions || "[]").map((rx) => ({
          emoji: rx.emoji,
          count: rx.count,
          // Hydrate bare ID strings → { id, name } objects
          users: (rx.users ?? []).map((uid) => ({
            id: Number(uid),
            name: reactionUserMap[Number(uid)] ?? "Unknown",
          })),
        }));
      } catch { reactions = []; }

      return {
        id: m.id,
        content: m.content,
        created_at: m.created_at,
        updated_at: m.updated_at,
        sender_id: m.sender_id,
        sender_name: m.users?.name ?? "Unknown",
        avatar_url: m.users?.avatar_url ?? null,
        files,
        reactions,
        pinned: m.pinned ?? false,
      };
    });

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
 * Adds a reply. Creates thread row if needed. Emits socket events.
 *
 * Socket events emitted:
 *   - "threadReplyAdded"      to channel_<id> room (active viewers update badge + panel)
 *   - "newThreadNotification" to each member's user_<id> room (sidebar badge + push notification)
 */
export const addThreadReply = async (req, res) => {
  const messageId = Number(req.params.messageId);
  const sender_id = req.user.id;
  const { content, files } = req.body;

  if (!messageId) return res.status(400).json({ error: "Invalid message ID" });
  if (!content?.trim() && (!files || !files.length)) return res.status(400).json({ error: "Content required" });

  try {
    const parentMessage = await prisma.messages.findUnique({
      where: { id: messageId },
      select: { id: true, channel_id: true },
    });

    if (!parentMessage) {
      return res.status(404).json({ error: "Parent message not found" });
    }

    const channel_id = parentMessage.channel_id;

    const channel = channel_id
      ? await prisma.channels.findUnique({
          where: { id: channel_id },
          select: { id: true, name: true, is_dm: true, is_private: true },
        })
      : null;

    let thread = await prisma.threads.findFirst({
      where: { parent_message_id: messageId, channel_id: channel_id },
    });

    if (!thread) {
      thread = await prisma.threads.create({
        data: { parent_message_id: messageId, channel_id: channel_id },
      });
    }

    const reply = await prisma.messages.create({
      data: {
        content: content ?? "",
        sender_id,
        thread_parent_id: thread.id,
        files: JSON.stringify(files ?? []),
      },
      include: {
        users: { select: { id: true, name: true, avatar_url: true } },
      },
    });

    let parsedFiles = [];
    try { parsedFiles = JSON.parse(reply.files || "[]"); } catch { parsedFiles = []; }

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
      files: parsedFiles,
      thread_id: thread.id,
      parent_message_id: messageId,
      channel_id,
      reply_count: replyCount,
    };

    if (channel_id) {
      io.to(`channel_${channel_id}`).emit("threadReplyAdded", payload);
    }

    if (channel_id) {
      await _notifyThreadMembers(io, channel_id, channel, payload);
    }

    res.json(payload);
  } catch (err) {
    console.error("Create reply error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};

/**
 * GET /threads
 * Returns threads visible to the logged-in user:
 *
 *   • ALL threads from PUBLIC, non-DM channels (anyone can read them)
 *   • Threads from PRIVATE channels only if the user is a member
 *   • Threads from DM channels only if the user is a member
 *
 * Each thread includes: channel metadata (name, is_dm, is_private),
 * the parent message with sender info, and all replies.
 */
export const getAllThreads = async (req, res) => {
  const userId = req.user.id;

  try {
    // Channel IDs the user explicitly belongs to (private channels + DMs)
    const memberships = await prisma.channel_members.findMany({
      where: { user_id: userId },
      select: { channel_id: true },
    });
    const memberChannelIds = memberships.map((m) => m.channel_id);

    // Threads from public non-DM channels are always included.
    // Threads from private/DM channels are only included if the user is a member.
    const threads = await prisma.threads.findMany({
      where: {
        OR: [
          // Public channels (not DMs) — visible to all users
          { channels: { is_private: false, is_dm: false } },
          // Private channels / DMs — only for members
          { channel_id: { in: memberChannelIds } },
        ],
      },
      include: {
        channels: {
          select: { id: true, name: true, is_dm: true, is_private: true },
        },
        messages: {
          orderBy: { created_at: "asc" },
          include: {
            users: { select: { id: true, name: true, avatar_url: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    // Hydrate parent messages so the UI can show context for each thread
    const parentMessageIds = threads.map((t) => t.parent_message_id);
    const parentMessages = await prisma.messages.findMany({
      where: { id: { in: parentMessageIds } },
      select: {
        id: true,
        content: true,
        sender_id: true,
        created_at: true,
        users: { select: { id: true, name: true, avatar_url: true } },
      },
    });
    const parentMap = Object.fromEntries(parentMessages.map((m) => [m.id, m]));

    // ── Collect ALL reaction user IDs across every reply in every thread ───────
    // Single batch lookup so we never do N+1 queries for user names.
    const reactionUserIds = new Set();
    for (const thread of threads) {
      for (const m of thread.messages) {
        let rxList = [];
        try { rxList = JSON.parse(m.reactions || "[]"); } catch {}
        for (const rx of rxList) {
          for (const uid of (rx.users ?? [])) {
            const n = Number(uid);
            if (!isNaN(n)) reactionUserIds.add(n);
          }
        }
      }
    }

    const reactionUsers = reactionUserIds.size > 0
      ? await prisma.users.findMany({
          where: { id: { in: [...reactionUserIds] } },
          select: { id: true, name: true },
        })
      : [];
    const reactionUserMap = Object.fromEntries(reactionUsers.map((u) => [u.id, u.name]));

    // ── Helper: parse raw reactions string + hydrate bare IDs → { id, name } ──
    function hydrateReactions(raw) {
      let reactions = [];
      try { reactions = JSON.parse(raw || "[]"); } catch { return []; }
      return reactions.map((rx) => ({
        emoji: rx.emoji,
        count: rx.count,
        users: (rx.users ?? []).map((uid) => ({
          id: Number(uid),
          name: reactionUserMap[Number(uid)] ?? "Unknown",
        })),
      }));
    }

    const formatted = threads.map((thread) => {
      const parent = parentMap[thread.parent_message_id];
      const ch = thread.channels;

      return {
        thread_id: thread.id,
        channel_id: thread.channel_id,
        channel_name: ch?.name ?? null,
        is_dm: ch?.is_dm ?? false,
        is_private: ch?.is_private ?? false,
        parent_message: parent
          ? {
              id: parent.id,
              content: parent.content,
              sender_name: parent.users?.name ?? "Unknown",
              avatar_url: parent.users?.avatar_url ?? null,
              created_at: parent.created_at,
            }
          : null,
        replies: thread.messages.map((m) => {
          let files = [];
          try { files = JSON.parse(m.files || "[]"); } catch {}

          return {
            id: m.id,
            content: m.content,
            created_at: m.created_at,
            updated_at: m.updated_at,
            sender_id: m.sender_id,
            sender_name: m.users?.name ?? "Unknown",
            avatar_url: m.users?.avatar_url ?? null,
            files,
            reactions: hydrateReactions(m.reactions),
            pinned: m.pinned ?? false,
          };
        }),
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Fetch all threads error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};

// Fan out a new-thread-reply notification to every channel member via their
// personal user_<id> rooms. Skips the sender (they already know).
async function _notifyThreadMembers(io, channel_id, channel, payload) {
  try {
    const members = await prisma.channel_members.findMany({
      where: { channel_id },
      select: { user_id: true },
    });

    const channelLabel = channel?.is_dm ? null : (channel?.name ?? null);
    const preview = _stripHtml(payload.content ?? "").slice(0, 100);

    for (const member of members) {
      if (String(member.user_id) === String(payload.sender_id)) continue;

      io.to(`user_${member.user_id}`).emit("newThreadNotification", {
        channel_id,
        channel_name: channelLabel,
        is_dm: channel?.is_dm ?? false,
        is_private: channel?.is_private ?? false,
        parent_message_id: payload.parent_message_id,
        thread_id: payload.thread_id,
        reply_id: payload.id,
        sender_id: payload.sender_id,
        sender_name: payload.sender_name,
        avatar_url: payload.avatar_url,
        preview,
        created_at: payload.created_at,
      });
    }
  } catch (err) {
    console.error("_notifyThreadMembers error:", err);
  }
}

function _stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}