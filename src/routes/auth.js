import express from "express";
const router = express.Router();
import {
  registerUser,
  loginUser,
  refreshTokens,
  logoutUser,
} from "../controllers/auth.controller.js";

import { hashToken } from "../controllers/auth.controller.js"; // optional export for cookies
import crypto from "crypto";

// Cookie options
const isProd = process.env.NODE_ENV === "production";
const accessCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
const refreshCookieOptions = { ...accessCookieOptions };

function extractToken(req) {
  // 1. From cookie
  if (req.cookies?.refresh_token) {
    return req.cookies.refresh_token;
  }

  // 2. From Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  // 3. From body (optional)
  if (req.body?.refresh_token) {
    return req.body.refresh_token;
  }

  return null;
}


router.post("/register", async (req, res) => {
  try {
    const user = await registerUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    console.error("Register error:", err);
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { user, accessToken, refreshToken } = await loginUser(req.body);

    res.cookie("access_token", accessToken, accessCookieOptions);
    res.cookie("refresh_token", refreshToken, refreshCookieOptions);
    res.cookie("user_id", String(user.id), { sameSite: isProd ? "none" : "lax", secure: isProd, httpOnly: false });
    res.cookie("username", user.name || "", { sameSite: isProd ? "none" : "lax", secure: isProd, httpOnly: false });

    res.json({ message: "Login successful", user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "No refresh token provided" });
    }

    const { accessToken, refreshToken } = await refreshTokens(token);

    // If you still want cookies
    res.cookie("access_token", accessToken, accessCookieOptions);
    res.cookie("refresh_token", refreshToken, refreshCookieOptions);

    // Also return tokens in JSON for mobile/Postman
    res.json({
      message: "Token refreshed",
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("Refresh error:", err);
    res
      .status(err.status || 401)
      .json({ error: err.message || "Invalid or expired refresh token" });
  }
});


router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    await logoutUser(token);
    res.clearCookie("access_token");
    res.clearCookie("refresh_token");
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
