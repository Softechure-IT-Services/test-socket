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

// export default authenticateToken;



// // const { verifyAccessToken } = require("../utils/jwt");

// // import { verifyAccessToken } from "./utils/jwt.js";
// import { verifyAccessToken } from "../utils/jwt.js";

// function authenticateToken(req, res, next) {
//   // 1️⃣ Check Authorization header first
//   const authHeader = req.headers.authorization || "";
//   const token = authHeader.startsWith("Bearer ")
//     ? authHeader.split(" ")[1]
//     : null;

//   // 2️⃣ If no token in header, fallback to cookie (optional)
//   // const token = req.cookies?.access_token;

//   if (!token) {
//     return res.status(401).json({ error: "No access token provided" });
//   }

//   try {
//     const payload = verifyAccessToken(token);

//     req.user = {
//       id: payload.id,
//       email: payload.email,
//     };

//     next();
//   } catch (err) {
//     console.error("JWT VERIFY FAILED:", err.message);
//     return res.status(401).json({ error: "Invalid or expired token" });
//   }
// }

// module.exports = authenticateToken;
