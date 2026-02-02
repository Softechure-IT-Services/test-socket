// sockets/connection.huddle.js

const users = new Map();

export default function registerConnectionHuddleSockets(io, socket) {
  console.log(`👤 User connected: ${socket.id}`);

  // Initialize user
  users.set(socket.id, {
    id: socket.id,
    username: null,
    inCall: false,
    room: null,
  });

  // Set username
  socket.on("set-username", (username) => {
    const user = users.get(socket.id);
    if (user) {
      user.username = username;
      broadcastUserList(io);
    }
  });

  // Update call status
  socket.on("update-call-status", (inCall) => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = inCall;
      broadcastUserList(io);
    }
  });

  // Call user
  socket.on("call-user", ({ to, roomId, callerName }) => {
    const targetUser = users.get(to);

    if (targetUser && !targetUser.inCall) {
      io.to(to).emit("incoming-call", {
        from: socket.id,
        roomId,
        callerName,
      });
    } else {
      socket.emit("call-rejected", { reason: "busy" });
    }
  });

  // Call accepted
  socket.on("call-accepted", ({ to, roomId }) => {
    io.to(to).emit("call-accepted", { roomId });
  });

  // Call rejected
  socket.on("call-rejected", ({ to, reason }) => {
    io.to(to).emit("call-rejected", { reason });
  });

  // Join room
  socket.on("join-room", (roomId) => {
    const user = users.get(socket.id);
    if (user) {
      user.room = roomId;
      user.inCall = true;
    }

    socket.join(roomId);

    const roomUsers = Array.from(
      io.sockets.adapter.rooms.get(roomId) || []
    )
      .filter((id) => id !== socket.id)
      .map((id) => ({
        id,
        username: users.get(id)?.username || "Anonymous",
      }));

    socket.emit("existing-users", roomUsers);

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username: user?.username || "Anonymous",
    });

    broadcastUserList(io);
  });

  // WebRTC signaling
  socket.on("offer", ({ to, offer }) => {
    io.to(to).emit("offer", {
      from: socket.id,
      offer,
      username: users.get(socket.id)?.username || "Anonymous",
    });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", {
      from: socket.id,
      answer,
    });
  });

  socket.on("icecandidate", ({ to, candidate }) => {
    io.to(to).emit("icecandidate", {
      from: socket.id,
      candidate,
    });
  });

  // Screen share status
  socket.on("screen-share-status", ({ roomId, sharing }) => {
    socket.to(roomId).emit("peer-screen-share-status", {
      userId: socket.id,
      sharing,
    });
  });

  // Audio track updated
  socket.on("audio-track-updated", ({ roomId }) => {
    socket.to(roomId).emit("peer-audio-updated", {
      from: socket.id,
    });
  });

  // Leave room
  socket.on("leave-room", (roomId) => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = false;
      user.room = null;
    }

    socket.leave(roomId);
    socket.to(roomId).emit("user-left", socket.id);
    broadcastUserList(io);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    const user = users.get(socket.id);
    if (user?.room) {
      socket.to(user.room).emit("user-left", socket.id);
    }

    users.delete(socket.id);
    broadcastUserList(io);
  });

  // Send initial list
  broadcastUserList(io);
}

// Helper
function broadcastUserList(io) {
  const userList = Array.from(users.values()).map((user) => ({
    id: user.id,
    username: user.username,
    inCall: user.inCall,
  }));

  io.emit("update-user-list", userList);
}
