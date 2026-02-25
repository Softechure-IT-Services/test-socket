// channel.js

import express from "express";
const router = express.Router();
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";
import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";
import {
  getChannelFiles,
  getChannelPinnedMessages,
  createOrCheckChannel,
} from "../controllers/channel.controller.js";
import path from "path";
import fs from "fs";

router.use(verifyToken);

router.get("/search-user-and-channel", async (req, res) => {
  try {
    const userId = req.user.id;

    const rawQuery = req.query.q;
    const query = typeof rawQuery === "string" ? rawQuery.toLowerCase() : "";

    if (!query) return res.json([]);

    const channels = await prisma.channels.findMany({
      where: {
        OR: [
          { is_private: false },
          {
            channel_members: {
              some: { user_id: userId },
            },
          },
        ],
      },
      include: {
        channel_members: {
          include: {
            users: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const results = [];

    for (const channel of channels) {
      if (channel.is_dm) {
        const otherMember = channel.channel_members.find(
          (m) => m.user_id !== userId
        );

        const otherName = otherMember?.users?.name;

        if (!otherName) continue;

        if (otherName.toLowerCase().includes(query)) {
          results.push({
            id: channel.id,
            name: otherName,
            kind: "dm",
          });
        }

        continue;
      }

      if (channel.name?.toLowerCase().includes(query)) {
        results.push({
          id: channel.id,
          name: channel.name,
          kind: "channel",
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error("SEARCH ERROR FULL:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const getDms = req.query.get_dms !== "false";

    const channels = await prisma.channels.findMany({
      where: {
        AND: [
          getDms ? {} : { is_dm: false },
          {
            OR: [
              { is_private: false },
              {
                channel_members: {
                  some: { user_id: userId },
                },
              },
            ],
          },
        ],
      },
      orderBy: {
        created_at: "desc",
      },
    });

    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.get("/:channelId/messages", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const limit = Number(req.query.limit) || 20;
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const userId = req.user.id;

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_private) {
      const isMember = await prisma.channel_members.findUnique({
        where: {
          channel_id_user_id: {
            channel_id: channelId,
            user_id: userId,
          },
        },
      });

      if (!isMember) {
        return res
          .status(403)
          .json({ error: "You are not a member of this channel" });
      }
    }

    const messages = await prisma.messages.findMany({
      where: {
        channel_id: channelId,
        ...(cursor && { id: { lt: cursor } }),
      },
      include: {
        users: {
          select: {
            name: true,
            avatar_url: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
      take: limit,
    });

    // Batch-fetch thread counts for all fetched messages in one query
    const messageIds = messages.map((m) => m.id);
    const threads = await prisma.threads.findMany({
      where: { parent_message_id: { in: messageIds } },
      select: {
        parent_message_id: true,
        _count: { select: { messages: true } },
      },
    });
    const threadCountMap = new Map(
      threads.map((t) => [t.parent_message_id, t._count.messages])
    );

    // ── Parse & hydrate reactions ────────────────────────────────────────────
    // The DB stores reactions as a JSON string with bare user IDs in the users
    // array: [{ emoji, count, users: ["5", "12"] }].
    // We need to hydrate those IDs into { id, name } objects — the same shape
    // the socket path produces — so the tooltip always shows real names.
    const allRawReactions = messages.map((m) => {
      try { return JSON.parse(m.reactions || "[]"); } catch { return []; }
    });

    // Collect every unique user ID referenced in any reaction across all messages
    const reactionUserIds = new Set();
    for (const rxList of allRawReactions) {
      for (const rx of rxList) {
        for (const uid of (rx.users ?? [])) {
          const n = Number(uid);
          if (!isNaN(n)) reactionUserIds.add(n);
        }
      }
    }

    // Single batch lookup for all reaction users
    const reactionUsers = reactionUserIds.size > 0
      ? await prisma.users.findMany({
          where: { id: { in: [...reactionUserIds] } },
          select: { id: true, name: true },
        })
      : [];
    const reactionUserMap = Object.fromEntries(reactionUsers.map((u) => [u.id, u.name]));

    // Build hydrated reactions arrays indexed by message position
    const hydratedReactionsById = new Map();
    messages.forEach((m, i) => {
      const hydrated = allRawReactions[i].map((rx) => ({
        emoji: rx.emoji,
        count: rx.count,
        users: (rx.users ?? []).map((uid) => ({
          id: Number(uid),
          name: reactionUserMap[Number(uid)] ?? "Unknown",
        })),
      }));
      hydratedReactionsById.set(m.id, hydrated);
    });

    const formatted = messages
      .map((m) => {
        let forwardedFrom = null;
        if (m.forwarded_from) {
          try {
            forwardedFrom = JSON.parse(m.forwarded_from);
          } catch {
            forwardedFrom = {
              id: null,
              name: m.forwarded_from,
              channel_id: null,
              channel_name: null,
              channel_is_dm: false,
            };
          }
        }

        let files = [];
        try { files = JSON.parse(m.files || "[]"); } catch { files = []; }

        return {
          id: m.id,
          channel_id: m.channel_id,
          sender_id: m.sender_id,
          content: m.content,
          files,
          reactions: hydratedReactionsById.get(m.id) ?? [],
          pinned: m.pinned,
          created_at: m.created_at,
          updated_at: m.updated_at,
          sender_name: m.users?.name ?? null,
          avatar_url: m.users?.avatar_url ?? null,
          is_forwarded: m.is_forwarded ?? false,
          forwarded_from: forwardedFrom,
          is_system: m.is_system ?? false,
          thread_count: threadCountMap.get(m.id) ?? 0,
        };
      })
      .reverse();

    const nextCursor =
      messages.length === limit ? messages[messages.length - 1].id : null;

    res.json({
      messages: formatted,
      nextCursor,
    });
  } catch (err) {
    console.error("Prisma messages error:", err);
    res.status(500).json({
      error: "DB Error",
      details: err.message,
    });
  }
});

router.get("/:channelId/members", async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);

    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        name: true,
        is_private: true,
      },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const members = await prisma.channel_members.findMany({
      where: { channel_id: channelId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
    });

    res.json({
      channel,
      members: members.map((m) => m.users),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

// ─── Add a member to a private channel (creator only) ─────────────────────────
router.post("/:channelId/members", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const requesterId = req.user.id;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true, created_by: true, name: true },
    });

    if (!channel)
      return res.status(404).json({ error: "Channel not found" });
    if (!channel.is_private)
      return res.status(400).json({ error: "Channel is not private" });
    if (String(channel.created_by) !== String(requesterId))
      return res
        .status(403)
        .json({ error: "Only the channel creator can add members" });

    await prisma.channel_members.upsert({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: Number(userId),
        },
      },
      update: {},
      create: { channel_id: channelId, user_id: Number(userId) },
    });

    const newMember = await prisma.users.findUnique({
      where: { id: Number(userId) },
      select: { id: true, name: true, email: true, avatar_url: true },
    });

    const requester = await prisma.users.findUnique({
      where: { id: requesterId },
      select: { name: true },
    });

    // Create a system message for the channel
    const systemMessage = await prisma.messages.create({
      data: {
        channel_id: channelId,
        sender_id: requesterId,
        content: `<em>${requester?.name ?? "Someone"} added ${newMember?.name ?? "a user"} to the channel</em>`,
        is_system: true,
      },
    });

    const systemPayload = {
      id: systemMessage.id,
      channel_id: channelId,
      sender_id: requesterId,
      sender_name: requester?.name ?? null,
      avatar_url: null,
      content: systemMessage.content,
      files: [],
      reactions: [],
      pinned: false,
      created_at: systemMessage.created_at,
      updated_at: systemMessage.updated_at,
      is_forwarded: false,
      forwarded_from: null,
      is_system: true,
    };

    // Emit system message to channel
    io.to(`channel_${channelId}`).emit("receiveMessage", systemPayload);

    // Notify everyone in the channel — member list should refresh
    io.to(`channel_${channelId}`).emit("memberAdded", {
      channelId,
      member: newMember,
    });

    // ─── Notify the added user: channel appears in their sidebar ────
    // Build the full channel object so their sidebar can add it
    const fullChannel = await prisma.channels.findUnique({
      where: { id: channelId },
    });

    io.to(`user_${userId}`).emit("addedToChannel", {
      channelId,
      channelName: channel.name,
      channel: fullChannel, // full channel data for sidebar
      member: newMember,
    });

    res.json({ success: true, member: newMember });
  } catch (err) {
    console.error("Add member error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// ─── Remove a member from a private channel (creator only) ────────────────────
router.delete("/:channelId/members/:targetUserId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const targetUserId = Number(req.params.targetUserId);
  const requesterId = req.user.id;

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true, created_by: true, name: true },
    });

    if (!channel)
      return res.status(404).json({ error: "Channel not found" });
    if (!channel.is_private)
      return res.status(400).json({ error: "Channel is not private" });
    if (String(channel.created_by) !== String(requesterId))
      return res
        .status(403)
        .json({ error: "Only the channel creator can remove members" });
    if (String(targetUserId) === String(requesterId))
      return res
        .status(400)
        .json({ error: "Use 'Leave Channel' to remove yourself" });

    const targetUser = await prisma.users.findUnique({
      where: { id: targetUserId },
      select: { name: true },
    });

    const requester = await prisma.users.findUnique({
      where: { id: requesterId },
      select: { name: true },
    });

    await prisma.channel_members.delete({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: targetUserId,
        },
      },
    });

    // Create a system message for the channel
    const systemMessage = await prisma.messages.create({
      data: {
        channel_id: channelId,
        sender_id: requesterId,
        content: `<em>${requester?.name ?? "Someone"} removed ${targetUser?.name ?? "a user"} from the channel</em>`,
        is_system: true,
      },
    });

    const systemPayload = {
      id: systemMessage.id,
      channel_id: channelId,
      sender_id: requesterId,
      sender_name: requester?.name ?? null,
      avatar_url: null,
      content: systemMessage.content,
      files: [],
      reactions: [],
      pinned: false,
      created_at: systemMessage.created_at,
      updated_at: systemMessage.updated_at,
      is_forwarded: false,
      forwarded_from: null,
      is_system: true,
    };

    // Emit system message to everyone still in the channel
    io.to(`channel_${channelId}`).emit("receiveMessage", systemPayload);

    // ─── Tell remaining members to update their member list ─────────
    io.to(`channel_${channelId}`).emit("memberRemoved", {
      channelId,
      userId: targetUserId,
      userName: targetUser?.name ?? null,
    });

    // ─── Tell the removed user: channel disappears from sidebar ─────
    io.to(`user_${targetUserId}`).emit("removedFromChannel", {
      channelId,
      channelName: channel.name,
    });

    // Force the removed user out of the socket room
    try {
      const removedUserSockets = await io
        .in(`user_${targetUserId}`)
        .fetchSockets();
      for (const s of removedUserSockets) {
        s.leave(`channel_${channelId}`);
      }
    } catch (socketErr) {
      console.error("Failed to remove user from socket room:", socketErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Remove member error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.post("/", createOrCheckChannel);

router.post("/:channelId/join", async (req, res) => {
  const userId = req.user.id;
  const channelId = Number(req.params.channelId);

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_private) {
      return res.status(403).json({ error: "Cannot join private channel" });
    }

    await prisma.channel_members.upsert({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
      update: {},
      create: {
        channel_id: channelId,
        user_id: userId,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Join failed" });
  }
});

router.get("/:id", async (req, res) => {
  const channelId = Number(req.params.id);
  const userId = req.user.id;

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
    });
    if (!channel) return res.status(404).json({ error: "Not found" });

    if (channel.is_private) {
      const isMember = await prisma.channel_members.findUnique({
        where: {
          channel_id_user_id: {
            channel_id: channelId,
            user_id: userId,
          },
        },
      });

      if (!isMember) {
        if (channel.is_dm) {
          return res.status(403).json({ error: "Not a member" });
        }
        return res.json({
          channel,
          members: [],
          is_member: false,
        });
      }
    }

    if (channel.is_dm) {
      const dmUser = await prisma.channel_members.findFirst({
        where: {
          channel_id: channelId,
          user_id: { not: userId },
        },
        include: {
          users: { select: { id: true, name: true, avatar_url: true } },
        },
      });

      return res.json({
        channel,
        dm_user: dmUser?.users ?? null,
        is_member: true,
      });
    }

    const members = await prisma.channel_members.findMany({
      where: { channel_id: channelId },
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({
      channel,
      members: members.map((m) => m.users),
      is_member: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.post("/:channelId/pin/:messageId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const userId = req.user.id;

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_private) {
      const isMember = await prisma.channel_members.findUnique({
        where: {
          channel_id_user_id: {
            channel_id: channelId,
            user_id: userId,
          },
        },
      });

      if (!isMember) {
        return res.status(403).json({ error: "Not a channel member" });
      }
    }

    const message = await prisma.messages.findFirst({
      where: {
        id: messageId,
        channel_id: channelId,
      },
      select: { pinned: true },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.pinned) {
      return res.status(400).json({ error: "Message already pinned" });
    }

    await prisma.messages.update({
      where: { id: messageId },
      data: {
        pinned: "1",
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.get("/:channelId/files", getChannelFiles);
router.get("/:channelId/pinned", getChannelPinnedMessages);

router.delete("/:channelId/pin/:messageId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const userId = req.user.id;

  try {
    const message = await prisma.messages.findFirst({
      where: {
        id: messageId,
        channel_id: channelId,
      },
      include: {
        channels: {
          select: { created_by: true },
        },
      },
    });

    if (!message || !message.pinned) {
      return res
        .status(404)
        .json({ error: "Message not pinned or not found" });
    }

    if (
      String(message.pinned_by) !== String(userId) &&
      String(message.channels.created_by) !== String(userId)
    ) {
      return res.status(403).json({ error: "Not allowed to unpin" });
    }

    await prisma.messages.update({
      where: { id: messageId },
      data: {
        pinned: null,
        pinned_by: null,
        pinned_at: null,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.get("/:channelId/pins", (req, res) => {
  const { channelId } = req.params;

  const sql = `
    SELECT
      m.id,
      m.content,
      m.sender_id,
      u.name AS sender_name,
      u.avatar_url,
      m.pinned_by,
      p.name AS pinner_name,
      m.pinned_at
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN users p ON p.id = m.pinned_by
    WHERE m.channel_id = ? AND m.pinned = 1
    ORDER BY m.pinned_at DESC
  `;
  db.query(sql, [channelId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

router.post("/:channelId/leave", async (req, res) => {
  try {
    const userId = req.user.id;
    const channelId = Number(req.params.channelId);

    if (!channelId) {
      return res.status(400).json({ error: "Invalid channel id" });
    }

    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { id: true, is_private: true, is_dm: true, name: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_dm) {
      return res.status(400).json({ error: "Cannot leave DM channel" });
    }

    const membership = await prisma.channel_members.findUnique({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
    });

    if (!membership) {
      return res
        .status(400)
        .json({ error: "You are not a member of this channel" });
    }

    const leavingUser = await prisma.users.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await prisma.channel_members.delete({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
    });

    // Create system message
    const systemMessage = await prisma.messages.create({
      data: {
        channel_id: channelId,
        sender_id: userId,
        content: `<em>${leavingUser?.name ?? "A user"} left the channel</em>`,
        is_system: true,
      },
    });

    const systemPayload = {
      id: systemMessage.id,
      channel_id: channelId,
      sender_id: userId,
      sender_name: leavingUser?.name ?? null,
      avatar_url: null,
      content: systemMessage.content,
      files: [],
      reactions: [],
      pinned: false,
      created_at: systemMessage.created_at,
      updated_at: systemMessage.updated_at,
      is_forwarded: false,
      forwarded_from: null,
      is_system: true,
    };

    io.to(`channel_${channelId}`).emit("receiveMessage", systemPayload);

    // Tell remaining members to update their member list
    io.to(`channel_${channelId}`).emit("memberRemoved", {
      channelId,
      userId,
      userName: leavingUser?.name ?? null,
    });

    if (channel.is_private) {
      const remaining = await prisma.channel_members.count({
        where: { channel_id: channelId },
      });

      if (remaining === 0) {
        await prisma.channels.delete({ where: { id: channelId } });
      }
    }

    io.to(`channel_${channelId}`).emit("userLeftChannel", {
      channelId,
      userId,
    });

    // Force user out of socket room
    try {
      const userSockets = await io.in(`user_${userId}`).fetchSockets();
      for (const s of userSockets) {
        s.leave(`channel_${channelId}`);
      }
    } catch (socketErr) {
      console.error("Failed to remove user from socket room:", socketErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Leave channel error:", err);
    res.status(500).json({ error: "Failed to leave channel" });
  }
});

router.get("/files/:fileId/download", async (req, res) => {
  const fileId = Number(req.params.fileId);
  const userId = req.user.id;

  try {
    const file = await prisma.files.findUnique({
      where: { id: fileId },
      select: {
        path: true,
        channel_id: true,
        name: true,
      },
    });

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    const isMember = await prisma.channel_members.findFirst({
      where: {
        channel_id: file.channel_id,
        user_id: userId,
      },
    });

    if (!isMember) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const filePath = path.resolve("uploads", file.path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File missing on server" });
    }

    return res.download(filePath, file.name);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.post(
  "/messages/:messageId/forward/:targetChannelId",
  async (req, res) => {
    const messageId = Number(req.params.messageId);
    const targetChannelId = Number(req.params.targetChannelId);
    const userId = req.user.id;

    try {
      const original = await prisma.messages.findUnique({
        where: { id: messageId },
        select: {
          content: true,
          files: true,
          channel_id: true,
          sender_id: true,
          is_forwarded: true,
          forwarded_from: true,
          users: { select: { name: true } },
        },
      });

      if (!original) {
        return res.status(404).json({ error: "Message not found" });
      }

      let forwardedFromObj;
      if (original.is_forwarded && original.forwarded_from) {
        try {
          forwardedFromObj = JSON.parse(original.forwarded_from);
        } catch {
          forwardedFromObj = {
            id: String(original.sender_id),
            name: original.forwarded_from,
            channel_id: original.channel_id,
            channel_name: null,
            channel_is_dm: false,
          };
        }
      } else {
        let channelName = null;
        let isDm = false;

        if (original.channel_id) {
          const sourceChannel = await prisma.channels.findUnique({
            where: { id: original.channel_id },
            select: {
              name: true,
              is_dm: true,
              channel_members: {
                select: {
                  users: { select: { name: true, id: true } },
                },
              },
            },
          });

          isDm = sourceChannel?.is_dm ?? false;

          if (isDm) {
            const otherMember = sourceChannel?.channel_members?.find(
              (m) => String(m.users?.id) !== String(original.sender_id)
            );
            channelName = otherMember?.users?.name ?? null;
          } else {
            channelName = sourceChannel?.name ?? null;
          }
        }

        forwardedFromObj = {
          id: String(original.sender_id),
          name: original.users?.name ?? null,
          channel_id: original.channel_id,
          channel_name: channelName,
          channel_is_dm: isDm,
        };
      }

      const forwardedFromJson = JSON.stringify(forwardedFromObj);

      const newMessage = await prisma.messages.create({
        data: {
          channel_id: targetChannelId,
          sender_id: userId,
          content: original.content ?? null,
          files: original.files ?? null,
          is_forwarded: true,
          forwarded_from: forwardedFromJson,
        },
        include: {
          users: { select: { name: true, avatar_url: true } },
        },
      });

      const payload = {
        id: newMessage.id,
        channel_id: newMessage.channel_id,
        sender_id: newMessage.sender_id,
        sender_name: newMessage.users?.name ?? null,
        avatar_url: newMessage.users?.avatar_url ?? null,
        content: newMessage.content,
        files: newMessage.files ? JSON.parse(newMessage.files) : [],
        reactions: [],
        pinned: false,
        created_at: newMessage.created_at,
        updated_at: newMessage.updated_at,
        is_forwarded: true,
        forwarded_from: forwardedFromObj,
      };

      io.to(`channel_${targetChannelId}`).emit("receiveMessage", payload);

      res.json({ success: true, message: payload });
    } catch (err) {
      console.error("Forward error:", err);
      res.status(500).json({ error: "Forward failed" });
    }
  }
);

export default router;