import express from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.js";
import { generateUniqueUsernameFromName } from "../controllers/auth.controller.js";
import { hashToken } from "../controllers/auth.controller.js";

const router = express.Router();
const prisma = new PrismaClient();

const EXTERNAL_SECRET = process.env.EXTERNAL_AUTH_SECRET;
const isProd = process.env.NODE_ENV === "production";
const accessCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
const refreshCookieOptions = { ...accessCookieOptions };
// Non-HttpOnly cookies are still transmitted across origins; ensure they are Secure in production.
const publicCookieOptions = {
  httpOnly: false,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge: accessCookieOptions.maxAge,
};

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://192.168.1.14:3000",
  "http://192.168.1.15:3000",
  "http://192.168.0.113:5000",
  "https://softechat.vercel.app",
  "https://test-socket-client-steel.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

function requireAllowedOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) {
    res.status(403).json({ success: false, error: "Forbidden: missing Origin" });
    return false;
  }
  if (!allowedOrigins.includes(origin)) {
    res.status(403).json({ success: false, error: "Forbidden: invalid Origin" });
    return false;
  }
  return true;
}

/**
 * EXTERNAL CREATE (UPSERT USER)
 */
router.post("/external-create", async (req, res) => {
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

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Missing or invalid Authorization header",
    });
  }

  const external_auth = authHeader.split(" ")[1];

  try {
    const existingUser = await prisma.users.findUnique({
      where: { external_id },
      select: { id: true },
    });

    if (existingUser) {
      await prisma.users.update({
        where: { external_id },
        data: { auth_token: external_auth },
      });

      return res.json({
        success: true,
        message: "User already existed, auth_token updated",
      });
    }

    const generatedUsername = await generateUniqueUsernameFromName(name);

    await prisma.users.create({
      data: {
        external_id,
        name,
        username: generatedUsername,
        email,
        auth_token: external_auth,
      },
    });

    return res.json({
      success: true,
      message: "User created successfully",
    });
  } catch (err) {
    console.error("External create error:", err);
    return res.status(500).json({ success: false });
  }
});

/**
 * EXTERNAL LOGIN
 */
router.post("/external-login", async (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res
      .status(400)
      .json({ authenticated: false, error: "Invalid or missing JSON body" });
  }

  const authHeader = req.headers["authorization"];
  const { external_id } = req.body;

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

  try {
    const user = await prisma.users.findUnique({
      where: { external_id },
      select: {
        id: true,
        name: true,
        email: true,
        auth_token: true,
      },
    });

    if (!user) {
      return res.json({ authenticated: false });
    }

    if (user.auth_token !== authToken) {
      return res.json({ authenticated: false });
    }

    const loginToken = jwt.sign(
      {
        uid: user.id,
        ext: external_id,
      },
      process.env.EXTERNAL_LOGIN_SECRET,
      { expiresIn: "50m" }
    );

    console.log("External login successful for user:", user.id);

    return res.json({
      authenticated: true,
      redirect_url: `${process.env.CLIENT_URL}/external-login/${loginToken}`,
    });
  } catch (err) {
    console.error("External login error:", err);
    return res.status(500).json({ authenticated: false });
  }
});

/**
 * EXTERNAL SESSION → ISSUE INTERNAL JWT
 */
router.post("/external-session", async (req, res) => {
  const { token } = req.body;

  try {
    if (!requireAllowedOrigin(req, res)) return;
    const payload = jwt.verify(token, process.env.EXTERNAL_LOGIN_SECRET);
    const userId = payload.uid;

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
        created_at: true,
      },
    });

    if (!user) {
      return res.status(500).json({ success: false });
    }

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
    });
    const refreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
    });
    const tokenHash = hashToken(refreshToken);

    await prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revoked: false,
      },
    });

    res.cookie("access_token", accessToken, accessCookieOptions);
    res.cookie("refresh_token", refreshToken, refreshCookieOptions);

    res.cookie("user_id", String(user.id), publicCookieOptions);
    res.cookie("username", user.name, publicCookieOptions);
    res.cookie("email", user.email, publicCookieOptions);
    res.cookie("avatar_url", user.avatar_url || "", publicCookieOptions);
    res.cookie("created_at", user.created_at.toISOString(), publicCookieOptions);

    return res.json({ success: true, accessToken });
  } catch (err) {
    return res.status(401).json({ success: false });
  }
});

/**
 * EXTERNAL REFRESH TOKEN
 */
router.post("/external-refresh", async (req, res) => {
  const { user_id, external_auth } = req.body;

  if (!user_id || !external_auth) {
    return res
      .status(400)
      .json({ success: false, error: "Missing user_id or external_auth" });
  }

  try {
    jwt.verify(external_auth, EXTERNAL_SECRET);

    const updated = await prisma.users.updateMany({
      where: { external_id: user_id },
      data: { auth_token: external_auth },
    });

    if (updated.count === 0) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    return res.json({ success: true, message: "Auth token updated" });
  } catch (err) {
    console.error("External refresh error:", err);
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
});

/**
 * EXTERNAL DELETE USER
 */
router.post("/external-delete", async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, error: "Missing user_id" });
  }

  try {
    const deleted = await prisma.users.deleteMany({
      where: { external_id: user_id },
    });

    if (deleted.count === 0) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    return res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    console.error("External delete error:", err);
    return res.status(500).json({ success: false });
  }
});

export default router;


// new
// import express from "express";
// const router = express.Router();
// import db from "../config/db.js";
// import jwt from "jsonwebtoken";
// import {
//   generateAccessToken,
//   generateRefreshToken,
//   verifyRefreshToken,
// } from "../utils/jwt.js";

// const EXTERNAL_SECRET = process.env.EXTERNAL_AUTH_SECRET;
// // new

// const isProd = process.env.NODE_ENV === "production";


// router.post("/external-create", (req, res) => {
//   // Validate body
//   if (!req.body || typeof req.body !== "object") {
//     return res
//       .status(400)
//       .json({ success: false, error: "Invalid or missing JSON body" });
//   }

//   const { external_id, name, email } = req.body;

//   if (!external_id || !name || !email) {
//     return res
//       .status(400)
//       .json({ success: false, error: "Missing required fields" });
//   }

//   // Get external_auth from Authorization header
//   const authHeader = req.headers["authorization"];
//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     return res
//       .status(401)
//       .json({
//         success: false,
//         error: "Missing or invalid Authorization header",
//       });
//   }
//   const external_auth = authHeader.split(" ")[1];

//   // Optional: verify token using server-side secret
//   // try {
//   //   jwt.verify(external_auth, EXTERNAL_SECRET);
//   // } catch (err) {
//   //   console.error("Invalid token:", err);
//   //   return res.status(401).json({ success: false, error: "Invalid token" });
//   // }

//   // Check if user already exists
//   const checkSql = "SELECT id FROM users WHERE external_id = ? LIMIT 1";
//   db.query(checkSql, [external_id], (err, rows) => {
//     if (err) {
//       console.error("DB error:", err);
//       return res.status(500).json({ success: false });
//     }

//     if (rows.length > 0) {
//       // Update auth token if user already exists
//       const updateSql =
//         "UPDATE users SET auth_token = ? WHERE external_id = ? LIMIT 1";
//       db.query(updateSql, [external_auth, external_id], (err2) => {
//         if (err2) {
//           console.error("DB error:", err2);
//           return res.status(500).json({ success: false });
//         }

//         return res.json({
//           success: true,
//           message: "User already existed, auth_token updated",
//         });
//       });
//     } else {
//       // Create new user
//       const insertSql =
//         "INSERT INTO users (external_id, name, email, auth_token, created_at) VALUES (?, ?, ?, ?, NOW())";
//       db.query(insertSql, [external_id, name, email, external_auth], (err3) => {
//         if (err3) {
//           console.error("DB error:", err3);
//           return res.status(500).json({ success: false });
//         }

//         return res.json({
//           success: true,
//           message: "User created successfully",
//         });
//       });
//     }
//   });
// });

// router.post("/external-login", (req, res) => {
//   // res.send(authHeader);
//   // 1️⃣ Validate request body
//   if (!req.body || typeof req.body !== "object") {
//     return res
//       .status(400)
//       .json({ authenticated: false, error: "Invalid or missing JSON body" });
//   }

//   const authHeader = req.headers["authorization"];
//   const { external_id } = req.body; // use external_id from body
//   // const authHeader = req.headers["authorization"];

//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     return res
//       .status(401)
//       .json({ authenticated: false, error: "Missing auth token" });
//   }

//   if (!external_id) {
//     return res
//       .status(400)
//       .json({ authenticated: false, error: "Missing external_id" });
//   }

//   const authToken = authHeader.split(" ")[1];

//   // 2️⃣ Check user existence and auth_token match
//   const sql =
//     "SELECT id, name, email, auth_token FROM users WHERE external_id = ? LIMIT 1";
//   db.query(sql, [external_id], (err, rows) => {
//     if (err) {
//       console.error("DB error:", err);
//       return res.status(500).json({ authenticated: false });
//     }

//     if (!rows.length) {
//       return res.json({ authenticated: false });
//     }

//     const user = rows[0];
//     const loginToken = jwt.sign(
//       {
//         uid: user.id, // internal user ID
//         ext: user.external_id,
//       },
//       process.env.EXTERNAL_LOGIN_SECRET,
//       { expiresIn: "50m" } // VERY SHORT LIVED
//     );

//     // 3️⃣ Compare auth_token
//     if (user.auth_token !== authToken) {
//       return res.json({ authenticated: false });
//     }
//     console.log("External login successful for user:", user.id);
//     // ✅ Authentication successful
//     return res.json({
//       authenticated: true,
//       redirect_url: `${process.env.CLIENT_URL}/external-login/${loginToken}`,
//     });
//   });
// });

// router.post("/external-session", (req, res) => {
//   const { token } = req.body;

//   try {
//     // 1️⃣ Verify external system token
//     const payload = jwt.verify(token, process.env.EXTERNAL_LOGIN_SECRET);
//     const userId = payload.uid;

//     const sql = `
//       SELECT id, name, email, avatar_url, created_at, auth_token
//       FROM users
//       WHERE id = ?
//       LIMIT 1
//     `;

//     db.query(sql, [userId], (err, rows) => {
//       if (err || !rows.length) {
//         return res.status(500).json({ success: false });
//       }

//       const user = rows[0];

//       // 2️⃣ Generate YOUR JWT
//       const accessToken = generateAccessToken({
//         id: user.id,
//         email: user.email,
//       });

//       // 3️⃣ Store JWT in cookie
//     //   res.cookie("access_token", accessToken, {
//     //     httpOnly: true,
//     //     sameSite: "lax",
//     //     secure: false, // true in production HTTPS
//     //     path: "/",
//     //   });
//       res.cookie("access_token", accessToken, {
//         httpOnly: true,
//         sameSite: "none",
//         secure: false,
//         path: "/",
//       });

//       // optional non-httpOnly cookies
//       res.cookie("user_id", String(user.id), { sameSite: "none" });
//       res.cookie("username", user.name, { sameSite: "none" });
//       res.cookie("email", user.email, { sameSite: "none" });
//       res.cookie("avatar_url", user.avatar_url || "", { sameSite: "none" });
//       res.cookie("created_at", user.created_at.toISOString(), {
//         sameSite: "none",
//       });

//       return res.json({ success: true });
//     });
//   } catch (err) {
//     return res.status(401).json({ success: false });
//   }
// });


// router.post("/external-refresh", (req, res) => {
//   const { user_id, external_auth } = req.body;

//   if (!user_id || !external_auth) {
//     return res
//       .status(400)
//       .json({ success: false, error: "Missing user_id or external_auth" });
//   }

//   // Optional: verify external_auth is a valid JWT
//   try {
//     jwt.verify(external_auth, EXTERNAL_SECRET);
//   } catch (err) {
//     console.error("Invalid external_auth token:", err);
//     return res.status(401).json({ success: false, error: "Invalid token" });
//   }

//   // Update auth_token in DB
//   const sql = "UPDATE users SET auth_token = ? WHERE external_id = ? LIMIT 1";
//   db.query(sql, [external_auth, user_id], (err, result) => {
//     if (err) {
//       console.error("DB error:", err);
//       return res.status(500).json({ success: false });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ success: false, error: "User not found" });
//     }

//     return res.json({ success: true, message: "Auth token updated" });
//   });
// });

// router.post("/external-delete", (req, res) => {
//   const { user_id } = req.body;

//   if (!user_id) {
//     return res.status(400).json({ success: false, error: "Missing user_id" });
//   }

//   // Delete user matching external_id
//   const sql = "DELETE FROM users WHERE external_id = ? LIMIT 1";
//   db.query(sql, [user_id], (err, result) => {
//     if (err) {
//       console.error("DB error:", err);
//       return res.status(500).json({ success: false });
//     }

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ success: false, error: "User not found" });
//     }

//     return res.json({ success: true, message: "User deleted successfully" });
//   });
// });

// export default router;
