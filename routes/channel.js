const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");


// Get all channels
router.get("/", (req, res) => {
  db.query("SELECT * FROM channels", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

// Get messages for a specific channel
router.get("/:channelId/messages", (req, res) => {
  const { channelId } = req.params;
  db.query(
    "SELECT * FROM messages WHERE channel_id = ? ORDER BY id ASC LIMIT 50",
    [channelId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      res.json(rows);
    }
  );
});

// Get members of a specific channel
router.get("/:channelId/members", verifyToken,(req, res) => {
  const { channelId } = req.params;
  db.query(
    `SELECT u.id, u.username, u.email 
     FROM channel_members cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.channel_id = ?`,
    [channelId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      res.json(rows);
    }
  );
});

// Optionally, create a new channel
router.post("/", verifyToken, (req, res) => {
  const { name } = req.body;
  db.query("INSERT INTO channels (name) VALUES (?)", [name], (err, result) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json({ id: result.insertId, name });
  });
});

// Get channel info + members + last 50 messages
router.get("/:channelId", (req, res) => {
  const channelId = req.params.channelId;

  const sqlChannel = "SELECT * FROM channels WHERE id = ?";
  const sqlMessages =
    "SELECT * FROM messages WHERE channel_id = ? ORDER BY id ASC LIMIT 50";
  const sqlMembers = `
    SELECT u.id, u.username, u.email
    FROM channel_members cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.channel_id = ?
  `;

  const response = {};

  db.query(sqlChannel, [channelId], (err, channelRows) => {
    if (err) return res.status(500).json({ error: "DB Error" });

    if (channelRows.length === 0)
      return res.status(404).json({ error: "Channel not found" });

    response.channel = channelRows[0];

    db.query(sqlMessages, [channelId], (err, messages) => {
      if (err) return res.status(500).json({ error: "DB Error" });
      response.messages = messages;

      db.query(sqlMembers, [channelId], (err, members) => {
        if (err) return res.status(500).json({ error: "DB Error" });

        response.members = members;
        res.json(response);
      });
    });
  });
});




module.exports = router;
