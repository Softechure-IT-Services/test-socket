// utils/jwt.js
import jwt from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "access-secret-key";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "refresh-secret-key";

export function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    ACCESS_SECRET,
    { expiresIn: "30d" }
  );
}

export function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}
