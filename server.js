const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const db = require("./db");
const channelRoutes = require("./routes/channel");
const searchRouter = require("./routes/search");
const threadsRouter = require("./routes/thread");
const usersRouter = require("./routes/users");
const authRouter = require("./routes/auth");
const externalRouter = require("./routes/external");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const { verifyOpaqueToken } = require("./utils/tokenAuth");

const { verifyAccessToken } = require("./utils/jwt");

dotenv.config();
const app = express();
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:3000",
  "http://192.168.1.14:3000",
  "http://192.168.1.15:3000",
  "http://192.168.0.113:5000",
  "https://test-socket-client-steel.vercel.app/",
  process.env.CLIENT_URL,
].filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

const server = http.createServer(app);

// const io = new Server(server, {
//   cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
//   path: "/socket.io",    
// });

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});


io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return next(new Error("Unauthorized"));

    const cookies = cookie.parse(cookieHeader);
    const token = cookies.access_token;

    if (!token) return next(new Error("Unauthorized"));

    // ✅ DB-based validation
    // const user = await verifyOpaqueToken(token);
    const user = verifyAccessToken(token);

    socket.user = { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url };

    console.log("✅ Socket authenticated:", socket.user.id);
    next();
  } catch (err) {
    console.error("❌ Socket auth error:", err.message);
    next(new Error("Unauthorized"));
  }
});



io.on("connection", (socket) => {
  socket.emit("auth-success", {
   user: socket.user,
 });
  socket.on("joinChannel", ({ channelId }) => {
    socket.join(`channel_${channelId}`);
  });
  socket.on("leaveChannel", ({ channel_id }) => {
  socket.leave(`channel_${channel_id}`);
});

  console.log("User Connected:", socket.id, "user:", socket.user && socket.user.id);


  socket.on("sendMessage", ({ content, channel_id }) => {
    if (!channel_id || !content) return;
    const sender_id = socket.user.id;

    db.query(
      "INSERT INTO messages (`channel_id`, `sender_id`, `content`) VALUES (?, ?, ?)",
      [channel_id, sender_id, content],
      (err, result) => {
        if (err) {
          console.error("DB insert error:", err);
          socket.emit("messageError", { error: err.message });
          return;
        }
        const payload = {
          id: result.insertId,
          channel_id,
          content,
          sender_id,
          created_at: new Date().toISOString(),
        };
        // emit to that channel room
        io.to(`channel_${channel_id}`).emit("receiveMessage", payload);
        socket.emit("messageAck", payload);
      }
    );
  });

 socket.on("reactMessage", ({ messageId, emoji }) => {
    if (!messageId || !emoji) return;

    // fetch message to get channel_id and reactions
    db.query("SELECT channel_id, reactions FROM messages WHERE id = ? LIMIT 1", [messageId], (err, rows) => {
      if (err || !rows.length) {
        console.error("reactMessage - DB error or not found", err);
        return;
      }
      const channel_id = rows[0].channel_id;
      let reactions = [];
      try {
        reactions = JSON.parse(rows[0].reactions || "[]");
      } catch (e) {
        reactions = [];
      }

      // ensure users array exists, and modify reactions using server-side user id
      const userId = socket.user.id;
      let entry = reactions.find((r) => r.emoji === emoji);

      if (entry) {
        const users = Array.isArray(entry.users) ? entry.users : [];
        const hasReacted = users.includes(String(userId));

        if (hasReacted) {
          const newUsers = users.filter((u) => String(u) !== String(userId));
          if (newUsers.length === 0) {
            reactions = reactions.filter((r) => r.emoji !== emoji);
          } else {
            entry.users = newUsers;
            entry.count = newUsers.length;
          }
        } else {
          const newUsers = [...users, String(userId)];
          entry.users = newUsers;
          entry.count = newUsers.length;
        }
      } else {
        reactions.push({
          emoji,
          count: 1,
          users: [String(userId)],
        });
      }

      db.query("UPDATE messages SET reactions = ? WHERE id = ?", [JSON.stringify(reactions), messageId], (err2) => {
        if (err2) {
          console.error("Failed to save reactions:", err2);
          return;
        }
        // Emit only to the channel room
        io.to(`channel_${channel_id}`).emit("reactionUpdated", {
          messageId,
          reactions,
        });
      });
    });
  });


  socket.on("editMessage", ({ messageId, content, channel_id }) => {
    if (!messageId || !channel_id || !content) return;
    const editorId = socket.user.id;
    db.query(
      "SELECT sender_id FROM messages WHERE id = ? AND channel_id = ? LIMIT 1",
      [messageId, channel_id],
      (err, rows) => {
        if (err || !rows.length) return;
        if (String(rows[0].sender_id) !== String(editorId)) return; // only author can edit

        db.query(
          "UPDATE messages SET content = ?, updated_at = NOW() WHERE id = ? AND channel_id = ?",
          [content, messageId, channel_id],
          (err2) => {
            if (err2) {
              console.error("Edit save error:", err2);
              return;
            }
            const payload = {
              id: messageId,
              content,
              channel_id,
              updated_at: new Date().toISOString(),
            };
            io.to(`channel_${channel_id}`).emit("messageEdited", payload);
          }
        );
      }
    );
  });


  socket.on("deleteMessage", ({ id }) => {
    if (!id) return;
    const userId = socket.user.id;
    // verify ownership before deleting
    db.query("SELECT sender_id, channel_id FROM messages WHERE id = ? LIMIT 1", [id], (err, rows) => {
      if (err || !rows.length) return;
      if (String(rows[0].sender_id) !== String(userId)) return;
      const channel_id = rows[0].channel_id;
      db.query("DELETE FROM messages WHERE id = ?", [id], (err2) => {
        if (err2) return;
        io.to(`channel_${channel_id}`).emit("messageDeleted", { id });
      });
    });
  });

  socket.on("disconnect", () => console.log("User disconnected:", socket.id));
});

// simple API routes
app.get("/", (req, res) => res.send("Socket.IO Chat Backend Running"));

app.get("/messages", (req, res) => {
  // res.send( "This endpoint is under construction." );
  db.query("SELECT * FROM messages ORDER BY id ASC LIMIT 50", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

app.use("/test", (req, res) => {
  res.send("Test route working");
});

app.use("/channels", channelRoutes);
app.use("/search", searchRouter);
app.use("/users", usersRouter);
app.use("/threads", threadsRouter);
app.use("/auth", authRouter);
app.use("/external", externalRouter);
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server running on port", PORT));
