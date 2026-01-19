import express from "express";
import { searchAll } from "../controllers/search.controller.js";

const router = express.Router();

/*** GET /search?q=keyword ***/
router.get("/", searchAll);

export default router;



// import express from "express";
// import { PrismaClient } from "@prisma/client";

// const router = express.Router();
// const prisma = new PrismaClient();

// // GET /search?q=keyword
// router.get("/", async (req, res) => {
//   const { q } = req.query;

//   if (!q || q.trim() === "") {
//     return res.status(400).json({ error: "Query required" });
//   }

//   try {
//     const [users, channels, messages] = await Promise.all([
//       // USERS
//       prisma.users.findMany({
//         where: {
//           OR: [
//             { name: { contains: q } },
//             { email: { contains: q } },
//           ],
//         },
//         select: {
//           id: true,
//           name: true,
//           email: true,
//         },
//         take: 50,
//       }),

//       // CHANNELS
//       prisma.channels.findMany({
//         where: {
//           name: { contains: q },
//         },
//         select: {
//           id: true,
//           name: true,
//         },
//         take: 50,
//       }),

//       // MESSAGES
//       prisma.messages.findMany({
//         where: {
//           content: { contains: q },
//         },
//         select: {
//           id: true,
//           content: true,
//           channel_id: true,
//           sender_id: true,
//         },
//         take: 50,
//       }),
//     ]);

//     res.json({
//       users,
//       channels,
//       messages,
//     });
//   } catch (err) {
//     console.error("Search error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// export default router;



// import express from "express";
// import db from "../config/db.js";
// const router = express.Router();



// // GET /search?q=keyword
// router.get("/", (req, res) => {
//   const { q } = req.query;
//   if (!q || q.trim() === "") return res.status(400).json({ error: "Query required" });

//   const keyword = `%${q}%`; // for SQL LIKE

//   // Prepare queries for each table
//   const queries = {
//     users: "SELECT id, username, email FROM users WHERE username LIKE ? OR email LIKE ? LIMIT 50",
//     channels: "SELECT id, name FROM channels WHERE name LIKE ? LIMIT 50",
//     threads: "SELECT id, title, channel_id FROM threads WHERE title LIKE ? LIMIT 50",
//     messages: "SELECT id, content, channel_id, sender_id FROM messages WHERE content LIKE ? LIMIT 50",
//   };

//   // Run all queries in parallel
//   const promises = Object.entries(queries).map(
//     ([key, sql]) =>
//       new Promise((resolve, reject) => {
//         // messages and users may have 2 placeholders
//         const params = key === "users" ? [keyword, keyword] : [keyword];
//         db.query(sql, params, (err, rows) => {
//           if (err) return reject(err);
//           resolve([key, rows]);
//         });
//       })
//   );

//   Promise.all(promises)
//     .then(results => {
//       const response = {};
//       results.forEach(([key, rows]) => {
//         response[key] = rows;
//       });
//       res.json(response);
//     })
//     .catch(err => {
//       console.error(err);
//       res.status(500).json({ error: "DB Error" });
//     });
// });

// export default router;
