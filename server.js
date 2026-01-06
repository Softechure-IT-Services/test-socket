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

const jwt = require("jsonwebtoken");

// New
const path = require("path");
// New End

const { verifyAccessToken } = require("./utils/jwt");
const { log } = require("console");

dotenv.config();
const app = express();


app.use(express.static(path.join(__dirname, "public")));

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

// Store user data
const users = new Map();


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
    next(new Error("Unauthorized xsd"));
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


// Pin via socket
socket.on("pinMessage", ({ messageId, channel_id }) => {
  const userId = socket.user.id;
  if (!messageId || !channel_id) return;

  // Check channel and membership if private
  db.query("SELECT is_private FROM channels WHERE id = ? LIMIT 1", [channel_id], (err, chRows) => {
    if (err || !chRows.length) return;
    const channel = chRows[0];

    const proceed = () => {
      // Ensure message exists and not already pinned
      db.query("SELECT pinned FROM messages WHERE id = ? AND channel_id = ? LIMIT 1", [messageId, channel_id], (err2, msgRows) => {
        if (err2 || !msgRows.length) return;
        if (msgRows[0].pinned) return;

        db.query("UPDATE messages SET pinned = 1, pinned_by = ?, pinned_at = NOW() WHERE id = ? AND channel_id = ?", [userId, messageId, channel_id], (err3) => {
          if (err3) return console.error("pinMessage db err", err3);
          io.to(`channel_${channel_id}`).emit("messagePinned", {
            messageId,
            channel_id,
            pinned_by: userId,
            pinned_at: new Date().toISOString(),
          });
        });
      });
    };

    if (channel.is_private) {
      db.query("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1", [channel_id, userId], (errm, memRows) => {
        if (errm || !memRows.length) return;
        proceed();
      });
    } else {
      proceed();
    }
  });
});

// Unpin via socket
socket.on("unpinMessage", ({ messageId, channel_id }) => {
  const userId = socket.user.id;
  if (!messageId || !channel_id) return;

  // fetch message and channel creator
  const sql = `
    SELECT m.pinned, m.pinned_by, c.created_by
    FROM messages m
    JOIN channels c ON c.id = ?
    WHERE m.id = ? AND m.channel_id = ? LIMIT 1
  `;
  db.query(sql, [channel_id, messageId, channel_id], (err, rows) => {
    if (err || !rows.length) return;
    const row = rows[0];
    if (!row.pinned) return;

    if (String(row.pinned_by) !== String(userId) && String(row.created_by) !== String(userId)) {
      // not allowed
      return;
    }

    db.query("UPDATE messages SET pinned = 0, pinned_by = NULL, pinned_at = NULL WHERE id = ? AND channel_id = ?", [messageId, channel_id], (err2) => {
      if (err2) return console.error("unpin db err", err2);
      io.to(`channel_${channel_id}`).emit("messageUnpinned", {
        messageId,
        channel_id,
      });
    });
  });
});



  socket.on("disconnect", () => console.log("User disconnected:", socket.id));



  // New
   console.log(`User connected: ${socket.id}`);
  
  // Initialize user
  users.set(socket.id, {
    id: socket.id,
    username: null,
    inCall: false,
    room: null
  });

  // Set username
  socket.on("set-username", username => {
    const user = users.get(socket.id);
    if (user) {
      user.username = username;
      broadcastUserList();
    }
  });

  // Update call status
  socket.on("update-call-status", inCall => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = inCall;
      broadcastUserList();
    }
  });

  // Call user
  socket.on("call-user", ({ to, roomId, callerName }) => {
    const targetUser = users.get(to);
    if (targetUser && !targetUser.inCall) {
      io.to(to).emit("incoming-call", {
        from: socket.id,
        roomId,
        callerName
      });
    } else if (targetUser && targetUser.inCall) {
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
  socket.on("join-room", roomId => {
    const user = users.get(socket.id);
    if (user) {
      user.room = roomId;
      user.inCall = true;
    }

    socket.join(roomId);
    
    // Get existing users in room with their usernames
    const roomUsers = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
      .filter(id => id !== socket.id)
      .map(id => {
        const userData = users.get(id);
        return {
          id,
          username: userData?.username || "Anonymous"
        };
      });

    // Send existing users to the new joiner
    socket.emit("existing-users", roomUsers);
    
    // Notify others in the room
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      username: user?.username || "Anonymous"
    });

    broadcastUserList();
  });

  // WebRTC signaling
  socket.on("offer", ({ to, offer }) => {
    const user = users.get(socket.id);
    io.to(to).emit("offer", {
      from: socket.id,
      offer,
      username: user?.username || "Anonymous"
    });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("icecandidate", ({ to, candidate }) => {
    io.to(to).emit("icecandidate", {
      from: socket.id,
      candidate
    });
  });

  // Screen share status
  socket.on("screen-share-status", ({ roomId, sharing }) => {
    socket.to(roomId).emit("peer-screen-share-status", {
      userId: socket.id,
      sharing
    });
  });

  // Audio track updated
  socket.on("audio-track-updated", ({ roomId }) => {
    console.log(`User ${socket.id} updated audio track in room ${roomId}`);
    socket.to(roomId).emit("peer-audio-updated", {
      from: socket.id
    });
  });

  // Leave room
  socket.on("leave-room", roomId => {
    const user = users.get(socket.id);
    if (user) {
      user.inCall = false;
      user.room = null;
    }

    socket.leave(roomId);
    socket.to(roomId).emit("user-left", socket.id);
    broadcastUserList();
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const user = users.get(socket.id);
    if (user && user.room) {
      socket.to(user.room).emit("user-left", socket.id);
    }

    users.delete(socket.id);
    broadcastUserList();
  });

  // Broadcast updated user list
  function broadcastUserList() {
    const userList = Array.from(users.values()).map(user => ({
      id: user.id,
      username: user.username,
      inCall: user.inCall
    }));
    io.emit("update-user-list", userList);
  }

  // Send initial user list
  broadcastUserList();
  // New End
});

// simple API routes
app.get("/", (req, res) => res.send("Socket.IO Chat Backend Running"));



app.get("/huddle", (req, res) => {
  const { meeting_id, user_id, channel_id } = req.query;

  // Get user
  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  db.query(
  "SELECT * FROM users WHERE id = ? LIMIT 1",
  [user_id],
  (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "DB Error" });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    user = rows[0];

    res.json(user); // return single user
  } 
);
 
  res.sendFile(path.join(__dirname, "app", "index.html"));
});


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
