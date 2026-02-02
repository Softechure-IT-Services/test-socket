export default function registerChannelSockets(io, socket) {
  socket.on("joinChannel", ({ channel_id }) => {
    socket.join(`channel_${channel_id}`);
  });

  socket.on("leaveChannel", ({ channel_id }) => {
    socket.leave(`channel_${channel_id}`);
  });
}
