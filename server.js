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
const uploadRoutes = require("./routes/upload");
const dmRoutes = require("./routes/dm");

const supabase = require("./utils/supabase");
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
  "https://test-socket-client-steel.vercel.app",
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
    origin: allowedOrigins, // only frontend domain
    credentials: true,
  },
  transports: ["websocket"], // force WebSocket
});



io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    console.log(socket);
    if (!cookieHeader) return next(new Error("Unauthorized1"));
    const cookies = cookie.parse(cookieHeader);

    const token = cookies.access_token;

    if (!token) return next(new Error("Unauthorized2"));

    // ✅ DB-based validation
    // const user = await verifyOpaqueToken(token);
    const user = verifyAccessToken(token);

    socket.user = { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url };

    console.log("✅ Socket authenticated:", socket.user.id);
    next();
  } catch (err) {
    console.error("❌ Socket auth error:", err.message);
    next(new Error("Unauthorized3"));
  }
});



io.on("connection", (socket) => {
  socket.emit("auth-success", {
   user: socket.user,
 });
  socket.on("joinChannel", ({ channel_id }) => {
    socket.join(`channel_${channel_id}`);
  });
  socket.on("leaveChannel", ({ channel_id }) => {
  socket.leave(`channel_${channel_id}`);
});

  console.log("User Connected:", socket.id, "user:", socket.user && socket.user.id);


  socket.on("sendMessage", ({ content, channel_id,files }) => {
if (!channel_id || (!content && (!files || !files.length))) return;
    const sender_id = socket.user.id;

    db.query(
      "INSERT INTO messages (`channel_id`, `sender_id`, `content`, `files`) VALUES (?, ?, ?, ?)",
      [channel_id, sender_id, content, JSON.stringify(files || [])],
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
          files: files || [],
          sender_id,
          sender_name: socket.user.name,
          sender_avatar_url: socket.user.avatar_url,
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

  // 1. Fetch message including files
  db.query(
    "SELECT sender_id, channel_id, files FROM messages WHERE id = ? LIMIT 1",
    [id],
    async (err, rows) => {
      if (err || !rows.length) return;
      if (String(rows[0].sender_id) !== String(userId)) return;

      const channel_id = rows[0].channel_id;

      // 2. Parse files JSON
      let files = [];
      try {
        files = JSON.parse(rows[0].files || "[]");
      } catch (e) {
        files = [];
      }

      // 3. Delete files from Supabase storage
      if (Array.isArray(files) && files.length > 0) {
        const paths = files
          .map((f) => f.path)
          .filter(Boolean);

        if (paths.length > 0) {
          const { error } = await supabase.storage
            .from("images")
            .remove(paths);

          if (error) {
            console.error("❌ Supabase delete error:", error);
            // We continue anyway to avoid zombie messages
          } else {
            console.log("🧹 Deleted files from storage:", paths);
          }
        }
      }

      // 4. Delete message from DB
      db.query("DELETE FROM messages WHERE id = ?", [id], (err2) => {
        if (err2) return;

        // 5. Notify clients
        io.to(`channel_${channel_id}`).emit("messageDeleted", { id });
      });
    }
  );
});



// Pin via socket
socket.on("pinMessage", ({ messageId, channel_id }) => {
  const userId = socket.user.id;
  if (!messageId || !channel_id) return;

  db.query(
    "SELECT is_private FROM channels WHERE id = ? LIMIT 1",
    [channel_id],
    (err, chRows) => {
      if (err || !chRows.length) return;

      const proceed = () => {
        db.query(
          "UPDATE messages SET pinned = 1 WHERE id = ? AND channel_id = ?",
          [messageId, channel_id],
          (err2) => {
            if (err2) return console.error("pinMessage db err", err2);

            io.to(`channel_${channel_id}`).emit("messagePinned", {
              messageId,
              pinned: true,
            });
          }
        );
      };

      if (chRows[0].is_private) {
        db.query(
          "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1",
          [channel_id, userId],
          (errm, memRows) => {
            if (errm || !memRows.length) return;
            proceed();
          }
        );
      } else {
        proceed();
      }
    }
  );
});


// Unpin via socket
socket.on("unpinMessage", ({ messageId, channel_id }) => {
  if (!messageId || !channel_id) return;

  db.query(
    "UPDATE messages SET pinned = 0 WHERE id = ? AND channel_id = ?",
    [messageId, channel_id],
    (err) => {
      if (err) return console.error("unpin db err", err);

      io.to(`channel_${channel_id}`).emit("messageUnpinned", {
        messageId,
        pinned: false,
      });
    }
  );
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
app.use("/upload", uploadRoutes);
app.use("/dm", dmRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("Server running on port", PORT));
