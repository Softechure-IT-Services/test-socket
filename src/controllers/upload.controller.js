import crypto from "crypto";
import path from "path";
import supabase from "../utils/supabase.js";

/**
 * Upload files to Supabase
 * POST /upload
 */
export const uploadFiles = async (req, res) => {
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
        .from("images")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({ error: "Upload failed" });
      }

      const { data: signed } = await supabase.storage
        .from("images")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days

      uploaded.push({
        name: file.originalname,
        path: filePath,
        type: file.mimetype,
        size: file.size,
        url: signed.signedUrl,
      });
    }

    res.json({
      success: true,
      files: uploaded,
    });
  } catch (err) {
    console.error("Upload crash:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Delete file from Supabase
 * POST /upload/delete
 */
export const deleteFile = async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({ error: "File path required" });
    }

    const { error } = await supabase.storage
      .from("images")
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
};
