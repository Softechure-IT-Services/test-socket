const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");

router.use(verifyToken);
// Get all channels
router.get("/", (req, res) => {
  const userId = req.user.id;

  const sql = `
    SELECT DISTINCT c.*
    FROM channels c
    LEFT JOIN channel_members cm 
      ON c.id = cm.channel_id AND cm.user_id = ?
    WHERE 
      c.is_private = 0
      OR cm.user_id IS NOT NULL
    ORDER BY c.created_at DESC
  `;

  db.query(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});


// Get messages for a specific channel
router.get("/:channelId/messages", (req, res) => {
  const { channelId } = req.params;

  const sql = `
    SELECT 
      m.id,
      m.channel_id,
      m.sender_id,
      m.content,
      m.created_at,
      m.updated_at,
      u.name AS sender_name,
      u.avatar_url
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.channel_id = ?
    ORDER BY m.id ASC
    LIMIT 50
  `;

  db.query(sql, [channelId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});


// Get members of a specific channel
router.get("/:channelId/members",(req, res) => {
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
router.post("/", (req, res) => {
  const { name, isPrivate, memberIds = [] } = req.body;
  const userId = req.user.id;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Channel name required" });
  }

  // ❌ Private channel must have members
  if (isPrivate && memberIds.length === 0) {
    return res
      .status(400)
      .json({ error: "Private channel needs members" });
  }

  db.beginTransaction((err) => {
    if (err) return res.status(500).json({ error: "Transaction error" });

    const insertChannelSql = `
      INSERT INTO channels (name, is_private, is_dm, created_by)
      VALUES (?, ?, 0, ?)
    `;

    db.query(
      insertChannelSql,
      [name.trim(), isPrivate ? 1 : 0, userId],
      (err, result) => {
        if (err) {
          return db.rollback(() =>
            res.status(500).json({ error: "Channel creation failed" })
          );
        }

        const channelId = result.insertId;

        // 🟢 PUBLIC CHANNEL → NO MEMBERS
        if (!isPrivate) {
          return db.commit(() => {
            res.status(201).json({
              id: channelId,
              name,
              isPrivate: false,
            });
          });
        }

        // 🔒 PRIVATE CHANNEL → ADD MEMBERS
        const uniqueMemberIds = Array.from(
          new Set([userId, ...memberIds])
        );

        const memberValues = uniqueMemberIds.map((uid) => [
          channelId,
          uid,
        ]);

        db.query(
          `INSERT INTO channel_members (channel_id, user_id) VALUES ?`,
          [memberValues],
          (err) => {
            if (err) {
              return db.rollback(() =>
                res.status(500).json({ error: "Adding members failed" })
              );
            }

            db.commit(() => {
              res.status(201).json({
                id: channelId,
                name,
                isPrivate: true,
                members: uniqueMemberIds,
              });
            });
          }
        );
      }
    );
  });
});

router.post("/:channelId/join", (req, res) => {
  const userId = req.user.id;
  const channelId = req.params.channelId;

  const checkSql = `
    SELECT is_private FROM channels WHERE id = ?
  `;

  db.query(checkSql, [channelId], (err, rows) => {
    if (err || !rows.length)
      return res.status(404).json({ error: "Channel not found" });

    if (rows[0].is_private) {
      return res
        .status(403)
        .json({ error: "Cannot join private channel" });
    }

    const joinSql = `
      INSERT IGNORE INTO channel_members (channel_id, user_id)
      VALUES (?, ?)
    `;

    db.query(joinSql, [channelId, userId], (err) => {
      if (err) return res.status(500).json({ error: "Join failed" });
      res.json({ success: true });
    });
  });
});


// Get channel info + members + last 50 messages
router.get("/:channelId", (req, res) => {
  const channelId = req.params.channelId;

  const sqlChannel = "SELECT * FROM channels WHERE id = ?";
  const sqlMessages =
    "SELECT * FROM messages WHERE channel_id = ? ORDER BY id ASC LIMIT 50";
  const sqlMembers = `
    SELECT u.id, u.name, u.email
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
        if (err) return res.status(500).json({ error: "DB Error2" });

        response.members = members;
        res.json(response);
      });
    });
  });
});




module.exports = router;
