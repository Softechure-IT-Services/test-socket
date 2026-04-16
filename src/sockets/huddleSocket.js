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
import { persistHuddleStatus } from "./presenceManager.js";

const users = new Map();
const roomParticipants = new Map(); // roomId -> Set<socketId>
const roomPendingRequests = new Map(); // roomId -> Map<socketId, pendingUser>
const roomJoinAuthorizations = new Map(); // roomId -> Set<socketId>
const roomChatHistory = new Map(); // roomId -> chat messages kept for the active huddle
const roomToChannel = new Map(); // roomId -> channelId

async function getStartedByUsername(userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return null;

  const user = await prisma.users.findUnique({
    where: { id: numericUserId },
    select: {
      username: true,
      name: true,
    },
  });

  return user?.username?.trim() || user?.name?.trim() || null;
}

function ensureSet(map, key) {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function ensurePendingMap(roomId) {
  if (!roomPendingRequests.has(roomId)) roomPendingRequests.set(roomId, new Map());
  return roomPendingRequests.get(roomId);
}

function serializeMember(socketId) {
  const user = users.get(socketId);
  return {
    socketId,
    userId: user?.userId != null ? String(user.userId) : null,
    username: user?.username || "Anonymous",
  };
}

function getRoomParticipantsSnapshot(roomId) {
  return Array.from(roomParticipants.get(roomId) || []).map(serializeMember);
}

function getRoomPendingSnapshot(roomId) {
  return Array.from(roomPendingRequests.get(roomId)?.values() || []);
}

function getRoomChatHistory(roomId) {
  return roomChatHistory.get(roomId) || [];
}

function hasSameUserActive(roomId, userId, exceptSocketId = null) {
  if (userId == null) return false;

  return getRoomParticipantsSnapshot(roomId).some((member) => {
    if (exceptSocketId && member.socketId === exceptSocketId) return false;
    return member.userId != null && String(member.userId) === String(userId);
  });
}

function authorizeRoomJoin(roomId, socketId) {
  ensureSet(roomJoinAuthorizations, roomId).add(socketId);
}

function consumeRoomJoinAuthorization(roomId, socketId) {
  const roomSet = roomJoinAuthorizations.get(roomId);
  if (!roomSet?.has(socketId)) return false;
  roomSet.delete(socketId);
  if (roomSet.size === 0) roomJoinAuthorizations.delete(roomId);
  return true;
}

async function getRoomSession(roomId) {
  if (!roomId) return null;

  const session = await prisma.huddleSession.findUnique({
    where: { meeting_id: roomId },
    select: {
      meeting_id: true,
      channel_id: true,
      started_by: true,
      ended_at: true,
    },
  });

  if (session?.channel_id != null) {
    roomToChannel.set(roomId, Number(session.channel_id));
  }

  if (!session) return null;

  return {
    ...session,
    started_by_username: await getStartedByUsername(session.started_by),
  };
}

async function isChannelMember(channelId, userId) {
  const numericChannelId = Number(channelId);
  const numericUserId = Number(userId);

  if (!Number.isFinite(numericChannelId) || !Number.isFinite(numericUserId)) {
    return false;
  }

  const membership = await prisma.channel_members.findFirst({
    where: {
      channel_id: numericChannelId,
      user_id: numericUserId,
    },
    select: { user_id: true },
  });

  return !!membership;
}

async function getRoomAccessState(roomId, userId) {
  const session = await getRoomSession(roomId);
  const adminUserId =
    session?.started_by != null ? Number(session.started_by) : null;
  const channelId =
    session?.channel_id != null ? Number(session.channel_id) : null;
  const numericUserId = Number(userId);
  const hasUserId = Number.isFinite(numericUserId);

  const isAdmin =
    hasUserId && adminUserId != null && numericUserId === adminUserId;
  const isMember =
    channelId != null && hasUserId
      ? await isChannelMember(channelId, numericUserId)
      : false;

  return {
    session,
    adminUserId,
    adminUsername: session?.started_by_username ?? null,
    channelId,
    isAdmin,
    isMember,
  };
}

function removePendingRequest(roomId, socketId) {
  const roomMap = roomPendingRequests.get(roomId);
  if (!roomMap?.has(socketId)) return false;
  roomMap.delete(socketId);
  if (roomMap.size === 0) roomPendingRequests.delete(roomId);
  return true;
}

function removePendingRequestsForSocket(socketId) {
  const affectedRooms = [];

  for (const [roomId, roomMap] of roomPendingRequests.entries()) {
    if (!roomMap.has(socketId)) continue;
    roomMap.delete(socketId);
    if (roomMap.size === 0) roomPendingRequests.delete(roomId);
    affectedRooms.push(roomId);
  }

  return affectedRooms;
}

function clearRoomJoinAuthorizationsForSocket(socketId) {
  for (const [roomId, roomSet] of roomJoinAuthorizations.entries()) {
    roomSet.delete(socketId);
    if (roomSet.size === 0) roomJoinAuthorizations.delete(roomId);
  }
}

function emitRoomState(io, roomId) {
  const participants = getRoomParticipantsSnapshot(roomId);
  const pending = getRoomPendingSnapshot(roomId);
  const payload = { roomId, participants, pending };

  io.to(roomId).emit("room-participants-updated", payload);
  io.to(roomId).emit("room-pending-updated", payload);

  const pendingMap = roomPendingRequests.get(roomId);
  if (!pendingMap) return;

  pendingMap.forEach((_, requesterSocketId) => {
    io.to(requesterSocketId).emit("room-participants-updated", payload);
    io.to(requesterSocketId).emit("room-pending-updated", payload);
  });
}

async function markRoomEndedIfEmpty(io, roomId) {
  const set = roomParticipants.get(roomId);
  if (set && set.size > 0) return;

  roomParticipants.delete(roomId);
  roomPendingRequests.delete(roomId);
  roomJoinAuthorizations.delete(roomId);
  roomChatHistory.delete(roomId);

  const cid = roomToChannel.get(roomId);
  if (!cid) return;

  roomToChannel.delete(roomId);

  try {
    await prisma.huddleSession.updateMany({
      where: { channel_id: cid, meeting_id: roomId, ended_at: null },
      data: { ended_at: new Date() },
    });
    io.to(`channel_${cid}`).emit("huddleEnded", { channelId: cid, roomId });
  } catch (err) {
    console.error("huddleEnded persist error:", err.message);
  }
}

function leaveTrackedRoom(io, socket, roomId, options = {}) {
  if (!roomId) return;

  const { skipLeave = false } = options;
  const user = users.get(socket.id);

  if (user) {
    user.inCall = false;
    if (user.room === roomId) user.room = null;
  }

  // ✅ Persist huddle status in DB (leaving huddle)
  if (user?.userId) {
    void persistHuddleStatus(user.userId, false);
  }

  if (!skipLeave) {
    socket.leave(roomId);
  }

  const set = roomParticipants.get(roomId);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) roomParticipants.delete(roomId);
  }

  socket.to(roomId).emit("user-left", socket.id);
  emitRoomState(io, roomId);
  void markRoomEndedIfEmpty(io, roomId);
  broadcastUserList(io);
}

export default function registerConnectionHuddleSockets(io, socket) {
  console.log(`👤 User connected: ${socket.id}`);

  users.set(socket.id, {
    id: socket.id,
    userId: socket.user?.id ?? null,
    username: null,
    inCall: false,
    room: null,
    previewingRoom: null, // NEW: track lobby/preview state
  });

  socket.on("set-username", (username) => {
    const user = users.get(socket.id);
    if (user) {
      user.username = username;
      broadcastUserList(io);
    }
  });

  socket.on("update-call-status", (inCall) => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = inCall;
      broadcastUserList(io);
    }
  });

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

    authorizeRoomJoin(roomId, socket.id);
    authorizeRoomJoin(roomId, to);

    io.to(to).emit("incoming-call", {
      from: socket.id,
      roomId,
      callerName: callerName || users.get(socket.id)?.username || "Unknown",
    });
  });

  socket.on("call-accepted", ({ to, roomId }) => {
    io.to(to).emit("call-accepted", { roomId });
  });

  socket.on("call-rejected", ({ to, reason }) => {
    io.to(to).emit("call-rejected", { reason });
  });

  socket.on("huddle-room-preview", async ({ roomId } = {}, ack) => {
    const user = users.get(socket.id);
    if (user && roomId) {
      user.previewingRoom = roomId;
    }

    if (!roomId) {
      ack?.({
        roomId: null,
        participants: [],
        pending: [],
        sameUserActive: false,
        pendingRequest: false,
        adminUserId: null,
        adminUsername: null,
        requesterIsChannelMember: false,
      });
      return;
    }

    try {
      const access = await getRoomAccessState(roomId, socket.user?.id);

      ack?.({
        roomId,
        participants: getRoomParticipantsSnapshot(roomId),
        pending: getRoomPendingSnapshot(roomId),
        sameUserActive: hasSameUserActive(roomId, socket.user?.id, socket.id),
        pendingRequest: roomPendingRequests.get(roomId)?.has(socket.id) || false,
        adminUserId:
          access.adminUserId != null ? String(access.adminUserId) : null,
        adminUsername: access.adminUsername ?? null,
        requesterIsChannelMember: access.isMember,
      });
    } catch (err) {
      console.error("huddle-room-preview error:", err.message);
      ack?.({
        roomId,
        participants: getRoomParticipantsSnapshot(roomId),
        pending: getRoomPendingSnapshot(roomId),
        sameUserActive: hasSameUserActive(roomId, socket.user?.id, socket.id),
        pendingRequest: roomPendingRequests.get(roomId)?.has(socket.id) || false,
        adminUserId: null,
        adminUsername: null,
        requesterIsChannelMember: false,
      });
    }
  });

  socket.on("request-room-admission", async ({ roomId, username } = {}, ack) => {
    if (!roomId) {
      ack?.({ ok: false, error: "Missing room id" });
      return;
    }

    const participantCount = roomParticipants.get(roomId)?.size || 0;
    const sameUserActive = hasSameUserActive(roomId, socket.user?.id, socket.id);

    if (participantCount === 0 || sameUserActive) {
      authorizeRoomJoin(roomId, socket.id);
      ack?.({ ok: true, directJoin: true });
      socket.emit("room-admission-result", { roomId, status: "admitted" });
      return;
    }

    try {
      const access = await getRoomAccessState(roomId, socket.user?.id);
      if (access.isMember) {
        authorizeRoomJoin(roomId, socket.id);
        ack?.({ ok: true, directJoin: true });
        socket.emit("room-admission-result", { roomId, status: "admitted" });
        return;
      }
    } catch (err) {
      console.error("request-room-admission error:", err.message);
    }

    const pendingMap = ensurePendingMap(roomId);
    pendingMap.set(socket.id, {
      socketId: socket.id,
      userId: socket.user?.id != null ? String(socket.user.id) : null,
      username: username || users.get(socket.id)?.username || "Anonymous",
    });

    emitRoomState(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("cancel-room-admission-request", ({ roomId } = {}) => {
    if (!roomId) return;
    if (!removePendingRequest(roomId, socket.id)) return;
    emitRoomState(io, roomId);
  });

  socket.on("respond-room-admission", async ({ roomId, targetSocketId, admit } = {}, ack) => {
    if (!roomId || !targetSocketId) return;

    const participantSet = roomParticipants.get(roomId);
    if (!participantSet?.has(socket.id)) {
      ack?.({ ok: false, error: "Join the huddle before managing requests" });
      return;
    }

    try {
      const access = await getRoomAccessState(roomId, socket.user?.id);
      if (access.adminUserId != null && !access.isAdmin) {
        ack?.({ ok: false, error: "Only the huddle admin can manage requests" });
        return;
      }
    } catch (err) {
      console.error("respond-room-admission error:", err.message);
      ack?.({ ok: false, error: "Could not verify huddle permissions" });
      return;
    }

    if (!removePendingRequest(roomId, targetSocketId)) {
      ack?.({ ok: false, error: "That join request is no longer pending" });
      return;
    }

    if (admit) {
      authorizeRoomJoin(roomId, targetSocketId);
    }

    io.to(targetSocketId).emit("room-admission-result", {
      roomId,
      status: admit ? "admitted" : "denied",
    });

    emitRoomState(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("huddle-chat-message", ({ roomId, text } = {}, ack) => {
    const messageText = typeof text === "string" ? text.trim() : "";
    if (!roomId || !messageText) {
      ack?.({ ok: false, error: "Message cannot be empty" });
      return;
    }

    const participantSet = roomParticipants.get(roomId);
    if (!participantSet?.has(socket.id)) {
      ack?.({ ok: false, error: "Join the huddle before chatting" });
      return;
    }

    const history = getRoomChatHistory(roomId);
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      socketId: socket.id,
      userId: socket.user?.id != null ? String(socket.user.id) : null,
      username: users.get(socket.id)?.username || "Anonymous",
      text: messageText,
      createdAt: new Date().toISOString(),
    };

    roomChatHistory.set(roomId, [...history, message].slice(-100));
    io.to(roomId).emit("huddle-chat-message", message);
    ack?.({ ok: true });
  });

  socket.on("kick-participant", async ({ roomId, targetSocketId } = {}, ack) => {
    if (!roomId || !targetSocketId) {
      ack?.({ ok: false, error: "Missing participant or room" });
      return;
    }

    const participantSet = roomParticipants.get(roomId);
    if (!participantSet?.has(socket.id)) {
      ack?.({ ok: false, error: "Only current participants can remove someone" });
      return;
    }

    try {
      const access = await getRoomAccessState(roomId, socket.user?.id);
      if (access.adminUserId != null && !access.isAdmin) {
        ack?.({ ok: false, error: "Only the huddle admin can remove participants" });
        return;
      }
    } catch (err) {
      console.error("kick-participant error:", err.message);
      ack?.({ ok: false, error: "Could not verify huddle permissions" });
      return;
    }

    if (targetSocketId === socket.id) {
      ack?.({ ok: false, error: "You cannot kick yourself" });
      return;
    }

    if (!participantSet.has(targetSocketId)) {
      ack?.({ ok: false, error: "That user is no longer in the huddle" });
      return;
    }

    const byUsername = users.get(socket.id)?.username || "Someone";
    io.to(targetSocketId).emit("kicked-from-room", { roomId, byUsername });

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      leaveTrackedRoom(io, targetSocket, roomId);
    } else {
      const targetUser = users.get(targetSocketId);
      if (targetUser) {
        targetUser.inCall = false;
        if (targetUser.room === roomId) targetUser.room = null;
      }

      participantSet.delete(targetSocketId);
      if (participantSet.size === 0) roomParticipants.delete(roomId);
      emitRoomState(io, roomId);
      void markRoomEndedIfEmpty(io, roomId);
      broadcastUserList(io);
    }

    ack?.({ ok: true });
  });

  socket.on("join-room", async (payload, ack) => {
    const roomId = typeof payload === "string" ? payload : payload?.roomId;
    if (!roomId) {
      ack?.({ ok: false, error: "Missing room id" });
      return;
    }

    const user = users.get(socket.id);
    const alreadyJoined = roomParticipants.get(roomId)?.has(socket.id) || false;
    const participantCount = roomParticipants.get(roomId)?.size || 0;
    const sameUserActive = hasSameUserActive(roomId, socket.user?.id, socket.id);
    const isAuthorized = consumeRoomJoinAuthorization(roomId, socket.id);
    let roomAccess = null;

    if (!alreadyJoined && participantCount > 0 && !sameUserActive && !isAuthorized) {
      try {
        roomAccess = await getRoomAccessState(roomId, socket.user?.id);
      } catch (err) {
        console.error("join-room access lookup error:", err.message);
      }

      if (!roomAccess?.isMember) {
        ack?.({ ok: false, reason: "admission-required" });
        socket.emit("room-admission-required", { roomId });
        return;
      }
    }

    if (user) {
      user.room = roomId;
      user.previewingRoom = null; // Clear preview: they have officially joined
      user.inCall = true;
    }

    // ✅ Persist huddle status in DB (joining huddle)
    if (user?.userId) {
      void persistHuddleStatus(user.userId, true);
    }

    socket.join(roomId);
    ensureSet(roomParticipants, roomId).add(socket.id);
    removePendingRequest(roomId, socket.id);

    const roomUsers = getRoomParticipantsSnapshot(roomId)
      .filter((member) => member.socketId !== socket.id)
      .map((member) => ({
        id: member.socketId,
        username: member.username,
      }));

    socket.emit("existing-users", roomUsers);
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username: user?.username || "Anonymous",
    });

    emitRoomState(io, roomId);
    broadcastUserList(io);

    if (!roomAccess) {
      try {
        roomAccess = await getRoomAccessState(roomId, socket.user?.id);
      } catch (err) {
        console.error("join-room admin lookup error:", err.message);
      }
    }

    ack?.({
      ok: true,
      participants: getRoomParticipantsSnapshot(roomId),
      pending: getRoomPendingSnapshot(roomId),
      chatHistory: getRoomChatHistory(roomId),
      adminUserId:
        roomAccess?.adminUserId != null ? String(roomAccess.adminUserId) : null,
      adminUsername: roomAccess?.adminUsername ?? null,
    });
  });

  socket.on("huddle-started", async ({ channelId, roomId } = {}) => {
    const cid = Number(channelId);
    if (!Number.isFinite(cid)) return;

    let rid = roomId;

    try {
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
      roomToChannel.set(rid, cid);
      authorizeRoomJoin(rid, socket.id);

      const members = await prisma.channel_members.findMany({
        where: { channel_id: cid },
        select: { user_id: true },
      });
      const userIds = members.map((member) => member.user_id).filter((userId) => userId != null);

      const channel = await prisma.channels.findUnique({
        where: { id: cid },
        select: { name: true },
      });

      const payload = {
        channelId: cid,
        roomId: rid,
        startedBy: Number(session.started_by),
        channel_name: channel?.name || `Channel ${cid}`,
        started_by_username: await getStartedByUsername(session.started_by),
      };

      socket.emit("huddleJoined", payload);
      io.to(`channel_${cid}`).emit("huddleStarted", payload);
      userIds
        .filter((userId) => Number(userId) !== Number(socket.user?.id))
        .forEach((userId) => {
          io.to(`user_${userId}`).emit("huddleStarted", payload);
        });
    } catch (err) {
      console.error("huddle-started error:", err.message);
      socket.emit("huddle-error", { error: "Failed to start huddle" });
    }
  });

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

  socket.on("renegotiate", ({ to, offer }) => {
    if (!to || !offer) return;
    io.to(to).emit("renegotiate", { from: socket.id, offer });
  });

  socket.on("renegotiate-answer", ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit("renegotiate-answer", { from: socket.id, answer });
  });

  socket.on("screen-share-status", ({ roomId, sharing }) => {
    socket.to(roomId).emit("peer-screen-share-status", {
      userId: socket.id,
      sharing,
    });
  });

  const handleAudioTrackUpdated = ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit("peer-audio-updated", { from: socket.id });
  };
  socket.on("audio-track-updated", handleAudioTrackUpdated);
  socket.on("peer-audio-updated", handleAudioTrackUpdated);

  socket.on("leave-room", (payload) => {
    const roomId = typeof payload === "string" ? payload : payload?.roomId || users.get(socket.id)?.room;
    leaveTrackedRoom(io, socket, roomId);
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    const user = users.get(socket.id);
    if (user?.room) {
      // ✅ Persist huddle status in DB on disconnect if they were in a huddle
      if (user.userId) {
        void persistHuddleStatus(user.userId, false);
      }
      leaveTrackedRoom(io, socket, user.room, { skipLeave: true });
    } else if (user?.previewingRoom) {
      // ✅ Admin closed the lobby without joining: check if empty and end it
      const lastRoomId = user.previewingRoom;
      void (async () => {
        try {
          const access = await getRoomAccessState(lastRoomId, user.userId);
          if (access.isAdmin) {
            const participants = roomParticipants.get(lastRoomId);
            if (!participants || participants.size === 0) {
              console.log(`🗑️ Huddle ${lastRoomId} lobby closed by admin (empty): ending session.`);
              void markRoomEndedIfEmpty(io, lastRoomId);
            }
          }
        } catch (err) {
          /* ignore error on disconnect cleanup */
        }
      })();
    }

    removePendingRequestsForSocket(socket.id).forEach((roomId) => {
      emitRoomState(io, roomId);
    });

    clearRoomJoinAuthorizationsForSocket(socket.id);
    users.delete(socket.id);
    broadcastUserList(io);
  });

  broadcastUserList(io);
}

function broadcastUserList(io) {
  const userList = Array.from(users.values()).map((user) => ({
    id: user.id,
    username: user.username,
    inCall: user.inCall,
  }));

  io.emit("update-user-list", userList);
}
