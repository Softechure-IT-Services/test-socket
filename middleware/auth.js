const { verifyAccessToken } = require("../utils/jwt");

function authenticateCookie(req, res, next) {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({ error: "No access token" });
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

module.exports = authenticateCookie;
