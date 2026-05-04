import prisma from "../config/prisma.js";

export default function registerChannelSockets(io, socket) {
  const parseFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const isChannelMember = async (channelId, userId) => {
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
  };

  socket.on("joinChannel", async ({ channel_id }) => {
    const channelId = parseFiniteNumber(channel_id);
    const userId = parseFiniteNumber(socket.user?.id);

    // Security: only allow actual channel members to join the Socket.IO room.
    if (!channelId || !userId) return;

    if (!(await isChannelMember(channelId, userId))) return;
    socket.join(`channel_${channelId}`);
  });

  socket.on("leaveChannel", ({ channel_id }) => {
    const channelId = parseFiniteNumber(channel_id);
    if (!channelId) return;
    socket.leave(`channel_${channelId}`);
  });
}
