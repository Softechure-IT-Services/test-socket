const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");

// Get all users
router.get("/", (req, res) => {
  db.query(
    "SELECT id, external_id, name, email, avatar_url, is_online, last_seen, created_at, updated_at FROM users",
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      res.json(rows);
    }
  );
});

// Get single user
router.get("/:userId", (req, res) => {
  const { userId } = req.params;

  db.query(
    "SELECT id, external_id, name, email, avatar_url, is_online, last_seen, created_at, updated_at FROM users WHERE id = ?",
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      res.json(rows[0]);
    }
  );
});

// Create user
router.post("/", verifyToken, (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid or missing JSON body" });
  }
  const { external_id, name, email, avatar_url } = body;

  const missing = [];
  // if (!external_id) missing.push("external_id");
  if (!name) missing.push("name");
  if (!email) missing.push("email");

  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }


  const query = `
    INSERT INTO users (external_id, name, email, avatar_url, is_online, last_seen, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, NOW(), NOW(), NOW())
  `;

  db.query(query, [external_id, name, email, avatar_url], (err, result) => {
    if (err) return res.status(500).json({ error: `DB error: ${err.message}` });

    res.json({
      id: result.insertId,
      external_id,
      name,
      email,
      avatar_url,
      is_online: 0,
      last_seen: new Date(),
    });
  });
});

// Update user
router.put("/:userId", verifyToken, (req, res) => {
  const { userId } = req.params;
  const { name, email, avatar_url } = req.body;

  const query = `
    UPDATE users SET 
      name = ?, 
      email = ?, 
      avatar_url = ?, 
      updated_at = NOW()
    WHERE id = ?
  `;

  db.query(query, [name, email, avatar_url, userId], (err) => {
    if (err) return res.status(500).json({ error: "DB Error" });

    res.json({
      id: userId,
      name,
      email,
      avatar_url,
    });
  });
});

// Set user online
router.post("/:userId/online", verifyToken, (req, res) => {
  const { userId } = req.params;

  db.query(
    "UPDATE users SET is_online = 1, last_seen = NOW(), updated_at = NOW() WHERE id = ?",
    [userId],
    (err) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      res.json({ id: userId, is_online: 1 });
    }
  );
});

// Set user offline
router.post("/:userId/offline", verifyToken, (req, res) => {
  const { userId } = req.params;

  db.query(
    "UPDATE users SET is_online = 0, last_seen = NOW(), updated_at = NOW() WHERE id = ?",
    [userId],
    (err) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      res.json({ id: userId, is_online: 0 });
    }
  );
});

// Get channels the user is in
router.get("/:userId/channels", (req, res) => {
  const { userId } = req.params;

  const query = `
    SELECT c.* 
    FROM channel_members cm
    JOIN channels c ON cm.channel_id = c.id
    WHERE cm.user_id = ?
  `;

  db.query(query, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

// Get messages the user sent
router.get("/:userId/messages", (req, res) => {
  const { userId } = req.params;

  const query = `
    SELECT * 
    FROM messages
    WHERE sender_id = ?
    ORDER BY created_at DESC
  `;

  db.query(query, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

module.exports = router;
