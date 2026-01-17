// const express = require("express");
// const router = express.Router();
// const db = require("../db");
// const verifyToken = require("../middleware/auth");


import express from "express";
const router = express.Router();
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";


// Get all replies (threads) for a specific message
router.get("/:messageId",verifyToken, (req, res) => {
  const { messageId } = req.params;
  const query = "SELECT * FROM threads WHERE message_id = ? ORDER BY created_at ASC";
  db.query(query, [messageId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

// Add a new reply to a message
router.post("/:messageId",verifyToken, (req, res) => {
  const { messageId } = req.params;
  const { sender_id, content } = req.body;
  const query = "INSERT INTO threads (message_id, sender_id, content) VALUES (?, ?, ?)";
  db.query(query, [messageId, sender_id, content], (err, result) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json({ id: result.insertId, message_id: messageId, sender_id, content });
  });
});

export default router;
