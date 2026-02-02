import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  getThreadReplies,
  addThreadReply,
} from "../controllers/thread.controller.js";

const router = express.Router();

/**
 * GET all replies for a message
 */
router.get("/:messageId", verifyToken, getThreadReplies);

/**
 * POST add a reply to a message
 */
router.post("/:messageId", verifyToken, addThreadReply);

export default router;



// import express from "express";
// import { PrismaClient } from "@prisma/client";
// import verifyToken from "../middleware/auth.js";

// const router = express.Router();
// const prisma = new PrismaClient();

// /**
//  * GET all replies (messages) for a parent message
//  */
// router.get("/:messageId", verifyToken, async (req, res) => {
//   const messageId = Number(req.params.messageId);

//   try {
//     const thread = await prisma.threads.findFirst({
//       where: {
//         parent_message_id: messageId,
//       },
//       include: {
//         messages: {
//           orderBy: {
//             created_at: "asc",
//           },
//         },
//       },
//     });

//     res.json(thread?.messages || []);
//   } catch (err) {
//     console.error("Fetch thread error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// /**
//  * POST add a reply to a message
//  */
// router.post("/:messageId", verifyToken, async (req, res) => {
//   const messageId = Number(req.params.messageId);
//   const sender_id = req.user.id; // ✅ always trust token
//   const { content } = req.body;

//   if (!content) {
//     return res.status(400).json({ error: "Content required" });
//   }

//   try {
//     // 1️⃣ Ensure thread exists
//     let thread = await prisma.threads.findFirst({
//       where: {
//         parent_message_id: messageId,
//       },
//     });

//     if (!thread) {
//       thread = await prisma.threads.create({
//         data: {
//           parent_message_id: messageId,
//         },
//       });
//     }

//     // 2️⃣ Create reply message
//     const reply = await prisma.messages.create({
//       data: {
//         content,
//         sender_id,
//         thread_parent_id: thread.id,
//       },
//     });

//     res.json(reply);
//   } catch (err) {
//     console.error("Create reply error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// export default router;





// // const express = require("express");
// // const router = express.Router();
// // const db = require("../db");
// // const verifyToken = require("../middleware/auth");


// import express from "express";
// const router = express.Router();
// import db from "../config/db.js";
// import verifyToken from "../middleware/auth.js";


// // Get all replies (threads) for a specific message
// router.get("/:messageId",verifyToken, (req, res) => {
//   const { messageId } = req.params;
//   const query = "SELECT * FROM threads WHERE message_id = ? ORDER BY created_at ASC";
//   db.query(query, [messageId], (err, rows) => {
//     if (err) return res.status(500).json({ error: "DB Error" });
//     res.json(rows);
//   });
// });

// // Add a new reply to a message
// router.post("/:messageId",verifyToken, (req, res) => {
//   const { messageId } = req.params;
//   const { sender_id, content } = req.body;
//   const query = "INSERT INTO threads (message_id, sender_id, content) VALUES (?, ?, ?)";
//   db.query(query, [messageId, sender_id, content], (err, result) => {
//     if (err) return res.status(500).json({ error: "DB Error" });
//     res.json({ id: result.insertId, message_id: messageId, sender_id, content });
//   });
// });

// export default router;
