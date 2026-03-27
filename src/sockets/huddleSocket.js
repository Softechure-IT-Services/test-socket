// // sockets/connection.huddle.js

// const users = new Map();

// export default function registerConnectionHuddleSockets(io, socket) {
//   console.log(`👤 User connected: ${socket.id}`);

//   // Initialize user
//   users.set(socket.id, {
//     id: socket.id,
//     username: null,
//     inCall: false,
//     room: null,
//   });

//   // Set username
//   socket.on("set-username", (username) => {
//     const user = users.get(socket.id);
//     if (user) {
//       user.username = username;
//       broadcastUserList(io);
//     }
//   });

//   // Update call status
//   socket.on("update-call-status", (inCall) => {
//     const user = users.get(socket.id);
//     if (user) {
//       user.inCall = inCall;
//       broadcastUserList(io);
//     }
//   });

//   // Call user
//   socket.on("call-user", ({ to, roomId, callerName }) => {
//     const targetUser = users.get(to);

//     if (targetUser && !targetUser.inCall) {
//       io.to(to).emit("incoming-call", {
//         from: socket.id,
//         roomId,
//         callerName,
//       });
//     } else {
//       socket.emit("call-rejected", { reason: "busy" });
//     }
//   });

//   // Call accepted
//   socket.on("call-accepted", ({ to, roomId }) => {
//     io.to(to).emit("call-accepted", { roomId });
//   });

//   // Call rejected
//   socket.on("call-rejected", ({ to, reason }) => {
//     io.to(to).emit("call-rejected", { reason });
//   });

//   // Join room
//   socket.on("join-room", (roomId) => {
//     const user = users.get(socket.id);
//     if (user) {
//       user.room = roomId;
//       user.inCall = true;
//     }

//     socket.join(roomId);

//     const roomUsers = Array.from(
//       io.sockets.adapter.rooms.get(roomId) || []
//     )
//       .filter((id) => id !== socket.id)
//       .map((id) => ({
//         id,
//         username: users.get(id)?.username || "Anonymous",
//       }));

//     socket.emit("existing-users", roomUsers);

//     socket.to(roomId).emit("user-joined", {
//       id: socket.id,
//       username: user?.username || "Anonymous",
//     });

//     broadcastUserList(io);
//   });

//   // WebRTC signaling
//   socket.on("offer", ({ to, offer }) => {
//     io.to(to).emit("offer", {
//       from: socket.id,
//       offer,
//       username: users.get(socket.id)?.username || "Anonymous",
//     });
//   });

//   socket.on("answer", ({ to, answer }) => {
//     io.to(to).emit("answer", {
//       from: socket.id,
//       answer,
//     });
//   });

//   socket.on("icecandidate", ({ to, candidate }) => {
//     io.to(to).emit("icecandidate", {
//       from: socket.id,
//       candidate,
//     });
//   });

//   // Screen share status
//   socket.on("screen-share-status", ({ roomId, sharing }) => {
//     socket.to(roomId).emit("peer-screen-share-status", {
//       userId: socket.id,
//       sharing,
//     });
//   });

//   // Audio track updated
//   socket.on("audio-track-updated", ({ roomId }) => {
//     socket.to(roomId).emit("peer-audio-updated", {
//       from: socket.id,
//     });
//   });

//   // Leave room
//   socket.on("leave-room", (roomId) => {
//     const user = users.get(socket.id);
//     if (user) {
//       user.inCall = false;
//       user.room = null;
//     }

//     socket.leave(roomId);
//     socket.to(roomId).emit("user-left", socket.id);
//     broadcastUserList(io);
//   });

//   // Disconnect
//   socket.on("disconnect", () => {
//     console.log(`❌ User disconnected: ${socket.id}`);

//     const user = users.get(socket.id);
//     if (user?.room) {
//       socket.to(user.room).emit("user-left", socket.id);
//     }

//     users.delete(socket.id);
//     broadcastUserList(io);
//   });

//   // Send initial list
//   broadcastUserList(io);
// }

// // Helper
// function broadcastUserList(io) {
//   const userList = Array.from(users.values()).map((user) => ({
//     id: user.id,
//     username: user.username,
//     inCall: user.inCall,
//   }));

//   io.emit("update-user-list", userList);
// }


// sockets/connection.huddle.js

import prisma from "../config/prisma.js";

const users = new Map();
// Track participants so we can end a huddle when empty.
const roomParticipants = new Map(); // roomId -> Set<socketId>
const roomToChannel = new Map(); // roomId -> channelId (number)

export default function registerConnectionHuddleSockets(io, socket) {
  console.log(`👤 User connected: ${socket.id}`);

  // Initialize user
  users.set(socket.id, {
    id: socket.id,
    userId: socket.user?.id ?? null,
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
    if (!to || !roomId) return;
    const targetUser = users.get(to);

    if (!targetUser) {
      socket.emit("call-rejected", { reason: "offline" });
      return;
    }

    if (targetUser.inCall) {
      socket.emit("call-rejected", { reason: "busy" });
      return;
    }

    io.to(to).emit("incoming-call", {
      from: socket.id,
      roomId,
      callerName: callerName || users.get(socket.id)?.username || "Unknown",
    });
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

    // Track participants
    if (!roomParticipants.has(roomId)) roomParticipants.set(roomId, new Set());
    roomParticipants.get(roomId).add(socket.id);

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

  // Channel huddle bootstrap: notify all channel members to join the channel-based room.
  // The client will open `/huddle?channel_id=<id>` and auto-join `channel-<id>`.
  socket.on("huddle-started", async ({ channelId, roomId }) => {
    const cid = Number(channelId);
    if (!Number.isFinite(cid)) return;
    // Prefer a stable room id (active session meeting_id) so everyone joins same huddle.
    let rid = roomId;

    try {
      // Ensure starter is a member of the channel
      const membership = await prisma.channel_members.findFirst({
        where: {
          channel_id: cid,
          user_id: Number(socket.user?.id),
        },
        select: { user_id: true },
      });
      if (!membership) {
        socket.emit("huddle-error", { error: "Not allowed to start huddle for this channel" });
        return;
      }

      // Create or reuse active session; use its meeting_id as room id.
      let session = await prisma.huddleSession.findFirst({
        where: { channel_id: cid, ended_at: null },
        orderBy: { started_at: "desc" },
      });
      if (!session) {
        const meetingId = `channel-${cid}-${Date.now()}`;
        session = await prisma.huddleSession.create({
          data: {
            meeting_id: meetingId,
            channel_id: cid,
            started_by: Number(socket.user?.id),
            started_at: new Date(),
          },
        });
      }
      rid = session.meeting_id;

      // Auto-enter starter immediately.
      const user = users.get(socket.id);
      if (user) {
        user.room = rid;
        user.inCall = true;
      }
      socket.join(rid);
      if (!roomParticipants.has(rid)) roomParticipants.set(rid, new Set());
      roomParticipants.get(rid).add(socket.id);
      roomToChannel.set(rid, cid);

      const members = await prisma.channel_members.findMany({
        where: { channel_id: cid },
        select: { user_id: true },
      });
      const userIds = members.map((m) => m.user_id).filter((x) => x != null);

      const payload = {
        channelId: cid,
        roomId: rid,
        startedBy: Number(socket.user?.id),
      };

      // Ack to starter (already in room now)
      socket.emit("huddleJoined", payload);

      // Notify everyone in the channel room (for online users already viewing the channel)
      io.to(`channel_${cid}`).emit("huddleStarted", payload);
      // Also notify via personal rooms so offline-from-channel-view users can still get it
      userIds.forEach((uid) => {
        io.to(`user_${uid}`).emit("huddleStarted", payload);
      });
      broadcastUserList(io);
    } catch (err) {
      console.error("huddle-started error:", err.message);
      socket.emit("huddle-error", { error: "Failed to start huddle" });
    }
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

  // Renegotiation (mid-call device swap)
  socket.on("renegotiate", ({ to, offer }) => {
    if (!to || !offer) return;
    io.to(to).emit("renegotiate", { from: socket.id, offer });
  });

  socket.on("renegotiate-answer", ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit("renegotiate-answer", { from: socket.id, answer });
  });

  // Screen share status
  socket.on("screen-share-status", ({ roomId, sharing }) => {
    socket.to(roomId).emit("peer-screen-share-status", {
      userId: socket.id,
      sharing,
    });
  });

  // Audio track updated — handle both event names the client may emit
  const handleAudioTrackUpdated = ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit("peer-audio-updated", { from: socket.id });
  };
  socket.on("audio-track-updated", handleAudioTrackUpdated);
  socket.on("peer-audio-updated",  handleAudioTrackUpdated);

  // Leave room
  socket.on("leave-room", (roomId) => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = false;
      user.room = null;
    }

    socket.leave(roomId);
    const set = roomParticipants.get(roomId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        roomParticipants.delete(roomId);
        const cid = roomToChannel.get(roomId);
        if (cid) {
          prisma.huddleSession
            .updateMany({
              where: { channel_id: cid, meeting_id: roomId, ended_at: null },
              data: { ended_at: new Date() },
            })
            .then(() => {
              io.to(`channel_${cid}`).emit("huddleEnded", { channelId: cid, roomId });
            })
            .catch((err) => console.error("huddleEnded persist error:", err.message));
        }
        roomToChannel.delete(roomId);
      }
    }
    socket.to(roomId).emit("user-left", socket.id);
    broadcastUserList(io);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    const user = users.get(socket.id);
    if (user?.room) {
      socket.to(user.room).emit("user-left", socket.id);
      const roomId = user.room;
      const set = roomParticipants.get(roomId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          roomParticipants.delete(roomId);
          const cid = roomToChannel.get(roomId);
          if (cid) {
            prisma.huddleSession
              .updateMany({
                where: { channel_id: cid, meeting_id: roomId, ended_at: null },
                data: { ended_at: new Date() },
              })
              .then(() => {
                io.to(`channel_${cid}`).emit("huddleEnded", { channelId: cid, roomId });
              })
              .catch((err) => console.error("huddleEnded persist error:", err.message));
          }
          roomToChannel.delete(roomId);
        }
      }
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