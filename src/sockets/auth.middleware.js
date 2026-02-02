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
      avatar_url: user.avatar_url,
    };

    next();
  } catch (err) {
    console.error("❌ Socket auth failed:", err.message);
    next(new Error("Unauthorized"));
  }
}
