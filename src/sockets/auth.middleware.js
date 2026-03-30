import cookie from "cookie";
import { verifyAccessToken } from "../utils/jwt.js";

export default function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    const allowGuest = !!socket.handshake.auth?.guest;

    if (!token) {
      if (!allowGuest) return next(new Error("Unauthorized"));

      socket.user = {
        id: null,
        email: null,
        name: null,
        username: null,
        avatar_url: null,
        guest: true,
      };

      return next();
    }

    const user = verifyAccessToken(token);

    socket.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
      avatar_url: user.avatar_url,
      guest: false,
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
