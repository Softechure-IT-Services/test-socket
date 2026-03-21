import { Server } from "socket.io";

import prisma from "../config/prisma.js";
import socketAuthMiddleware from "./auth.middleware.js";
import registerChannelSockets from "./channel.socket.js";
import registerMessageSockets from "./message.socket.js";
import registerConnectionHuddleSockets from "./huddleSocket.js";

const userConnectionCounts = new Map();

export let io;

function parseUserId(rawId) {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

async function persistPresence(userId, isOnline) {
  try {
    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        is_online: isOnline,
        last_seen: new Date(),
        updated_at: new Date(),
      },
      select: {
        id: true,
        is_online: true,
        last_seen: true,
      },
    });

    if (io) {
      io.emit("userPresenceChanged", {
        userId: user.id,
        is_online: !!user.is_online,
        last_seen: user.last_seen,
      });
    }
  } catch (err) {
    console.error(`Failed to update presence for user ${userId}:`, err.message);
  }
}

function trackUserConnection(userId) {
  const parsedId = parseUserId(userId);
  if (parsedId === null) return;

  const key = String(parsedId);
  const nextCount = (userConnectionCounts.get(key) ?? 0) + 1;
  userConnectionCounts.set(key, nextCount);

  if (nextCount === 1) {
    void persistPresence(parsedId, true);
  }
}

function releaseUserConnection(userId) {
  const parsedId = parseUserId(userId);
  if (parsedId === null) return;

  const key = String(parsedId);
  const current = userConnectionCounts.get(key) ?? 0;
  const nextCount = Math.max(0, current - 1);

  if (nextCount === 0) {
    userConnectionCounts.delete(key);
    void persistPresence(parsedId, false);
  } else {
    userConnectionCounts.set(key, nextCount);
  }
}

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "https://test-socket-client-steel.vercel.app",
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    console.log("✅ User Connected:", socket.id, "user:", socket.user.id);
    socket.join(`user_${socket.user.id}`);
    socket.emit("auth-success", { user: socket.user });

    trackUserConnection(socket.user?.id);

    socket.on("disconnect", () => {
      releaseUserConnection(socket.user?.id);
    });

    registerChannelSockets(io, socket);
    registerMessageSockets(io, socket);
    registerConnectionHuddleSockets(io, socket);
  });

  return io;
}

