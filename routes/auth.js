// routes/auth.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const bcrypt = require("bcrypt");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const EXTERNAL_SECRET = process.env.EXTERNAL_AUTH_SECRET;
const jwt = require("jsonwebtoken");

// cookie options helpers
const isProd = process.env.NODE_ENV === "production";
// const accessCookieOptions = {
//   secure: isProd,
//   sameSite: isProd ? "none" : "lax",
//   sameSite:"none",
//   maxAge: 15 * 60 * 1000,
// };
// const refreshCookieOptions = {
//   secure: isProd,
//   sameSite: isProd ? "none" : "lax",
//   sameSite:"none",
//   maxAge: 7 * 24 * 60 * 60 * 1000,
// };
const accessCookieOptions = {
  maxAge:  7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax", // 🔥 REQUIRED for cross-origin
  secure: false, // MUST be false on localhost
  path: "/", // good practice
};
const refreshCookieOptions = {
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax", // 🔥 REQUIRED for cross-origin
  secure: false, // MUST be false on localhost
  path: "/", // good practice
};

// Helper: save refresh token hash to DB (hash before saving)
const crypto = require("crypto");
function hashToken(t) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

router.post("/register", async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid or missing JSON body" });
  }

  const { external_id, name, email, avatar_url, password } = body;
  const missing = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!password) missing.push("password");
  if (missing.length > 0)
    return res
      .status(400)
      .json({ error: `Missing fields: ${missing.join(", ")}` });

  try {
    // basic email uniqueness check
    const [existing] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [email],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });
    if (existing && existing.length)
      return res.status(409).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `
      INSERT INTO users (external_id, name, email, avatar_url, password, is_online, last_seen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW(), NOW())
    `;
    db.query(
      query,
      [external_id, name, email, avatar_url, hashedPassword],
      (err, result) => {
        if (err)
          return res.status(500).json({ error: `DB error: ${err.message}` });

        res.json({
          id: result.insertId,
          external_id,
          name,
          email,
          avatar_url,
          is_online: 0,
          last_seen: new Date(),
        });
      }
    );
  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const sql = `SELECT * FROM users WHERE email = ? LIMIT 1`;
  db.query(sql, email, async (err, rows) => {
    if (err) return res.status(500).json({ error: `DB error: ${err.message}` });
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password || "");
    if (!valid) return res.status(401).json({ error: "Invalid password" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // store hashed refresh token in DB for revocation / rotation
    const hashed = hashToken(refreshToken);
    const insertRefresh = `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, revoked) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), 0)`;
    db.query(insertRefresh, [user.id, hashed], (err2) => {
      if (err2) console.error("Failed to store refresh token:", err2);
      // set cookies regardless of DB result (but log errors)
      res.cookie("access_token", accessToken, accessCookieOptions);
      res.cookie("refresh_token", refreshToken, refreshCookieOptions);
      res.cookie("user_id", String(user.id), { sameSite: isProd ? "none" : "lax", secure: isProd, httpOnly: false, path: "/" });
res.cookie("username", user.name || "", { sameSite: isProd ? "none" : "lax", secure: isProd, httpOnly: false, path: "/" });

      res.json({
        message: "Login successful",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
        },
      });
    });
  });
});

router.post("/refresh", (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: "No refresh token" });

  try {
    const payload = verifyRefreshToken(token); // throws on invalid/expired
    const tokenHash = hashToken(token);

    // find refresh token record
    db.query(
      "SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1",
      [tokenHash],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "DB error" });
        if (!rows.length || rows[0].revoked)
          return res
            .status(401)
            .json({ error: "Refresh token revoked or not found" });

        const user = { id: rows[0].user_id, email: payload.email };
        // rotate: issue new tokens and revoke old refresh token
        const newAccess = generateAccessToken(user);
        const newRefresh = generateRefreshToken(user);
        const newHash = hashToken(newRefresh);

        db.query(
          "UPDATE refresh_tokens SET revoked = 1, replaced_by = ? WHERE id = ?",
          [newHash, rows[0].id],
          (err2) => {
            if (err2)
              console.error("Failed to mark old refresh token revoked:", err2);

            // insert new refresh record
            db.query(
              "INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at, revoked) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), NOW(), 0)",
              [user.id, newHash],
              (err3) => {
                if (err3)
                  console.error(
                    "Failed to store new refresh token hash:",
                    err3
                  );

                res.cookie("access_token", newAccess, accessCookieOptions);
                res.cookie("refresh_token", newRefresh, refreshCookieOptions);
                res.json({ message: "Token refreshed" });
              }
            );
          }
        );
      }
    );
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

router.post("/logout", (req, res) => {
  // revoke refresh token if stored
  const token = req.cookies?.refresh_token;
  if (token) {
    const hashed = hashToken(token);
    db.query(
      "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?",
      [hashed],
      (err) => {
        if (err) console.error("Failed to revoke refresh token:", err);
      }
    );
  }

  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.json({ message: "Logged out" });
});

module.exports = router;
