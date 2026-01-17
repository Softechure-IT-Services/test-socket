// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");
// const cors = require("cors");
// const dotenv = require("dotenv");
// const db = require("./db");
// const channelRoutes = require("./routes/channel");
// const searchRouter = require("./routes/search");
// const threadsRouter = require("./routes/thread");
// const usersRouter = require("./routes/users");
// const authRouter = require("./routes/auth");
// const externalRouter = require("./routes/external");
// const uploadRoutes = require("./routes/upload");
// const dmRoutes = require("./routes/dm");

// const supabase = require("./utils/supabase");
// const cookieParser = require("cookie-parser");
// const cookie = require("cookie");
// const { verifyOpaqueToken } = require("./utils/tokenAuth");

// const { verifyAccessToken } = require("./utils/jwt");



import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import "dotenv/config";
import cookieParser from "cookie-parser";
import cookie from "cookie";

/* Database */
import db from "./config/db.js";

/* Routes */
// import channelRoutes from "./routes/channel.js";
// import searchRouter from "./routes/search.js";
// import threadsRouter from "./routes/thread.js";
// import usersRouter from "./routes/users.js";
// import authRouter from "./routes/auth.js";
// import externalRouter from "./routes/external.js";
// import uploadRoutes from "./routes/upload.js";
// import dmRoutes from "./routes/dm.js";


import {channelRoutes, searchRouter, threadsRouter, usersRouter, authRouter, externalRouter, uploadRoutes, dmRoutes} from "./routes/index.js";

/* Utils */
import supabase from "./utils/supabase.js";
// import { verifyOpaqueToken } from "../utils/tokenAuth.js";
import { verifyAccessToken } from "./utils/jwt.js";

import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
// import channelRoutes from "./routes/channel";
// import searchRouter from "./routes/search";
// import threadsRouter from "./routes/thread";
// import usersRouter from "./routes/users";
// import authRouter from "./routes/auth";
// import externalRouter from "./routes/external";
// import uploadRoutes from "./routes/upload";
// import dmRoutes from "./routes/dm";
import cookieParser from "cookie-parser";
import { initSocket } from "./sockets/index.js";


dotenv.config();
const app = express();
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:3000",
  "http://192.168.1.14:3000",
  "http://192.168.1.15:3000",
  "http://192.168.0.113:5000",
  "https://test-socket-client-steel.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: "https://test-socket-client-steel.vercel.app",
  credentials: true,
}));

app.use(express.json());

const server = http.createServer(app);
initSocket(server);

app.get("/", (req, res) => res.send("Socket.IO Chat Backend Running"));
// app.use("/channels", channelRoutes);
// app.use("/search", searchRouter);
// app.use("/users", usersRouter);
// app.use("/threads", threadsRouter);
// app.use("/auth", authRouter);
// app.use("/external", externalRouter);
// app.use("/upload", uploadRoutes);
// app.use("/dm", dmRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server running on port", PORT));
