import prisma from "../config/prisma.js";
import supabase from "../utils/supabase.js";

export default function registerMessageSockets(io, socket) {

  // ================= SEND =================
  socket.on("sendMessage", async ({ content, channel_id, files }) => {
    try {
      const userId = socket.user.id;

      // Check if the channel is private and user is still a member
      const channel = await prisma.channels.findUnique({
        where: { id: channel_id },
        select: { is_private: true, is_dm: true, name: true },
      });

      if (channel?.is_private) {
        const isMember = await prisma.channel_members.findUnique({
          where: {
            channel_id_user_id: {
              channel_id: channel_id,
              user_id: userId,
            },
          },
        });

        if (!isMember) {
          socket.emit("messageSendError", {
            channel_id: channel_id,
            error: "You are no longer a member of this channel",
          });
          return;
        }
      }

      if (!channel_id || (!content && (!files || !files.length))) return;

      const message = await prisma.messages.create({
        data: {
          channel_id,
          sender_id: userId,
          content,
          files: JSON.stringify(files || []),
        },
        include: {
          users: true,
        },
      });

      const payload = {
        id: message.id,
        channel_id: message.channel_id,
        content: message.content,
        files: JSON.parse(message.files || "[]"),
        sender_id: message.sender_id,
        sender_name: socket.user.name,
        avatar_url: socket.user.avatar_url,
        created_at: message.created_at,
        updated_at: message.updated_at,
        is_edited: false,
      };

      // Broadcast to everyone in the channel room (the active viewer)
      io.to(`channel_${channel_id}`).emit("receiveMessage", payload);

      // Also ACK to the sender
      socket.emit("messageAck", payload);

      // ── NEW: Notify ALL channel members via their personal user rooms ──────────
      // This ensures sidebar indicators work even when the user isn't in the
      // channel socket room (e.g. they navigated away and ChannelChat left the room).
      await _notifyChannelMembers(io, channel_id, payload, channel);

    } catch (err) {
      console.error("sendMessage error:", err);
    }
  });

  // ================= EDIT =================
  // Works for both channel messages (have channel_id on the row) and
  // thread replies (channel_id is null — resolved via the parent thread).
  socket.on("editMessage", async ({ messageId, content }) => {
    if (!messageId || !content) return;
    const msgId = Number(messageId);
    try {
      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { id: true, sender_id: true, channel_id: true, thread_parent_id: true },
      });

      if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

      // Resolve channel_id for thread replies
      let resolvedChannelId = msg.channel_id;
      let isThreadReply = false;

      if (!resolvedChannelId && msg.thread_parent_id) {
        const thread = await prisma.threads.findUnique({
          where: { id: msg.thread_parent_id },
          select: { channel_id: true },
        });
        resolvedChannelId = thread?.channel_id ?? null;
        isThreadReply = true;
      }

      if (!resolvedChannelId) return;

      const updated = await prisma.messages.update({
        where: { id: msgId },
        data: { content, is_edited: true },
      });

      io.to(`channel_${resolvedChannelId}`).emit("messageEdited", {
        id: msgId,
        content,
        channel_id: resolvedChannelId,
        updated_at: updated.updated_at,
        is_edited: true,
        is_thread_reply: isThreadReply,
        thread_parent_id: msg.thread_parent_id ?? null,
      });
    } catch (err) {
      console.error("editMessage error:", err);
    }
  });

  // ================= DELETE =================
  // Works for channel messages and thread replies (resolves channel_id via thread).
  socket.on("deleteMessage", async ({ id }) => {
    if (!id) return;

    const msgId = Number(id);
    if (isNaN(msgId)) return;

    try {
      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { id: true, sender_id: true, channel_id: true, thread_parent_id: true, files: true },
      });

      if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

      // Resolve channel_id for thread replies
      let resolvedChannelId = msg.channel_id;
      let isThreadReply = false;

      if (!resolvedChannelId && msg.thread_parent_id) {
        const thread = await prisma.threads.findUnique({
          where: { id: msg.thread_parent_id },
          select: { channel_id: true },
        });
        resolvedChannelId = thread?.channel_id ?? null;
        isThreadReply = true;
      }

      if (!resolvedChannelId) return;

      let files = [];
      try {
        files = JSON.parse(msg.files || "[]");
      } catch {
        files = [];
      }

      if (Array.isArray(files) && files.length) {
        const paths = files.map((f) => f.path).filter(Boolean);
        if (paths.length) {
          await supabase.storage.from("images").remove(paths);
        }
      }

      await prisma.messages.delete({ where: { id: msgId } });

      io.to(`channel_${resolvedChannelId}`).emit("messageDeleted", {
        id: msgId,
        is_thread_reply: isThreadReply,
        thread_parent_id: msg.thread_parent_id ?? null,
      });
    } catch (err) {
      console.error("deleteMessage error:", err);
    }
  });

  // ================= PIN/UNPIN =================
  // Resolves channel_id for thread replies the same way as edit/delete.
  async function _resolveChannelIdForMessage(msgId) {
    const msg = await prisma.messages.findUnique({
      where: { id: msgId },
      select: { channel_id: true, thread_parent_id: true },
    });
    if (!msg) return { resolvedChannelId: null, isThreadReply: false, thread_parent_id: null };

    let resolvedChannelId = msg.channel_id;
    let isThreadReply = false;

    if (!resolvedChannelId && msg.thread_parent_id) {
      const thread = await prisma.threads.findUnique({
        where: { id: msg.thread_parent_id },
        select: { channel_id: true },
      });
      resolvedChannelId = thread?.channel_id ?? null;
      isThreadReply = true;
    }
    return { resolvedChannelId, isThreadReply, thread_parent_id: msg.thread_parent_id ?? null };
  }

  socket.on("pinMessage", async ({ messageId }) => {
    if (!messageId) return;
    const msgId = Number(messageId);

    try {
      const { resolvedChannelId, isThreadReply, thread_parent_id } =
        await _resolveChannelIdForMessage(msgId);
      if (!resolvedChannelId) return;

      const updated = await prisma.messages.update({
        where: { id: msgId },
        data: { pinned: true },
      });

      io.to(`channel_${resolvedChannelId}`).emit("messagePinned", {
        messageId: msgId,
        pinned: updated.pinned,
        is_thread_reply: isThreadReply,
        thread_parent_id,
      });
    } catch (err) {
      console.error("pinMessage error:", err);
    }
  });

  socket.on("unpinMessage", async ({ messageId }) => {
    if (!messageId) return;
    const msgId = Number(messageId);

    try {
      const { resolvedChannelId, isThreadReply, thread_parent_id } =
        await _resolveChannelIdForMessage(msgId);
      if (!resolvedChannelId) return;

      await prisma.messages.update({
        where: { id: msgId },
        data: { pinned: false },
      });

      io.to(`channel_${resolvedChannelId}`).emit("messageUnpinned", {
        messageId: msgId,
        pinned: false,
        is_thread_reply: isThreadReply,
        thread_parent_id,
      });
    } catch (err) {
      console.error("unpinMessage error:", err);
    }
  });

  // ================= REACTIONS =================
  // socket.on("reactMessage", async ({ messageId, emoji }) => {
  //   try {
  //     if (!messageId || !emoji) return;

  //     const msgId = Number(messageId);

  //     const msg = await prisma.messages.findUnique({
  //       where: { id: msgId },
  //       select: {
  //         id: true,
  //         channel_id: true,
  //         thread_parent_id: true,   
  //         reactions: true,
  //       },
  //     });

  //     if (!msg) return;

  //     const channel_id = msg.channel_id;

  //     let reactions = [];
  //     try {
  //       reactions = JSON.parse(msg.reactions || "[]");
  //     } catch {
  //       reactions = [];
  //     }

  //     const userId = String(socket.user.id);

  //     let entry = reactions.find((r) => r.emoji === emoji);

  //     if (entry) {
  //       const users = Array.isArray(entry.users) ? entry.users : [];
  //       const hasReacted = users.includes(userId);

  //       if (hasReacted) {
  //         const newUsers = users.filter((u) => u !== userId);
  //         if (newUsers.length === 0) {
  //           reactions = reactions.filter((r) => r.emoji !== emoji);
  //         } else {
  //           entry.users = newUsers;
  //           entry.count = newUsers.length;
  //         }
  //       } else {
  //         const newUsers = [...users, userId];
  //         entry.users = newUsers;
  //         entry.count = newUsers.length;
  //       }
  //     } else {
  //       reactions.push({
  //         emoji,
  //         count: 1,
  //         users: [userId],
  //       });
  //     }

  //     await prisma.messages.update({
  //       where: { id: msgId },
  //       data: {
  //         reactions: JSON.stringify(reactions),
  //       },
  //     });

  //     const userIds = new Set();
  //     reactions.forEach((r) => r.users.forEach((u) => userIds.add(Number(u))));

  //     const users = await prisma.users.findMany({
  //       where: { id: { in: [...userIds] } },
  //       select: { id: true, name: true },
  //     });

  //     const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  //     const reactionsWithNames = reactions.map((r) => ({
  //       emoji: r.emoji,
  //       count: r.count,
  //       users: r.users.map((uid) => ({
  //         id: Number(uid),
  //         name: userMap[Number(uid)] || "Unknown",
  //       })),
  //     }));

  //     io.to(`channel_${channel_id}`).emit("reactionUpdated", {
  //       messageId: msgId,
  //       reactions: reactionsWithNames,
  //     });
  //   } catch (err) {
  //     console.error("reactMessage error:", err);
  //   }
  // });
socket.on("reactMessage", async ({ messageId, emoji }) => {
  try {
    if (!messageId || !emoji) return;

    const msgId = Number(messageId);

    const msg = await prisma.messages.findUnique({
      where: { id: msgId },
      select: {
        id: true,
        channel_id: true,
        thread_parent_id: true,
        reactions: true,
      },
    });

    if (!msg) return;

    // Resolve channel_id — thread reply messages have no channel_id of their
    // own, so walk up to the parent thread row to find it.
    let channel_id = msg.channel_id;

    if (!channel_id && msg.thread_parent_id) {
      const thread = await prisma.threads.findUnique({
        where: { id: msg.thread_parent_id },
        select: { channel_id: true },
      });
      channel_id = thread?.channel_id ?? null;
    }

    if (!channel_id) return;

    let reactions = [];
    try {
      reactions = JSON.parse(msg.reactions || "[]");
    } catch {
      reactions = [];
    }

    const userId = String(socket.user.id);
    let entry = reactions.find((r) => r.emoji === emoji);

    if (entry) {
      const users = Array.isArray(entry.users) ? entry.users : [];
      const hasReacted = users.includes(userId);

      if (hasReacted) {
        const newUsers = users.filter((u) => u !== userId);
        if (newUsers.length === 0) {
          reactions = reactions.filter((r) => r.emoji !== emoji);
        } else {
          entry.users = newUsers;
          entry.count = newUsers.length;
        }
      } else {
        const newUsers = [...users, userId];
        entry.users = newUsers;
        entry.count = newUsers.length;
      }
    } else {
      reactions.push({
        emoji,
        count: 1,
        users: [userId],
      });
    }

    await prisma.messages.update({
      where: { id: msgId },
      data: { reactions: JSON.stringify(reactions) },
    });

    const userIds = new Set();
    reactions.forEach((r) => r.users.forEach((u) => userIds.add(Number(u))));

    const users = await prisma.users.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });

    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const reactionsWithNames = reactions.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      users: r.users.map((uid) => ({
        id: Number(uid),
        name: userMap[Number(uid)] || "Unknown",
      })),
    }));

    io.to(`channel_${channel_id}`).emit("reactionUpdated", {
      messageId: msgId,
      reactions: reactionsWithNames,
    });
  } catch (err) {
    console.error("reactMessage error:", err);
  }
});
}

// ─── Helper: fan out a notification to every member's personal user room ───────
// We do NOT emit to the sender (they already got messageAck).
// We do NOT send the full message content in the notification — just enough
// for the sidebar badge + browser push notification.
async function _notifyChannelMembers(io, channel_id, payload, channel) {
  try {
    // Fetch all members of this channel
    const members = await prisma.channel_members.findMany({
      where: { channel_id },
      select: { user_id: true },
    });

    // Build the lightweight notification payload
    const notification = {
      channel_id: payload.channel_id,
      message_id: payload.id,
      sender_id: payload.sender_id,
      sender_name: payload.sender_name,
      avatar_url: payload.avatar_url,
      // Strip HTML tags for the push notification preview
      preview: _stripHtml(payload.content ?? "").slice(0, 100),
      channel_name: channel?.name ?? null,
      is_dm: channel?.is_dm ?? false,
      created_at: payload.created_at,
    };

    for (const member of members) {
      // Skip the sender — they're already aware of the message
      if (String(member.user_id) === String(payload.sender_id)) continue;

      // Emit to the member's always-present personal room
      io.to(`user_${member.user_id}`).emit("newMessageNotification", notification);
    }
  } catch (err) {
    console.error("_notifyChannelMembers error:", err);
  }
}

function _stripHtml(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").trim();
}