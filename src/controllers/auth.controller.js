// controllers/auth.controller.js
import prisma from "../config/prisma.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";

/** Helper: hash refresh token before saving to DB */
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Validate and normalise a username string.
 * Allowed: lowercase letters, digits, underscores, hyphens. Length 3–30.
 */
export const normaliseUsername = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  return raw.trim().toLowerCase();
};

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;

export const validateUsername = (username) => {
  if (!username) return "Username is required.";
  if (!USERNAME_RE.test(username))
    return "Username must be 3–30 characters and contain only letters, numbers, _ or -.";
  return null; // valid
};

/**
 * Check whether a username is available (case-insensitive).
 * Returns true if available, false if taken.
 */
export const isUsernameAvailable = async (username, excludeUserId = null) => {
  const normalised = normaliseUsername(username);
  if (!normalised) return false;
  const where = { username: normalised };
  if (excludeUserId) where.id = { not: Number(excludeUserId) };
  const existing = await prisma.users.findFirst({ where, select: { id: true } });
  return existing === null;
};

/**
 * Register a new user
 */
export const registerUser = async ({ external_id, name, email, avatar_url, password, username }) => {
  // Check if email already exists
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) throw { status: 409, message: "Email already registered" };

  // Validate username
  const normUsername = normaliseUsername(username);
  const usernameError = validateUsername(normUsername);
  if (usernameError) throw { status: 400, message: usernameError };

  const usernameTaken = !(await isUsernameAvailable(normUsername));
  if (usernameTaken) throw { status: 409, message: "Username already taken" };

  // Normalize password so whitespace-only values are rejected
  if (!password || !password.trim()) throw { status: 400, message: "Password is required" };
  const cleanPassword = password.trim();

  const hashedPassword = await bcrypt.hash(cleanPassword, 10);

  const user = await prisma.users.create({
    data: {
      external_id,
      name,
      email,
      username: normUsername,
      avatar_url,
      password: hashedPassword,
      is_online: false,
      last_seen: new Date(),
    },
    select: {
      id: true,
      external_id: true,
      name: true,
      username: true,
      email: true,
      avatar_url: true,
      is_online: true,
      last_seen: true,
    },
  });

  return user;
};

/**
 * Authenticate user and issue tokens
 */
export const loginUser = async ({ email, password }) => {
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) throw { status: 404, message: "User not found" };

  if (!password || !password.trim()) throw { status: 400, message: "Password is required" };
  const cleanPassword = password.trim();

  const valid = await bcrypt.compare(cleanPassword, user.password || "");
  if (!valid) throw { status: 401, message: "Invalid password" };

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const tokenHash = hashToken(refreshToken);

  // Store refresh token hash
  await prisma.refresh_tokens.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked: false,
    },
  });

  return { user, accessToken, refreshToken };
};

/**
 * Refresh tokens
 */
export const refreshTokens = async (token) => {
  if (!token) throw { status: 401, message: "No refresh token" };
  verifyRefreshToken(token);
  const tokenHash = hashToken(token);

  const record = await prisma.refresh_tokens.findFirst({
    where: {
      token_hash: tokenHash,
      revoked: false,
      expires_at: { gte: new Date() },
    },
    orderBy: { created_at: "desc" },
  });

  if (!record || record.revoked) throw { status: 401, message: "Refresh token revoked or not found" };

  const user = await prisma.users.findUnique({ where: { id: record.user_id } });
  if (!user) throw { status: 404, message: "User not found" };

  // Rotate tokens
  const newAccess = generateAccessToken(user);
  const newRefresh = generateRefreshToken(user);
  const newHash = hashToken(newRefresh);

  await prisma.$transaction([
    prisma.refresh_tokens.update({
      where: { id: record.id },
      data: { revoked: true, replaced_by: newHash },
    }),
    prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: newHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revoked: false,
      },
    }),
  ]);

  return { accessToken: newAccess, refreshToken: newRefresh };
};

/**
 * Logout user (revoke refresh token)
 */
export const logoutUser = async (token) => {
  if (!token) return;

  const tokenHash = hashToken(token);
  await prisma.refresh_tokens.updateMany({
    where: { token_hash: tokenHash },
    data: { revoked: true },
  });
};

/**
 * Request a password reset (sends a token via email in a real system)
 */
export const requestPasswordReset = async ({ email }) => {
  if (!email || !email.trim()) throw { status: 400, message: "Email is required" };

  const user = await prisma.users.findUnique({ where: { email } });

  // Don't leak whether the email exists
  if (!user) {
    return { message: "If that email is registered, a reset link has been sent." };
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await prisma.password_reset_tokens.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used: false,
    },
  });

  // TODO: send resetToken via email to the user. For now we return it so you can use it in dev/testing.
  return {
    message: "If that email is registered, a reset link has been sent.",
    resetToken,
  };
};

/**
 * Reset password using a reset token
 */
export const resetPassword = async ({ token, password }) => {
  if (!token) throw { status: 400, message: "Reset token is required" };
  if (!password || !password.trim()) throw { status: 400, message: "Password is required" };

  const tokenHash = hashToken(token);
  const record = await prisma.password_reset_tokens.findFirst({
    where: {
      token_hash: tokenHash,
      used: false,
      expires_at: { gte: new Date() },
    },
  });

  if (!record) throw { status: 400, message: "Invalid or expired reset token" };

  const user = await prisma.users.findUnique({ where: { id: record.user_id } });
  if (!user) throw { status: 404, message: "User not found" };

  const cleanPassword = password.trim();
  const hashedPassword = await bcrypt.hash(cleanPassword, 10);

  await prisma.$transaction([
    prisma.users.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    }),
    prisma.password_reset_tokens.update({
      where: { id: record.id },
      data: { used: true },
    }),
  ]);

  return { message: "Password reset successful" };
};
