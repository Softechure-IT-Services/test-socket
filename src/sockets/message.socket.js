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
        select: { is_private: true },
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
      };

      io.to(`channel_${channel_id}`).emit("receiveMessage", payload);
      socket.emit("messageAck", payload);
    } catch (err) {
      console.error("sendMessage error:", err);
    }
  });

  // ================= EDIT =================
  socket.on("editMessage", async ({ messageId, content, channel_id }) => {
    if (!messageId || !channel_id || !content) return;
    const msgId = Number(messageId);
    const chId = Number(channel_id);

    const msg = await prisma.messages.findFirst({
      where: { id: msgId, channel_id: chId },
    });

    if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

    const updated = await prisma.messages.update({
      where: { id: msgId },
      data: { content },
    });

    io.to(`channel_${chId}`).emit("messageEdited", {
      id: msgId,
      content,
      channel_id: chId,
      updated_at: updated.updated_at,
    });
  });

  // ================= DELETE =================
  socket.on("deleteMessage", async ({ id }) => {
    if (!id) return;

    const msgId = Number(id);
    if (isNaN(msgId)) return;

    const msg = await prisma.messages.findUnique({
      where: { id: msgId },
    });

    if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

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

    io.to(`channel_${msg.channel_id}`).emit("messageDeleted", { id: msgId });
  });

  // ================= PIN/UNPIN =================
  socket.on("pinMessage", async ({ messageId, channel_id }) => {
    if (!messageId || !channel_id) return;

    const msgId = Number(messageId);
    const chId = Number(channel_id);

    const updated = await prisma.messages.update({
      where: { id: msgId },
      data: { pinned: true },
    });

    io.to(`channel_${chId}`).emit("messagePinned", {
      messageId: msgId,
      pinned: updated.pinned,
    });
  });

  socket.on("unpinMessage", async ({ messageId, channel_id }) => {
    let string_msgID = Number(messageId);
    await prisma.messages.update({
      where: { id: string_msgID },
      data: { pinned: false },
    });

    io.to(`channel_${channel_id}`).emit("messageUnpinned", {
      messageId: string_msgID,
      pinned: false,
    });
  });

  // ================= REACTIONS =================
  socket.on("reactMessage", async ({ messageId, emoji }) => {
    try {
      if (!messageId || !emoji) return;

      const msgId = Number(messageId);

      const msg = await prisma.messages.findUnique({
        where: { id: msgId },
        select: {
          id: true,
          channel_id: true,
          reactions: true,
        },
      });

      if (!msg) return;

      const channel_id = msg.channel_id;

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
        data: {
          reactions: JSON.stringify(reactions),
        },
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