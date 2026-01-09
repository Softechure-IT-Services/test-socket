const express = require("express");
const router = express.Router();
const db = require("../db");
const verifyToken = require("../middleware/auth");

router.use(verifyToken);
// Get all channels
router.get("/", (req, res) => {
  const userId = req.user.id;

  const getDms = req.query.get_dms !== "false"; // default true

  let sql = `
    SELECT DISTINCT c.*
    FROM channels c
    LEFT JOIN channel_members cm 
      ON c.id = cm.channel_id AND cm.user_id = ?
    WHERE 
      (c.is_private = 0 OR cm.user_id IS NOT NULL)
  `;

  const params = [userId];

  // ✅ If get_dms=false → exclude DM channels
  if (!getDms) {
    sql += ` AND c.is_dm = 0 `;
  }

  sql += ` ORDER BY c.created_at DESC `;

  db.query(sql, params, (err, rows) => {
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
      m.files,
      m.created_at,
      m.updated_at,
      m.pinned,
      m.reactions,
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
// router.get("/:channelId", (req, res) => {
//   const channelId = req.params.channelId;

//   const sqlChannel = "SELECT * FROM channels WHERE id = ?";
//   const sqlMessages =
//     "SELECT * FROM messages WHERE channel_id = ? ORDER BY id ASC LIMIT 50";
//   const sqlMembers = `
//     SELECT u.id, u.name, u.email
//     FROM channel_members cm
//     JOIN users u ON cm.user_id = u.id
//     WHERE cm.channel_id = ?
//   `;

//   const response = {};

//   db.query(sqlChannel, [channelId], (err, channelRows) => {
//     if (err) return res.status(500).json({ error: "DB Error" });

//     if (channelRows.length === 0)
//       return res.status(404).json({ error: "Channel not found" });

//     response.channel = channelRows[0];

//     db.query(sqlMessages, [channelId], (err, messages) => {
//       if (err) return res.status(500).json({ error: "DB Error" });
//       response.messages = messages;

//       db.query(sqlMembers, [channelId], (err, members) => {
//         if (err) return res.status(500).json({ error: "DB Error2" });

//         response.members = members;
//         res.json(response);
//       });
//     });
//   });
// });

router.get("/:id", verifyToken, (req, res) => {
  const channelId = req.params.id;
  const userId = req.user.id;

  db.query("SELECT * FROM channels WHERE id = ? LIMIT 1", [channelId], (err, rows) => {
    if (err || !rows.length) return res.status(404).json({ error: "Not found" });

    const channel = rows[0];

    // If DM → get other user
    if (channel.is_dm) {
      db.query(
        `
        SELECT u.id, u.name, u.avatar_url
        FROM channel_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = ? AND cm.user_id != ?
        LIMIT 1
        `,
        [channelId, userId],
        (err2, userRows) => {
          if (err2 || !userRows.length) {
            return res.json({ channel });
          }

          return res.json({
            channel,
            dm_user: userRows[0], // 👈 IMPORTANT
          });
        }
      );
    } else {
      // Normal channel → return members
      db.query(
        `
        SELECT u.id, u.name, u.email
        FROM channel_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = ?
        `,
        [channelId],
        (err2, members) => {
          if (err2) return res.status(500).json({ error: "DB Error" });

          res.json({ channel, members });
        }
      );
    }
  });
});


// Pin a message (REST)
router.post("/:channelId/pin/:messageId", (req, res) => {
  const { channelId, messageId } = req.params;
  const userId = req.user.id;

  // Check channel and membership if private
  db.query("SELECT is_private, created_by FROM channels WHERE id = ? LIMIT 1", [channelId], (err, chRows) => {
    if (err || !chRows.length) return res.status(404).json({ error: "Channel not found" });
    const channel = chRows[0];

    const proceed = () => {
      // Ensure message exists and not already pinned
      db.query("SELECT pinned FROM messages WHERE id = ? AND channel_id = ? LIMIT 1", [messageId, channelId], (err2, msgRows) => {
        if (err2 || !msgRows.length) return res.status(404).json({ error: "Message not found" });
        if (msgRows[0].pinned) return res.status(400).json({ error: "Message already pinned" });

        db.query("UPDATE messages SET pinned = 1, pinned_by = ?, pinned_at = NOW() WHERE id = ? AND channel_id = ?", [userId, messageId, channelId], (err3) => {
          if (err3) return res.status(500).json({ error: "DB Error" });
          res.json({ success: true });
        });
      });
    };

    if (channel.is_private) {
      // verify membership
      db.query("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1", [channelId, userId], (errm, memRows) => {
        if (errm) return res.status(500).json({ error: "DB Error" });
        if (!memRows.length) return res.status(403).json({ error: "Not a channel member" });
        proceed();
      });
    } else {
      proceed();
    }
  });
});

// Unpin a message (REST)
router.delete("/:channelId/pin/:messageId", (req, res) => {
  const { channelId, messageId } = req.params;
  const userId = req.user.id;

  // fetch message to check pinned_by and channel creator
  const sql = `
    SELECT m.pinned, m.pinned_by, c.created_by
    FROM messages m
    JOIN channels c ON c.id = ?
    WHERE m.id = ? AND m.channel_id = ? LIMIT 1
  `;
  db.query(sql, [channelId, messageId, channelId], (err, rows) => {
    if (err || !rows.length) return res.status(404).json({ error: "Message or channel not found" });
    const row = rows[0];
    if (!row.pinned) return res.status(400).json({ error: "Message is not pinned" });

    // Only the user who pinned OR channel creator can unpin
    if (String(row.pinned_by) !== String(userId) && String(row.created_by) !== String(userId)) {
      return res.status(403).json({ error: "Not allowed to unpin" });
    }

    db.query("UPDATE messages SET pinned = 0, pinned_by = NULL, pinned_at = NULL WHERE id = ? AND channel_id = ?", [messageId, channelId], (err2) => {
      if (err2) return res.status(500).json({ error: "DB Error" });
      res.json({ success: true });
    });
  });
});

// List pinned messages for a channel (REST)
router.get("/:channelId/pins", (req, res) => {
  const { channelId } = req.params;

  const sql = `
    SELECT
      m.id,
      m.content,
      m.sender_id,
      u.name AS sender_name,
      u.avatar_url,
      m.pinned_by,
      p.name AS pinner_name,
      m.pinned_at
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN users p ON p.id = m.pinned_by
    WHERE m.channel_id = ? AND m.pinned = 1
    ORDER BY m.pinned_at DESC
  `;
  db.query(sql, [channelId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});



module.exports = router;
