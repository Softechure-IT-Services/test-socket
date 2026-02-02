import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import "dotenv/config";
import cookieParser from "cookie-parser";
import {channelRoutes, searchRouter, threadsRouter, usersRouter, authRouter, externalRouter, uploadRoutes, dmRoutes} from "./routes/index.js";
import { initSocket } from "./sockets/index.js";

dotenv.config();
const app = express();
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://192.168.1.14:3000",
  "http://192.168.1.15:3000",
  "http://192.168.0.113:5000",
  "https://test-socket-client-steel.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: process.env.NODE_ENV === "production" ? "https://test-socket-client-steel.vercel.app" : allowedOrigins,
  credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);
initSocket(server);

app.get("/", (req, res) => res.send("Socket.IO Chat Backend Running"));
app.use("/channels", channelRoutes);
app.use("/search", searchRouter);
app.use("/users", usersRouter);
app.use("/threads", threadsRouter);
app.use("/auth", authRouter);
app.use("/external", externalRouter);
app.use("/upload", uploadRoutes);
app.use("/dm", dmRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server running on port", PORT));