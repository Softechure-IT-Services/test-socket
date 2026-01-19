import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  createOrGetDM,
  listMyDMs,
} from "../controllers/dm.controller.js";

const router = express.Router();
router.use(verifyToken);

router.post("/with/:otherUserId", createOrGetDM);


router.get("/", listMyDMs);

export default router;



// import express from "express";
// import { PrismaClient } from "@prisma/client";
// // import verifyToken from "../middleware/auth.js";

// const router = express.Router();
// const prisma = new PrismaClient();

// // router.use(verifyToken);

// /**
//  * Create or get existing DM between two users
//  */
// router.post("/with/:otherUserId", async (req, res) => {
//   const userId = 87;
//   const otherUserId = Number(req.params.otherUserId);

//   if (!otherUserId || otherUserId === userId) {
//     return res.status(400).json({ error: "Invalid user" });
//   }

//   try {
//     // 1️⃣ Check if DM already exists
//     const existingDM = await prisma.channels.findFirst({
//       where: {
//         is_dm: true,
//         channel_members: {
//           every: {
//             user_id: {
//               in: [userId, otherUserId],
//             },
//           },
//         },
//       },
//       select: { id: true },
//     });

//     if (existingDM) {
//       return res.json({ dm_id: existingDM.id });
//     }

//     // 2️⃣ Create DM + members in a transaction
//     const dmChannel = await prisma.$transaction(async (tx) => {
//       const channel = await tx.channels.create({
//         data: {
//           name: "DM",
//           is_private: true,
//           is_dm: true,
//           created_by: userId,
//           channel_members: {
//             create: [
//               { user_id: userId },
//               { user_id: otherUserId },
//             ],
//           },
//         },
//         select: { id: true },
//       });

//       return channel;
//     });

//     res.json({ dm_id: dmChannel.id });
//   } catch (err) {
//     console.error("DM creation error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * List my DMs
//  */
// router.get("/", async (req, res) => {
//   const userId = 87;
//   if (!userId) return res.status(401).json({ error: "Unauthorized" });

//   try {
//     const dms = await prisma.channels.findMany({
//       where: {
//         is_dm: true,
//         channel_members: {
//           some: {
//             user_id: userId,
//           },
//         },
//       },
//       orderBy: { id: "desc" },
//       select: {
//         id: true,
//         is_private: true,
//         is_dm: true,
//         channel_members: {
//           where: {
//             user_id: { not: userId },
//           },
//           select: {
//             users: {
//               select: {
//                 id: true,
//                 name: true,
//                 avatar_url: true,
//               },
//             },
//           },
//         },
//       },
//     });

//     // Flatten result to match your previous SQL response
//     const result = dms.map((dm) => {
//       const otherUser = dm.channel_members[0]?.users;
//       return {
//         id: dm.id,
//         other_user_id: otherUser?.id,
//         name: otherUser?.name,
//         avatar_url: otherUser?.avatar_url,
//         is_private: dm.is_private,
//         is_dm: dm.is_dm,
//       };
//     });

//     res.json(result);
//   } catch (err) {
//     console.error("DM fetch error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// export default router;


// import express from "express";
// const router = express.Router();
// import db from "../config/db.js";
// import verifyToken from "../middleware/auth.js";

// router.use(verifyToken);

// /**
//  * Create or get existing DM between two users
//  */
// router.post("/with/:otherUserId", async (req, res) => {
//   const userId = req.user.id;
//   const otherUserId = Number(req.params.otherUserId);

//   if (!otherUserId || otherUserId === userId) {
//     return res.status(400).json({ error: "Invalid user" });
//   }

//   try {
//     // 1️⃣ Check if DM already exists
//     const [rows] = await db.pool.query(
//       `
//       SELECT c.id
//       FROM channels c
//       JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = ?
//       JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = ?
//       WHERE c.is_dm = 1
//       LIMIT 1
//       `,
//       [userId, otherUserId]
//     );

//     if (rows.length) {
//       return res.json({ dm_id: rows[0].id });
//     }

//     // 2️⃣ Start transaction
//     const connection = await db.pool.getConnection();
//     try {
//       await connection.beginTransaction();

//       const [result] = await connection.query(
//         "INSERT INTO channels (name, is_private, is_dm, created_by) VALUES (?, 1, 1, ?)",
//         ["DM", userId]
//       );

//       const channelId = result.insertId;

//       const members = [
//         [channelId, userId],
//         [channelId, otherUserId],
//       ];

//       await connection.query(
//         "INSERT INTO channel_members (channel_id, user_id) VALUES ?",
//         [members]
//       );

//       await connection.commit();
//       connection.release();

//       res.json({ dm_id: channelId });
//     } catch (err) {
//       await connection.rollback();
//       connection.release();
//       throw err;
//     }
//   } catch (err) {
//     console.error("DM creation error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });



// /**
//  * List my DMs
//  */
// router.get("/", async (req, res) => {
//   const userId = req.user?.id;
//   if (!userId) return res.status(401).json({ error: "Unauthorized" });

//   try {
//     const sql = `
//       SELECT 
//         c.id,
//         u.id AS other_user_id,
//         u.name AS name,          -- 👈 THIS becomes the channel "name"
//         u.avatar_url,
//         c.is_private,
//         c.is_dm
//       FROM channels c
//       JOIN channel_members me 
//         ON me.channel_id = c.id AND me.user_id = ?
//       JOIN channel_members other 
//         ON other.channel_id = c.id AND other.user_id != ?
//       JOIN users u 
//         ON u.id = other.user_id
//       WHERE c.is_dm = 1
//       ORDER BY c.id DESC
//     `;

//     db.query(sql, [userId, userId], (err, rows) => {
//       if (err) {
//         console.error("DM fetch error:", err);
//         return res.status(500).json({ error: "DB Error" });
//       }
//       res.json(rows);
//     });
//   } catch (err) {
//     console.error("DM route error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });




// export default router;
