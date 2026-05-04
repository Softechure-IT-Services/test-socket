
import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import prisma from "../config/prisma.js";
import verifyToken from "../middleware/auth.js";
import supabaseAdmin, { createStorageClientForUser } from "../utils/supabase.js";
const router = express.Router();
const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || "all files";
const DEBUG_SUPABASE_STORAGE = process.env.DEBUG_SUPABASE_STORAGE === "true";

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

router.use(verifyToken);

const parseChannelIdFromPath = (filePath) => {
  const parts = String(filePath || "").split("/");
  if (parts.length < 4) return null;
  if (parts[0] !== "channel") return null;

  const channelId = Number(parts[1]);
  const ownerId = Number(parts[2]);
  if (!Number.isInteger(channelId) || !Number.isInteger(ownerId)) return null;

  return { channelId, ownerId };
};

const canAccessChannel = async (channelId, userId) => {
  const channel = await prisma.channels.findUnique({
    where: { id: channelId },
    select: { id: true, is_private: true },
  });
  if (!channel) return false;

  const hasLeft = await prisma.channel_left.findUnique({
    where: { channel_id_user_id: { channel_id: channelId, user_id: userId } },
    select: { id: true },
  });
  if (hasLeft) return false;

  if (channel.is_private) {
    const isMember = await prisma.channel_members.findUnique({
      where: { channel_id_user_id: { channel_id: channelId, user_id: userId } },
      select: { id: true },
    });
    return Boolean(isMember);
  }

  return true;
};

/* ---------- UPLOAD ---------- */
router.post("/", upload.array("files", 10), async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const channelId = Number(req.body?.channelId);
    if (!Number.isInteger(channelId)) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const allowed = await canAccessChannel(channelId, userId);
    if (!allowed) {
      return res.status(403).json({ error: "You are not allowed to upload in this channel" });
    }

    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (DEBUG_SUPABASE_STORAGE) {
      console.log("[upload] starting upload", {
        userId,
        channelId,
        bucket: BUCKET_NAME,
        fileCount: req.files.length,
        fileNames: req.files.map((file) => file.originalname),
      });
    }

    const supabase = supabaseAdmin;
    const uploaded = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const randomName = crypto.randomUUID() + ext;
      const filePath = `channel/${channelId}/${userId}/${Date.now()}-${randomName}`;

      if (DEBUG_SUPABASE_STORAGE) {
        console.log("[upload] uploading file", {
          originalName: file.originalname,
          filePath,
          contentType: file.mimetype,
          size: file.size,
        });
      }

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
          metadata: {
            user_id: String(userId),
            channel_id: String(channelId),
          },
        });

      if (error) {
        console.error("Supabase upload error:", {
          userId,
          channelId,
          bucket: BUCKET_NAME,
          filePath,
          error,
        });
        return res.status(500).json({ error: error.message });
      }

      const { data: signed } = await supabase.storage
        .from(BUCKET_NAME)
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
    const userId = Number(req.user?.id);
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "File path required" });
    }

    const parsed = parseChannelIdFromPath(filePath);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid storage path" });
    }
    if (parsed.ownerId !== userId) {
      return res.status(403).json({ error: "You can only delete your own files" });
    }

    const allowed = await canAccessChannel(parsed.channelId, userId);
    if (!allowed) {
      return res.status(403).json({ error: "You are not allowed to delete in this channel" });
    }

    const supabase = supabaseAdmin;
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.error("Supabase delete error:", {
        userId,
        filePath,
        bucket: BUCKET_NAME,
        error,
      });
      return res.status(500).json({ error: "Delete failed" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete crash:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
