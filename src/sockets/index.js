import { Server } from "socket.io";
import cookie from "cookie";

import socketAuthMiddleware from "./auth.middleware.js";
import registerChannelSockets from "./channel.socket.js";
import registerMessageSockets from "./message.socket.js";
import registerConnectionHuddleSockets from "./huddle.socket.js";
export let io;
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

    registerChannelSockets(io, socket);
    registerMessageSockets(io, socket);
    registerConnectionHuddleSockets(io, socket);
  });

  return io;
}

