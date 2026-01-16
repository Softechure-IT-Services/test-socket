const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const EXTERNAL_SECRET = process.env.EXTERNAL_AUTH_SECRET;
const jwt = require("jsonwebtoken");

const isProd = process.env.NODE_ENV === "production";


router.post("/external-create", (req, res) => {
  // Validate body
  if (!req.body || typeof req.body !== "object") {
    return res
      .status(400)
      .json({ success: false, error: "Invalid or missing JSON body" });
  }

  const { external_id, name, email } = req.body;

  if (!external_id || !name || !email) {
    return res
      .status(400)
      .json({ success: false, error: "Missing required fields" });
  }

  // Get external_auth from Authorization header
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({
        success: false,
        error: "Missing or invalid Authorization header",
      });
  }
  const external_auth = authHeader.split(" ")[1];

  // Optional: verify token using server-side secret
  // try {
  //   jwt.verify(external_auth, EXTERNAL_SECRET);
  // } catch (err) {
  //   console.error("Invalid token:", err);
  //   return res.status(401).json({ success: false, error: "Invalid token" });
  // }

  // Check if user already exists
  const checkSql = "SELECT id FROM users WHERE external_id = ? LIMIT 1";
  db.query(checkSql, [external_id], (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ success: false });
    }

    if (rows.length > 0) {
      // Update auth token if user already exists
      const updateSql =
        "UPDATE users SET auth_token = ? WHERE external_id = ? LIMIT 1";
      db.query(updateSql, [external_auth, external_id], (err2) => {
        if (err2) {
          console.error("DB error:", err2);
          return res.status(500).json({ success: false });
        }

        return res.json({
          success: true,
          message: "User already existed, auth_token updated",
        });
      });
    } else {
      // Create new user
      const insertSql =
        "INSERT INTO users (external_id, name, email, auth_token, created_at) VALUES (?, ?, ?, ?, NOW())";
      db.query(insertSql, [external_id, name, email, external_auth], (err3) => {
        if (err3) {
          console.error("DB error:", err3);
          return res.status(500).json({ success: false });
        }

        return res.json({
          success: true,
          message: "User created successfully",
        });
      });
    }
  });
});

router.post("/external-login", (req, res) => {
  // res.send(authHeader);
  // 1️⃣ Validate request body
  if (!req.body || typeof req.body !== "object") {
    return res
      .status(400)
      .json({ authenticated: false, error: "Invalid or missing JSON body" });
  }

  const authHeader = req.headers["authorization"];
  const { external_id } = req.body; // use external_id from body
  // const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ authenticated: false, error: "Missing auth token" });
  }

  if (!external_id) {
    return res
      .status(400)
      .json({ authenticated: false, error: "Missing external_id" });
  }

  const authToken = authHeader.split(" ")[1];

  // 2️⃣ Check user existence and auth_token match
  const sql =
    "SELECT id, name, email, auth_token FROM users WHERE external_id = ? LIMIT 1";
  db.query(sql, [external_id], (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ authenticated: false });
    }

    if (!rows.length) {
      return res.json({ authenticated: false });
    }

    const user = rows[0];
    const loginToken = jwt.sign(
      {
        uid: user.id, // internal user ID
        ext: user.external_id,
      },
      process.env.EXTERNAL_LOGIN_SECRET,
      { expiresIn: "50m" } // VERY SHORT LIVED
    );

    // 3️⃣ Compare auth_token
    if (user.auth_token !== authToken) {
      return res.json({ authenticated: false });
    }
    console.log("External login successful for user:", user.id);
    // ✅ Authentication successful
    return res.json({
      authenticated: true,
      redirect_url: `${process.env.CLIENT_URL}/external-login/${loginToken}`,
    });
  });
});

router.post("/external-session", (req, res) => {
  const { token } = req.body;

  try {
    // 1️⃣ Verify external system token
    const payload = jwt.verify(token, process.env.EXTERNAL_LOGIN_SECRET);
    const userId = payload.uid;

    const sql = `
      SELECT id, name, email, avatar_url, created_at, auth_token
      FROM users
      WHERE id = ?
      LIMIT 1
    `;

    db.query(sql, [userId], (err, rows) => {
      if (err || !rows.length) {
        return res.status(500).json({ success: false });
      }

      const user = rows[0];

      // 2️⃣ Generate YOUR JWT
      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
      });

      // 3️⃣ Store JWT in cookie
    //   res.cookie("access_token", accessToken, {
    //     httpOnly: true,
    //     sameSite: "lax",
    //     secure: false, // true in production HTTPS
    //     path: "/",
    //   });
      res.cookie("access_token", accessToken, {
        httpOnly: true,
        sameSite: "none",
        secure: false,
        path: "/",
      });

      // optional non-httpOnly cookies
      res.cookie("user_id", String(user.id), { sameSite: "none" });
      res.cookie("username", user.name, { sameSite: "none" });
      res.cookie("email", user.email, { sameSite: "none" });
      res.cookie("avatar_url", user.avatar_url || "", { sameSite: "none" });
      res.cookie("created_at", user.created_at.toISOString(), {
        sameSite: "none",
      });

      return res.json({ success: true });
    });
  } catch (err) {
    return res.status(401).json({ success: false });
  }
});


router.post("/external-refresh", (req, res) => {
  const { user_id, external_auth } = req.body;

  if (!user_id || !external_auth) {
    return res
      .status(400)
      .json({ success: false, error: "Missing user_id or external_auth" });
  }

  // Optional: verify external_auth is a valid JWT
  try {
    jwt.verify(external_auth, EXTERNAL_SECRET);
  } catch (err) {
    console.error("Invalid external_auth token:", err);
    return res.status(401).json({ success: false, error: "Invalid token" });
  }

  // Update auth_token in DB
  const sql = "UPDATE users SET auth_token = ? WHERE external_id = ? LIMIT 1";
  db.query(sql, [external_auth, user_id], (err, result) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ success: false });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.json({ success: true, message: "Auth token updated" });
  });
});

router.post("/external-delete", (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, error: "Missing user_id" });
  }

  // Delete user matching external_id
  const sql = "DELETE FROM users WHERE external_id = ? LIMIT 1";
  db.query(sql, [user_id], (err, result) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ success: false });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.json({ success: true, message: "User deleted successfully" });
  });
});

module.exports = router;
