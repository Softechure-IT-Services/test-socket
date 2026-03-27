import cookie from "cookie";
import { verifyAccessToken } from "../utils/jwt.js";

export default function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error("Unauthorized"));

    const user = verifyAccessToken(token);

    socket.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar_url: user.avatar_url,
    };

    next();
  } catch (err) {
    if (err.message === "jwt expired") {
      console.warn("⚠️ Socket auth failed: Token expired");
    } else {
      console.error("❌ Socket auth failed:", err.message);
    }
    next(new Error("Unauthorized"));
  }
}
