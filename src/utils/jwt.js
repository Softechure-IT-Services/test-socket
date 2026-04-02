import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import "dotenv/config";

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || "your_jwt_access_secret";
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "your_jwt_refresh_secret";

/**
 * Generate a short-lived access token
 */
export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, username: user.username },
    ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );
};

/**
 * Generate a long-lived refresh token
 */
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id, jti: randomUUID() },
    REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
};

/**
 * Verify access token synchronously
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
};

/**
 * Verify refresh token synchronously
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
};
