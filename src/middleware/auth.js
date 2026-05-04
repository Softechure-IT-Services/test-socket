import { verifyAccessToken } from "../utils/jwt.js";

export default function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  // Prefer HttpOnly cookie token for browser requests.
  const tokenFromCookie = req.cookies?.access_token || req.cookies?.accessToken || null;
  const token = tokenFromHeader || tokenFromCookie;

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
    if (err.message === "jwt expired") {
      console.warn("JWT VERIFY FAILED: jwt expired (Silent refresh should handle this)");
    } else {
      console.error("JWT VERIFY FAILED:", err.message);
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
