import prisma from "../config/prisma.js";
import supabase from "../utils/supabase.js";

export default function registerMessageSockets(io, socket) {

  // ================= SEND =================
  socket.on("sendMessage", async ({ content, channel_id, files }) => {
    if (!channel_id || (!content && (!files || !files.length))) return;

    const sender_id = socket.user.id;

    const message = await prisma.messages.create({
      data: {
        channel_id,
        sender_id,
        content,
        files: files || [],
      },
      include: {
        users: true,
      },
    });

    const payload = {
      id: message.id,
      channel_id: message.channel_id,
      content: message.content,
      files: message.files || [],
      sender_id: message.sender_id,
      sender_name: socket.user.name,
      avatar_url: socket.user.avatar_url,
      created_at: message.created_at,
      updated_at: message.updated_at,
    };

    io.to(`channel_${channel_id}`).emit("receiveMessage", payload);
    socket.emit("messageAck", payload);
  });

  // ================= EDIT =================
  socket.on("editMessage", async ({ messageId, content, channel_id }) => {
    if (!messageId || !channel_id || !content) return;

    const msg = await prisma.messages.findFirst({
      where: { id: messageId, channel_id },
    });

    if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

    const updated = await prisma.messages.update({
      where: { id: messageId },
      data: { content },
    });

    io.to(`channel_${channel_id}`).emit("messageEdited", {
      id: messageId,
      content,
      channel_id,
      updated_at: updated.updated_at,
    });
  });

  // ================= DELETE =================
  socket.on("deleteMessage", async ({ id }) => {
    if (!id) return;

    const msg = await prisma.messages.findUnique({ where: { id } });
    if (!msg || String(msg.sender_id) !== String(socket.user.id)) return;

    const files = msg.files || [];

    if (files.length) {
      const paths = files.map(f => f.path).filter(Boolean);
      if (paths.length) {
        await supabase.storage.from("images").remove(paths);
      }
    }

    await prisma.messages.delete({ where: { id } });

    io.to(`channel_${msg.channel_id}`).emit("messageDeleted", { id });
  });

  // ================= PIN =================
  socket.on("pinMessage", async ({ messageId, channel_id }) => {
    await prisma.messages.update({
      where: { id: messageId },
      data: { pinned: true },
    });

    io.to(`channel_${channel_id}`).emit("messagePinned", {
      messageId,
      pinned: true,
    });
  });

  socket.on("unpinMessage", async ({ messageId, channel_id }) => {
    await prisma.messages.update({
      where: { id: messageId },
      data: { pinned: false },
    });

    io.to(`channel_${channel_id}`).emit("messageUnpinned", {
      messageId,
      pinned: false,
    });
  });
}
