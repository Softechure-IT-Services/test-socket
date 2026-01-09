const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");

router.use(verifyToken);

/**
 * Create or get existing DM between two users
 */
router.post("/with/:otherUserId", (req, res) => {
  const userId = req.user.id;
  const otherUserId = Number(req.params.otherUserId);

  if (!otherUserId || otherUserId === userId) {
    return res.status(400).json({ error: "Invalid user" });
  }

  // 1️⃣ Check if DM already exists
  const checkSql = `
    SELECT c.id
    FROM channels c
    JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = ?
    JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = ?
    WHERE c.is_dm = 1
    LIMIT 1
  `;

  db.query(checkSql, [userId, otherUserId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });

    if (rows.length) {
      // ✅ DM already exists
      return res.json({ dm_id: rows[0].id });
    }

    // 2️⃣ Create new DM channel
    db.beginTransaction((err) => {
      if (err) return res.status(500).json({ error: "Transaction error" });

      db.query(
        "INSERT INTO channels (name, is_private, is_dm, created_by) VALUES (?, 1, 1, ?)",
        ["DM", userId],
        (err2, result) => {
          if (err2) {
            return db.rollback(() => res.status(500).json({ error: "Create DM failed" }));
          }

          const channelId = result.insertId;

          const members = [
            [channelId, userId],
            [channelId, otherUserId],
          ];

          db.query(
            "INSERT INTO channel_members (channel_id, user_id) VALUES ?",
            [members],
            (err3) => {
              if (err3) {
                return db.rollback(() => res.status(500).json({ error: "Add members failed" }));
              }

              db.commit(() => {
                res.json({ dm_id: channelId });
              });
            }
          );
        }
      );
    });
  });
});

/**
 * List my DMs
 */
router.get("/", (req, res) => {

  // console.log(req.headers.cookie);

  const userId = req.user.id;

  const sql = `
    SELECT c.id, u.id as other_user_id, u.name, u.avatar_url
    FROM channels c
    JOIN channel_members me ON me.channel_id = c.id AND me.user_id = ?
    JOIN channel_members other ON other.channel_id = c.id AND other.user_id != ?
    JOIN users u ON u.id = other.user_id
    WHERE c.is_dm = 1
    ORDER BY c.id DESC
  `;

  db.query(sql, [userId, userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

module.exports = router;
