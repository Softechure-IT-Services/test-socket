import { Server } from "socket.io";

import prisma from "../config/prisma.js";
import socketAuthMiddleware from "./auth.middleware.js";
import registerChannelSockets from "./channel.socket.js";
import registerMessageSockets from "./message.socket.js";
import registerConnectionHuddleSockets from "./huddleSocket.js";
import {
  buildPresenceEventPayload,
  getStoredPreferencesForUser,
} from "../utils/userPreferences.js";

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
      const preferences = await getStoredPreferencesForUser(user.id);
      io.emit(
        "userPresenceChanged",
        buildPresenceEventPayload({
          userId: user.id,
          isOnline: user.is_online,
          lastSeen: user.last_seen,
          privacyPreferences: preferences.privacyPreferences,
        })
      );
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
      origin: [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://192.168.1.14:3000",
        "http://192.168.1.15:3000",
        "http://192.168.0.113:5000",
        "https://softechat.vercel.app",
        "https://test-socket-client-steel.vercel.app",
      ],
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    const isGuest = !!socket.user?.guest;
    console.log("✅ User Connected:", socket.id, "user:", isGuest ? "guest" : socket.user?.id);

    if (!isGuest && socket.user?.id != null) {
      socket.join(`user_${socket.user.id}`);
      socket.emit("auth-success", { user: socket.user });

      trackUserConnection(socket.user?.id);

      socket.on("disconnect", () => {
        releaseUserConnection(socket.user?.id);
      });

      registerChannelSockets(io, socket);
      registerMessageSockets(io, socket);
    }

    registerConnectionHuddleSockets(io, socket);

    if (!isGuest) {
      // ── Keep socket.user fresh after profile updates ──────────────────────
      // The client emits this right after a successful profile save so that
      // subsequent messages use the correct name/avatar without a reconnect.
      socket.on("refreshUserProfile", async () => {
        try {
          const fresh = await prisma.users.findUnique({
            where: { id: socket.user.id },
            select: { id: true, name: true, username: true, email: true, avatar_url: true, status: true },
          });
          if (fresh) {
            socket.user.name       = fresh.name;
            socket.user.username   = fresh.username;
            socket.user.avatar_url = fresh.avatar_url;
            socket.user.email      = fresh.email;
            socket.user.status     = fresh.status;
            // Echo the updated profile back so the client can update its auth context
            socket.emit("userProfileRefreshed", fresh);
          }
        } catch (err) {
          console.error("refreshUserProfile error:", err.message);
        }
      });
    }
  });

  return io;
}
