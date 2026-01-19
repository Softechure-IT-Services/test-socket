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
 * Register a new user
 */
export const registerUser = async ({ external_id, name, email, avatar_url, password }) => {
  // Check if email already exists
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) throw { status: 409, message: "Email already registered" };

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.users.create({
    data: {
      external_id,
      name,
      email,
      avatar_url,
      password: hashedPassword,
      is_online: false,
      last_seen: new Date(),
    },
    select: {
      id: true,
      external_id: true,
      name: true,
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

  const valid = await bcrypt.compare(password, user.password || "");
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
  const payload = verifyRefreshToken(token);
  const tokenHash = hashToken(token);

  const record = await prisma.refresh_tokens.findFirst({
    where: { token_hash: tokenHash },
  });

  if (!record || record.revoked) throw { status: 401, message: "Refresh token revoked or not found" };

  const user = await prisma.users.findUnique({ where: { id: record.user_id } });

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
