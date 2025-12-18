// utils/authMiddleware.js
const { verifyOpaqueToken } = require("../utils/tokenAuth");

async function authenticateCookie(req, res, next) {
  try {
    const token = req.cookies && req.cookies.access_token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    // const payload = verifyAccessToken(token);
    const payload = await verifyOpaqueToken(token);
    if (!payload || !payload.id) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: payload.id, email: payload.email || null };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = authenticateCookie;
