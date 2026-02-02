import { verifyAccessToken } from "../utils/jwt.js";

export default function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({ error: "No access token provided" });
  }

  try {
    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.id,
      email: payload.email,
    };

    next();
  } catch (err) {
    console.error("JWT VERIFY FAILED:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
