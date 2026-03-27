import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";

export const getChannelFiles = async (req, res) => {
  const { channelId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;

  try {
    const messages = await prisma.messages.findMany({
      where: {
        channel_id: Number(channelId),
        files: { not: null },
      },
      orderBy: { created_at: "desc" },
      include: {
        users: { select: { id: true, name: true, username: true, avatar_url: true } }
      }
    });

    const allFiles = messages.flatMap((m) => {
      try {
        let parsedFiles = [];
        if (typeof m.files === 'string') {
          // ignore empty or '[]'
          if (!m.files.trim() || m.files === '[]') return [];
          parsedFiles = JSON.parse(m.files);
        } else if (Array.isArray(m.files)) {
          parsedFiles = m.files;
        }

        return parsedFiles.map(f => ({
          message_id: m.id,
          file: f.url || f.file || "",
          url: f.url || f.file || "",
          created_at: m.created_at,
          sender: {
            id: m.users?.id,
            name: m.users?.username || m.users?.name || "Unknown",
            avatar_url: m.users?.avatar_url || null,
          },
          name: f.name || "unnamed file",
          type: f.type || "",
          size: f.size || 0
        }));
      } catch {
        return [];
      }
    });

    const startIndex = (page - 1) * limit;
    const paginatedFiles = allFiles.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: {
        files: paginatedFiles
      }
    });
  } catch (err) {
    console.error("getChannelFiles error:", err);
    res.status(500).json({ error: "Failed to fetch files" });
  }
};

export const getChannelPinnedMessages = async (req, res) => {
  const { channelId } = req.params;
  try {
    const pins = await prisma.messages.findMany({
      where: {
        channel_id: Number(channelId),
        pinned: true,
      },
      include: {
        users: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar_url: true,
          },
        },
        // Include the thread relation so we can expose both the
        // thread id and the parent message id for pinned replies.
        thread: {
          select: {
            id: true,
            parent_message_id: true,
          },
        },
      },
      orderBy: { updated_at: "desc" },
    });

    const formatted = pins.map((p) => ({
      message_id: p.id,
      content: p.content,
      pinned: true,
      created_at: p.created_at,
      updated_at: p.updated_at,
      sender: {
        id: p.users.id,
        name: p.users.username || p.users.name,
        avatar_url: p.users.avatar_url,
      },
      files: p.files ? JSON.parse(p.files) : [],
      // Thread metadata so the client can:
      // - open the thread panel when a pinned reply is clicked
      // - scroll the thread panel directly to the reply.
      is_thread_reply: !!p.thread_parent_id,
      thread_parent_id: p.thread_parent_id,
      thread_parent_message_id: p.thread?.parent_message_id ?? null,
      parent_message_id: p.thread?.parent_message_id ?? null,
      thread_id: p.thread?.id ?? null,
    }));

    res.json({
      success: true,
      data: {
        pinned_messages: formatted,
      },
    });
  } catch (err) {
    console.error("getChannelPinnedMessages error:", err);
    res.status(500).json({ error: "Failed to fetch pins" });
  }
};

export const createOrCheckChannel = async (req, res) => {
  const { name, is_private, isPrivate, description, create, memberIds } = req.body;
  const userId = req.user.id;

  const actualIsPrivate = isPrivate !== undefined ? isPrivate : is_private;

  if (create === false) {
    if (!name) return res.json({ data: { available: false } });
    try {
      const existing = await prisma.channels.findUnique({
        where: { name },
      });
      return res.json({ data: { available: !existing } });
    } catch (err) {
      return res.status(500).json({ error: "Failed to check name" });
    }
  }

  try {
    const additionalMembers = (memberIds || [])
      .filter((id) => Number(id) !== Number(userId))
      .map((id) => ({ user_id: Number(id) }));

    const channel = await prisma.channels.create({
      data: {
        name,
        is_private: !!actualIsPrivate,
        description,
        created_by: userId,
        channel_members: {
          create: [{ user_id: userId }, ...additionalMembers],
        },
      },
    });

    if (io) {
      const channelPayload = { id: channel.id, name: channel.name, is_private: channel.is_private, is_dm: false };
      
      // Only broadcast to everyone if the channel is PUBLIC
      if (!channel.is_private) {
        io.emit("channelCreated", channelPayload);
      }
      
      // Notify the creator (always)
      io.to(`user_${userId}`).emit("addedToChannel", { channelId: channel.id, channel: channelPayload });
      
      // Notify newly batched members
      additionalMembers.forEach(({ user_id }) => {
        io.to(`user_${user_id}`).emit("addedToChannel", {
          channelId: channel.id,
          channelName: channel.name,
          channel: channelPayload
        });
      });
    }

    res.status(201).json({ data: channel });
  } catch (err) {
    console.error("createChannel error:", err);
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Channel name already exists" });
    }
    res.status(500).json({ error: "Failed to create channel" });
  }
};
