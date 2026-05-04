import prisma from "../config/prisma.js";
import { getPreviewText } from "../utils/format.js";
import supabase from "../utils/supabase.js";

const MAX_MESSAGE_CHARS = 10_000;
const MAX_EMOJI_CHARS = 50;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "all files";

const getStoragePath = (file) => {
  if (!file) return null;
  if (typeof file === "string" && file.trim()) return file.trim();
  if (typeof file.path === "string" && file.path.trim()) return file.path.trim();
  if (typeof file.file === "string" && file.file.trim()) return file.file.trim();
  if (typeof file.url === "string" && file.url.trim()) {
    try {
      const url = new URL(file.url);
      const segments = url.pathname.split("/");
      const publicIndex = segments.indexOf("public");
      if (publicIndex !== -1 && segments.length > publicIndex + 2) {
        return segments.slice(publicIndex + 2).join("/");
      }
    } catch (err) {
      return file.url.trim();
    }
  }
  return null;
};

const extractSupabasePaths = (filesValue) => {
  if (!filesValue) return [];

  let fileEntries = [];
  if (typeof filesValue === "string") {
    if (!filesValue.trim() || filesValue === "[]") return [];
    try {
      fileEntries = JSON.parse(filesValue);
    } catch (err) {
      return [];
    }
  } else if (Array.isArray(filesValue)) {
    fileEntries = filesValue;
  }

  return fileEntries
    .map(getStoragePath)
    .filter((path) => typeof path === "string" && path.length > 0);
};

const parseFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

async function isChannelMember(channelId, userId) {
  if (channelId == null || userId == null) return false;
  
  const channel = await prisma.channels.findUnique({
    where: { id: channelId },
    select: { is_private: true },
  });
  if (!channel) return false;
  if (!channel.is_private) return true;

  const membership = await prisma.channel_members.findFirst({
    where: { channel_id: channelId, user_id: userId },
    select: { user_id: true },
  });
  return !!membership;
}

async function getMessage(messageId) {
  const id = parseFiniteNumber(messageId);
  if (id == null) return null;

  return prisma.messages.findUnique({
    where: { id },
    select: { id: true, channel_id: true, sender_id: true, reactions: true, pinned: true, content: true },
  });
}

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
      const userId = parseFiniteNumber(socket.user?.id);
      const channelId = parseFiniteNumber(channel_id);

      if (!userId || !channelId) {
        socket.emit("messageSendError", { channel_id, error: "Unauthorized" });
        return;
      }

      const messageText = typeof content === "string" ? content.trim() : "";
      if (!isNonEmptyString(messageText)) {
        socket.emit("messageSendError", { channel_id: channelId, error: "Message cannot be empty" });
        return;
      }
      if (messageText.length > MAX_MESSAGE_CHARS) {
        socket.emit("messageSendError", { channel_id: channelId, error: "Message too long" });
        return;
      }

      if (!(await isChannelMember(channelId, userId))) {
        socket.emit("messageSendError", { channel_id: channelId, error: "Not a member of this channel" });
        return;
      }

      const filesSafe = Array.isArray(files) ? files.slice(0, 8) : null;

      const message = await prisma.messages.create({
        data: {
          content: messageText,
          channel_id: channelId,
          sender_id: userId,
          files: filesSafe ? JSON.stringify(filesSafe) : null,
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

      io.to(`channel_${channelId}`).emit("receiveMessage", broadcastMsg);
      socket.emit("messageAck", broadcastMsg);

      // Distribute push notification / unread count events
      try {
        const channelInfo = await prisma.channels.findUnique({
          where: { id: channelId },
          select: { name: true, is_dm: true, is_private: true },
        });

        let notifyUserIds = [];
        if (channelInfo.is_private) {
          const members = await prisma.channel_members.findMany({
            where: { channel_id: channelId },
            select: { user_id: true },
          });
          notifyUserIds = members.map(m => m.user_id);
        } else {
          const leftUsers = await prisma.channel_left.findMany({
            where: { channel_id: channelId },
            select: { user_id: true },
          });
          const leftIds = new Set(leftUsers.map(u => u.user_id));
          const allUsers = await prisma.users.findMany({ select: { id: true } });
          notifyUserIds = allUsers.map(u => u.id).filter(id => !leftIds.has(id));
        }
        
        const previewText = getPreviewText(messageText, filesSafe);

        notifyUserIds.forEach((uid) => {
          io.to(`user_${uid}`).emit("newMessageNotification", {
            channel_id: channelId,
            message_id: message.id,
            sender_id: userId,
            sender_name: broadcastMsg.sender_name,
            avatar_url: broadcastMsg.avatar_url,
            preview: previewText,
            channel_name: channelInfo?.name,
            is_dm: channelInfo?.is_dm === true,
            created_at: new Date().toISOString()
          });
        });

        // Parse Mentions
        const mentionMatches = messageText.match(/@(\w+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
          const mentionedUsernames = mentionMatches.map(m => m.slice(1));
          
          const mentionedUsers = await prisma.users.findMany({
            where: { username: { in: mentionedUsernames } },
            select: { id: true }
          });

          // Filter out the sender and ensure they are actually in the channel
          const validMentions = mentionedUsers.filter(u => 
            String(u.id) !== String(userId) && 
            notifyUserIds.some(uid => String(uid) === String(u.id))
          );

          validMentions.forEach(u => {
            io.to(`user_${u.id}`).emit("newMentionNotification", {
              channel_id: channelId,
              sender_name: broadcastMsg.sender_name,
              channel_name: channelInfo?.name,
              is_dm: channelInfo?.is_dm === true,
              preview: `"${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`,
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
      const userId = parseFiniteNumber(socket.user?.id);
      const msgId = parseFiniteNumber(messageId);
      if (!userId || !msgId) return;

      const messageText = typeof content === "string" ? content.trim() : "";
      if (!isNonEmptyString(messageText)) return;
      if (messageText.length > MAX_MESSAGE_CHARS) return;

      const existing = await getMessage(msgId);
      if (!existing) return;

      // Prevent cross-channel edits (use message's true channel_id).
      if (channel_id != null) {
        const requestedChannelId = parseFiniteNumber(channel_id);
        if (requestedChannelId != null && requestedChannelId !== existing.channel_id) return;
      }

      if (existing.sender_id !== userId) return; // only message author can edit
      if (!(await isChannelMember(existing.channel_id, userId))) return;

      const updated = await prisma.messages.update({
        where: { id: msgId },
        data: {
          content: messageText,
          is_edited: true,
          updated_at: new Date(),
        },
      });

      io.to(`channel_${existing.channel_id}`).emit("messageEdited", updated);
    } catch (err) {
      console.error("❌ editMessage error:", err.message);
    }
  });

  // ─── Delete Message ──────────────────────────────────────────────────────────
  socket.on("deleteMessage", async ({ id }) => {
    try {
      const userId = parseFiniteNumber(socket.user?.id);
      const msgId = parseFiniteNumber(id);
      if (!userId || !msgId) return;

      const record = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { channel_id: true, sender_id: true, files: true },
      });

      if (!record) return;
      if (record.sender_id !== userId) return; // only message author can delete
      if (!(await isChannelMember(record.channel_id, userId))) return;

      const pathsToDelete = extractSupabasePaths(record.files);
      if (pathsToDelete.length > 0) {
        const { error } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .remove(pathsToDelete);

        if (error) {
          console.error("Supabase delete error:", {
            error,
            messageId: msgId,
            paths: pathsToDelete,
          });
        }
      }

      await prisma.messages.delete({ where: { id: msgId } });

      io.to(`channel_${record.channel_id}`).emit("messageDeleted", { id: msgId });
    } catch (err) {
      console.error("❌ deleteMessage error:", err.message);
    }
  });

  // ─── Reactions ───────────────────────────────────────────────────────────────
  socket.on("reactMessage", async ({ messageId, emoji }) => {
    try {
      const userId = parseFiniteNumber(socket.user?.id);
      const msgId = parseFiniteNumber(messageId);
      if (!userId || !msgId) return;

      const emojiText = typeof emoji === "string" ? emoji.trim() : "";
      if (!emojiText || emojiText.length > MAX_EMOJI_CHARS) return;

      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { reactions: true, channel_id: true },
      });

      if (!msg) return;
      if (!(await isChannelMember(msg.channel_id, userId))) return;

      let reactions = [];
      try {
        reactions = msg.reactions ? JSON.parse(msg.reactions) : [];
      } catch (err) {
        reactions = [];
      }

      const existingIndex = reactions.findIndex((r) => r.emoji === emojiText);

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
          emoji: emojiText,
          count: 1,
          users: [{ id: userId, name: socket.user.username }],
        });
      }

      const updated = await prisma.messages.update({
        where: { id: msgId },
        data: { reactions: JSON.stringify(reactions) },
      });

      io.to(`channel_${msg.channel_id}`).emit("reactionUpdated", {
        messageId: msgId,
        reactions,
      });
    } catch (err) {
      console.error("❌ reactMessage error:", err.message);
    }
  });

  // ─── Pin / Unpin ─────────────────────────────────────────────────────────────
  socket.on("pinMessage", async ({ messageId, channel_id }) => {
    try {
      const userId = parseFiniteNumber(socket.user?.id);
      const msgId = parseFiniteNumber(messageId);
      if (!userId || !msgId) return;

      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { channel_id: true },
      });
      if (!msg) return;
      if (!(await isChannelMember(msg.channel_id, userId))) return;

      await prisma.messages.update({
        where: { id: msgId },
        data: { pinned: true },
      });

      io.to(`channel_${msg.channel_id}`).emit("messagePinned", { messageId: msgId, pinned: true });
    } catch (err) {
      console.error("❌ pinMessage error:", err.message);
    }
  });

  socket.on("unpinMessage", async ({ messageId, channel_id }) => {
    try {
      const userId = parseFiniteNumber(socket.user?.id);
      const msgId = parseFiniteNumber(messageId);
      if (!userId || !msgId) return;

      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: { channel_id: true },
      });
      if (!msg) return;
      if (!(await isChannelMember(msg.channel_id, userId))) return;

      await prisma.messages.update({
        where: { id: msgId },
        data: { pinned: false },
      });

      io.to(`channel_${msg.channel_id}`).emit("messageUnpinned", { messageId: msgId, pinned: false });
    } catch (err) {
      console.error("❌ unpinMessage error:", err.message);
    }
  });
}
