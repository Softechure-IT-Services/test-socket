const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");

router.use(verifyToken);

/**
 * Create or get existing DM between two users
 */
router.post("/with/:otherUserId", async (req, res) => {
  const userId = req.user.id;
  const otherUserId = Number(req.params.otherUserId);

  if (!otherUserId || otherUserId === userId) {
    return res.status(400).json({ error: "Invalid user" });
  }

  try {
    // 1️⃣ Check if DM already exists
    const [rows] = await db.pool.query(
      `
      SELECT c.id
      FROM channels c
      JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = ?
      JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = ?
      WHERE c.is_dm = 1
      LIMIT 1
      `,
      [userId, otherUserId]
    );

    if (rows.length) {
      return res.json({ dm_id: rows[0].id });
    }

    // 2️⃣ Start transaction
    const connection = await db.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        "INSERT INTO channels (name, is_private, is_dm, created_by) VALUES (?, 1, 1, ?)",
        ["DM", userId]
      );

      const channelId = result.insertId;

      const members = [
        [channelId, userId],
        [channelId, otherUserId],
      ];

      await connection.query(
        "INSERT INTO channel_members (channel_id, user_id) VALUES ?",
        [members]
      );

      await connection.commit();
      connection.release();

      res.json({ dm_id: channelId });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    console.error("DM creation error:", err);
    res.status(500).json({ error: err.message });
  }
});



/**
 * List my DMs
 */
router.get("/", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const sql = `
      SELECT c.id, c.name, c.is_private, c.is_dm
      FROM channels c
      JOIN channel_members m ON m.channel_id = c.id
      WHERE m.user_id = ?
      AND ? = false OR c.is_dm = 0
      ORDER BY c.id DESC
    `;
    db.query(sql, [userId, req.query.get_dms === "true"], (err, rows) => {
      if (err) {
        console.error("Channels fetch error:", err);
        return res.status(500).json({ error: "DB Error" });
      }
      res.json(rows);
    });
  } catch (err) {
    console.error("Channels route error:", err);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
