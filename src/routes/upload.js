
import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import supabase from "../utils/supabase.js";
const router = express.Router();

/* ---------- SECURITY ---------- */
// Mirrors the bucket policy: image/*, application/pdf, video/*
const isAllowedMime = (mime) =>
  mime.startsWith("image/") ||
  mime.startsWith("video/") ||
  mime === "application/pdf";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter(req, file, cb) {
    if (!isAllowedMime(file.mimetype)) {
      cb(new Error("File type not allowed"));
    } else {
      cb(null, true);
    }
  },
});

/* ---------- UPLOAD ---------- */
router.post("/", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const uploaded = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const randomName = crypto.randomUUID() + ext;
      const filePath = `chat/${Date.now()}-${randomName}`;

      const { error } = await supabase.storage
        .from("all files")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({ error: error.message });
      }

      const { data: signed } = await supabase.storage
        .from("all files")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7);

      uploaded.push({
        name: file.originalname,
        path: filePath,
        type: file.mimetype,
        size: file.size,
        url: signed.signedUrl,
      });
    }

    return res.json({
      success: true,
      files: uploaded,
    });
  } catch (err) {
    console.error("Upload crash:", err);
    res.status(500).json({ error: err.message });
  }
});


/* ---------- DELETE ---------- */
router.post("/delete", async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({ error: "File path required" });
    }

    const { error } = await supabase.storage
      .from("all files")
      .remove([path]);

    if (error) {
      console.error("Supabase delete error:", error);
      return res.status(500).json({ error: "Delete failed" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete crash:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
