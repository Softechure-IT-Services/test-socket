import express from "express";
import verifyToken from "../middleware/auth.js";
import {
  getThreadReplies,
  getThreadCount,
  addThreadReply,
  getAllThreads,
} from "../controllers/thread.controller.js";

const router = express.Router();

// GET all THREADS
router.get("/", verifyToken, getAllThreads);

// GET all replies for a message (with sender user info)
router.get("/:messageId", verifyToken, getThreadReplies);

// GET reply count for a message (for the thread badge)
router.get("/:messageId/count", verifyToken, getThreadCount);

// POST add a reply
router.post("/:messageId", verifyToken, addThreadReply);

export default router;