// routes/profile.js
//
// User profile & settings routes.
//
// Endpoints
// ─────────────────────────────────────────────────────────────
//   GET    /users/me              → current user's profile
//   PATCH  /users/me              → update name / status / bio
//   POST   /users/avatar          → upload / replace profile picture
//   DELETE /users/avatar          → remove profile picture
//   PATCH  /users/me/password     → change password (requires current password)
//   DELETE /users/me              → delete account
//
// Register in your main app file:
//   import profileRouter from "./routes/profile.js";
//   app.use("/users", profileRouter);

import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import verifyToken from "../middleware/auth.js";
import supabase from "../utils/supabase.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// ─── Resolve user ID from token payload ───────────────────────────────────────
// JWT payloads vary by implementation. This helper tries the most common shapes
// and returns an integer so Prisma's Int PK is always satisfied.
// If your verifyToken sets a different key, add it here once rather than
// hunting through every route.
function getUserId(req) {
  const raw =
    req.user?.id ??        // { id: 1 }
    req.user?.userId ??    // { userId: 1 }
    req.user?.user_id ??   // { user_id: 1 }
    req.user?.sub ??       // { sub: "1" }  — OIDC / Supabase JWTs
    null;

  if (raw === null || raw === undefined) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

// Middleware that attaches a clean numeric id and rejects early if missing
function requireUserId(req, res, next) {
  const id = getUserId(req);
  if (!id) {
    return res.status(401).json({ error: "Unauthorized: user ID missing from token." });
  }
  req.userId = id; // use req.userId everywhere below — safe and explicit
  next();
}

router.use(requireUserId);

// ─── Multer — memory storage (we stream to Supabase, no disk needed) ──────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip Supabase path from a full public URL so we can pass it to storage.remove() */
function extractStoragePath(url) {
  if (!url) return null;
  // Public URLs look like: https://<project>.supabase.co/storage/v1/object/public/avatars/<path>
  const marker = "/object/public/avatars/";
  const idx = url.indexOf(marker);
  return idx !== -1 ? url.slice(idx + marker.length) : null;
}

/** Delete a stored avatar file if the path resolves to a Supabase object */
async function deleteOldAvatar(avatarUrl) {
  const path = extractStoragePath(avatarUrl);
  if (!path) return;
  try {
    await supabase.storage.from("avatars").remove([path]);
  } catch (err) {
    // Non-fatal — log but don't block the request
    console.warn("Failed to delete old avatar:", err.message);
  }
}

// ─── GET /users/me ────────────────────────────────────────────────────────────
// Returns the authenticated user's full profile.

router.get("/me", async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
        is_online: true,
        last_seen: true,
        created_at: true,
        // status and bio are optional columns — add them to your Prisma schema
        // and run `prisma migrate dev` if they don't exist yet:
        //   status  String?  @db.VarChar(255)
        //   bio     String?  @db.Text
        ...(true && {}), // placeholder — remove and uncomment below once migrated
        // status: true,
        // bio: true,
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    console.error("GET /users/me error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ─── PATCH /users/me ──────────────────────────────────────────────────────────
// Update display name, status, and/or bio.
// Body: { name?, status?, bio? }

router.patch("/me", async (req, res) => {
  const { name, status, bio } = req.body;

  // Build only the fields that were actually sent
  const data = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: "Name cannot be empty." });
    data.name = trimmed;
  }
  // status and bio are free-text — store empty string as null for cleanliness
  if (status !== undefined) data.status = status?.trim() || null;
  if (bio !== undefined) data.bio = bio?.trim() || null;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No fields to update." });
  }

  try {
    const updated = await prisma.users.update({
      where: { id: req.userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
      },
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    console.error("PATCH /users/me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ─── POST /users/avatar ───────────────────────────────────────────────────────
// Upload or replace profile picture.
// Expects multipart/form-data with field name "avatar".

router.post("/avatar", upload.single("avatar"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided." });
  }

  try {
    // Fetch current avatar so we can delete it after a successful upload
    const currentUser = await prisma.users.findUnique({
      where: { id: req.userId },
      select: { avatar_url: true },
    });

    // Unique filename: avatars/<userId>-<timestamp>.<ext>
    const ext = req.file.mimetype.split("/")[1] ?? "jpg";
    const filename = `${req.userId}-${Date.now()}.${ext}`;
    const storagePath = `${filename}`;

    // Upload to Supabase Storage bucket "avatars"
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error("Supabase avatar upload error:", uploadError);
      return res.status(500).json({ error: "Failed to upload image.", detail: uploadError.message });
    }

    // Get the public URL
    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(storagePath);

    const avatarUrl = publicUrlData.publicUrl;

    // Persist the new URL in the database
    await prisma.users.update({
      where: { id: req.userId },
      data: { avatar_url: avatarUrl },
    });

    // Clean up the old avatar (non-fatal if it fails)
    if (currentUser?.avatar_url) {
      await deleteOldAvatar(currentUser.avatar_url);
    }

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error("POST /users/avatar error:", err);
    res.status(500).json({ error: "Failed to upload avatar.", detail: err.message });
  }
});

// ─── DELETE /users/avatar ─────────────────────────────────────────────────────
// Remove the profile picture and revert to the initials fallback.

router.delete("/avatar", async (req, res) => {
  try {
    const currentUser = await prisma.users.findUnique({
      where: { id: req.userId },
      select: { avatar_url: true },
    });

    if (!currentUser?.avatar_url) {
      return res.status(400).json({ error: "No avatar to remove." });
    }

    // Remove from Supabase Storage
    await deleteOldAvatar(currentUser.avatar_url);

    // Clear in database
    await prisma.users.update({
      where: { id: req.userId },
      data: { avatar_url: null },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /users/avatar error:", err);
    res.status(500).json({ error: "Failed to remove avatar." });
  }
});

// ─── PATCH /users/me/password ─────────────────────────────────────────────────
// Change the user's password.
// Body: { current_password, new_password }

router.patch("/me/password", async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res
      .status(400)
      .json({ error: "Both current and new password are required." });
  }

  if (new_password.length < 8) {
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters." });
  }

  try {
    // Fetch current hashed password
    const user = await prisma.users.findUnique({
      where: { id: req.userId },
      select: { password: true },
    });

    if (!user) return res.status(404).json({ error: "User not found." });

    // Verify current password
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Current password is incorrect." });
      // Note: uses "message" key to match what page.tsx reads as err.response.data.message
    }

    // Prevent reusing the same password
    const isSame = await bcrypt.compare(new_password, user.password);
    if (isSame) {
      return res
        .status(400)
        .json({ message: "New password must be different from the current one." });
    }

    // Hash and save
    const hashed = await bcrypt.hash(new_password, 12);
    await prisma.users.update({
      where: { id: req.userId },
      data: { password: hashed },
    });

    // Revoke all existing refresh tokens so other sessions are logged out
    await prisma.refresh_tokens.updateMany({
      where: { user_id: req.userId, revoked: false },
      data: { revoked: true },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /users/me/password error:", err);
    res.status(500).json({ error: "Failed to update password." });
  }
});

// ─── DELETE /users/me ─────────────────────────────────────────────────────────
// Permanently delete the user's account.
// Cascades are handled by Prisma (channel_members, messages, refresh_tokens).

router.delete("/me", async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.userId },
      select: { avatar_url: true },
    });

    // Remove avatar from storage first
    if (user?.avatar_url) {
      await deleteOldAvatar(user.avatar_url);
    }

    // Delete the user — cascades handle related rows via schema onDelete: Cascade
    await prisma.users.delete({ where: { id: req.userId } });

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /users/me error:", err);
    res.status(500).json({ error: "Failed to delete account." });
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
// Must be a 4-argument middleware to be treated as an error handler by Express.
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image must be under 5 MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err?.message === "Only image files are allowed.") {
    return res.status(400).json({ error: err.message });
  }
  console.error("profile.js unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

export default router;