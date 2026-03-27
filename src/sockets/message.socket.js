import prisma from "../config/prisma.js";
import { getPreviewText } from "../utils/format.js";

/**
 * Register handlers for messaging-related socket events.
 * 
 * @param {import("socket.io").Server} io 
 * @param {import("socket.io").Socket} socket 
 */
export default function registerMessageSockets(io, socket) {
  // ─── Send Message ────────────────────────────────────────────────────────────
  socket.on("sendMessage", async ({ content, channel_id, files }) => {
    try {
      const message = await prisma.messages.create({
        data: {
          content,
          channel_id,
          sender_id: socket.user.id,
          files: files ? JSON.stringify(files) : null,
          reactions: "[]",
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

      const broadcastMsg = {
        ...message,
        sender_name: message.users.username,
        avatar_url: message.users.avatar_url,
      };

      io.to(`channel_${channel_id}`).emit("receiveMessage", broadcastMsg);
      socket.emit("messageAck", broadcastMsg);

      // Distribute push notification / unread count events
      try {
        const channelInfo = await prisma.channels.findUnique({ where: { id: channel_id }, select: { name: true, is_dm: true }});
        const members = await prisma.channel_members.findMany({ where: { channel_id }, select: { user_id: true }});
        
        const previewText = getPreviewText(content, files);

        members.forEach((m) => {
          io.to(`user_${m.user_id}`).emit("newMessageNotification", {
            channel_id: channel_id,
            message_id: message.id,
            sender_id: socket.user.id,
            sender_name: broadcastMsg.sender_name,
            avatar_url: broadcastMsg.avatar_url,
            preview: previewText,
            channel_name: channelInfo?.name,
            is_dm: channelInfo?.is_dm === true,
            created_at: new Date().toISOString()
          });
        });

        // Parse Mentions
        const mentionMatches = content.match(/@(\w+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
          const mentionedUsernames = mentionMatches.map(m => m.slice(1));
          
          const mentionedUsers = await prisma.users.findMany({
            where: { username: { in: mentionedUsernames } },
            select: { id: true }
          });

          // Filter out the sender and ensure they are actually in the channel
          const validMentions = mentionedUsers.filter(u => 
            String(u.id) !== String(socket.user.id) && 
            members.some(m => String(m.user_id) === String(u.id))
          );

          validMentions.forEach(u => {
            io.to(`user_${u.id}`).emit("newMentionNotification", {
              channel_id: channel_id,
              sender_name: broadcastMsg.sender_name,
              channel_name: channelInfo?.name,
              is_dm: channelInfo?.is_dm === true,
              preview: `"${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
              avatar_url: broadcastMsg.avatar_url,
              created_at: new Date().toISOString()
            });
          });
        }

      } catch (err) {
        console.error("Failed to emit newMessageNotification:", err.message);
      }
    } catch (err) {
      console.error("❌ sendMessage error:", err.message);
      socket.emit("messageSendError", { channel_id, error: err.message });
    }
  });

  // ─── Edit Message ────────────────────────────────────────────────────────────
  socket.on("editMessage", async ({ messageId, content, channel_id }) => {
    try {
      const updated = await prisma.messages.update({
        where: { id: Number(messageId) },
        data: {
          content,
          is_edited: true,
          updated_at: new Date(),
        },
      });

      io.to(`channel_${channel_id}`).emit("messageEdited", updated);
    } catch (err) {
      console.error("❌ editMessage error:", err.message);
    }
  });

  // ─── Delete Message ──────────────────────────────────────────────────────────
  socket.on("deleteMessage", async ({ id }) => {
    try {
      const record = await prisma.messages.findUnique({
        where: { id: Number(id) },
        select: { channel_id: true },
      });

      if (!record) return;

      await prisma.messages.delete({ where: { id: Number(id) } });

      io.to(`channel_${record.channel_id}`).emit("messageDeleted", { id });
    } catch (err) {
      console.error("❌ deleteMessage error:", err.message);
    }
  });

  // ─── Reactions ───────────────────────────────────────────────────────────────
  socket.on("reactMessage", async ({ messageId, emoji }) => {
    try {
      const msg = await prisma.messages.findUnique({
        where: { id: Number(messageId) },
        select: { reactions: true, channel_id: true },
      });

      if (!msg) return;

      let reactions = [];
      try {
        reactions = msg.reactions ? JSON.parse(msg.reactions) : [];
      } catch (err) {
        reactions = [];
      }

      const existingIndex = reactions.findIndex((r) => r.emoji === emoji);
      const userId = socket.user.id;

      if (existingIndex !== -1) {
        const reaction = reactions[existingIndex];
        const userIndex = reaction.users.findIndex((u) => u.id === userId);

        if (userIndex !== -1) {
          // Remove reaction
          reaction.users.splice(userIndex, 1);
          reaction.count = reaction.users.length;
          if (reaction.count === 0) reactions.splice(existingIndex, 1);
        } else {
          // Add user to existing emoji
          reaction.users.push({ id: userId, name: socket.user.username });
          reaction.count = reaction.users.length;
        }
      } else {
        // New emoji
        reactions.push({
          emoji,
          count: 1,
          users: [{ id: userId, name: socket.user.username }],
        });
      }

      const updated = await prisma.messages.update({
        where: { id: Number(messageId) },
        data: { reactions: JSON.stringify(reactions) },
      });

      io.to(`channel_${msg.channel_id}`).emit("reactionUpdated", {
        messageId,
        reactions,
      });
    } catch (err) {
      console.error("❌ reactMessage error:", err.message);
    }
  });

  // ─── Pin / Unpin ─────────────────────────────────────────────────────────────
  socket.on("pinMessage", async ({ messageId, channel_id }) => {
    try {
      const updated = await prisma.messages.update({
        where: { id: Number(messageId) },
        data: { pinned: true },
      });
      io.to(`channel_${channel_id}`).emit("messagePinned", { messageId, pinned: true });
    } catch (err) {
      console.error("❌ pinMessage error:", err.message);
    }
  });

  socket.on("unpinMessage", async ({ messageId, channel_id }) => {
    try {
      const updated = await prisma.messages.update({
        where: { id: Number(messageId) },
        data: { pinned: false },
      });
      io.to(`channel_${channel_id}`).emit("messageUnpinned", { messageId, pinned: false });
    } catch (err) {
      console.error("❌ unpinMessage error:", err.message);
    }
  });
}
