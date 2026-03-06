// import express from "express";
// import { PrismaClient } from "@prisma/client";
// import { authenticate } from "../middleware/authenticate.js"; // reuse existing auth middleware

// const router = express.Router();
// const prisma = new PrismaClient();

// /**
//  * GET /huddle?user_id=&meeting_id=&channel_id=
//  * Returns the requesting user's public profile.
//  * The huddle page calls this on load to pre-fill the username and auto-join.
//  */
// router.get("/", authenticate, async (req, res) => {
//   const { user_id, meeting_id, channel_id } = req.query;

//   if (!user_id) {
//     return res.status(400).json({ error: "user_id is required" });
//   }

//   try {
//     const user = await prisma.user.findUnique({
//       where: { id: Number(user_id) },
//       select: {
//         id: true,
//         name: true,
//         email: true,
//         avatar_url: true,
//       },
//     });

//     if (!user) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     return res.status(200).json({
//       user,
//       meeting_id: meeting_id ?? null,
//       channel_id: channel_id ? Number(channel_id) : null,
//     });
//   } catch (err) {
//     console.error("GET /huddle error:", err);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// });

// /**
//  * POST /huddle/session
//  * Persists a huddle session when a meeting starts (idempotent on meeting_id).
//  * Body: { meeting_id, channel_id?, started_by }
//  */
// router.post("/session", authenticate, async (req, res) => {
//   const { meeting_id, channel_id, started_by } = req.body;

//   if (!meeting_id || !started_by) {
//     return res.status(400).json({ error: "meeting_id and started_by are required" });
//   }

//   try {
//     const existing = await prisma.huddleSession.findUnique({
//       where: { meeting_id },
//     });

//     if (existing) {
//       return res.status(200).json({ session: existing, created: false });
//     }

//     const session = await prisma.huddleSession.create({
//       data: {
//         meeting_id,
//         channel_id: channel_id ? Number(channel_id) : null,
//         started_by: Number(started_by),
//         started_at: new Date(),
//       },
//     });

//     return res.status(201).json({ session, created: true });
//   } catch (err) {
//     console.error("POST /huddle/session error:", err);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// });

// /**
//  * PATCH /huddle/session/:meeting_id/end
//  * Stamps ended_at on the session when everyone leaves.
//  */
// router.patch("/session/:meeting_id/end", authenticate, async (req, res) => {
//   const { meeting_id } = req.params;

//   try {
//     const result = await prisma.huddleSession.updateMany({
//       where: { meeting_id, ended_at: null },
//       data: { ended_at: new Date() },
//     });

//     if (result.count === 0) {
//       return res.status(404).json({ error: "Session not found or already ended" });
//     }

//     return res.status(200).json({ message: "Session ended" });
//   } catch (err) {
//     console.error("PATCH /huddle/session/:meeting_id/end error:", err);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// });

// export default router;

import express from "express";
import { PrismaClient } from "@prisma/client";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /huddle?user_id=&meeting_id=&channel_id=
 * Returns the requesting user's public profile.
 * The huddle page calls this on load to pre-fill the username and auto-join.
 */
router.get("/", authenticateToken, async (req, res) => {
  const { user_id, meeting_id, channel_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(user_id) },
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      user,
      meeting_id: meeting_id ?? null,
      channel_id: channel_id ? Number(channel_id) : null,
    });
  } catch (err) {
    console.error("GET /huddle error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /huddle/session
 * Persists a huddle session when a meeting starts (idempotent on meeting_id).
 * Body: { meeting_id, channel_id?, started_by }
 */
router.post("/session", authenticateToken, async (req, res) => {
  const { meeting_id, channel_id, started_by } = req.body;

  if (!meeting_id || !started_by) {
    return res.status(400).json({ error: "meeting_id and started_by are required" });
  }

  try {
    const existing = await prisma.huddleSession.findUnique({
      where: { meeting_id },
    });

    if (existing) {
      return res.status(200).json({ session: existing, created: false });
    }

    const session = await prisma.huddleSession.create({
      data: {
        meeting_id,
        channel_id: channel_id ? Number(channel_id) : null,
        started_by: Number(started_by),
        started_at: new Date(),
      },
    });

    return res.status(201).json({ session, created: true });
  } catch (err) {
    console.error("POST /huddle/session error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /huddle/session/:meeting_id/end
 * Stamps ended_at on the session when everyone leaves.
 */
router.patch("/session/:meeting_id/end", authenticateToken, async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const result = await prisma.huddleSession.updateMany({
      where: { meeting_id, ended_at: null },
      data: { ended_at: new Date() },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Session not found or already ended" });
    }

    return res.status(200).json({ message: "Session ended" });
  } catch (err) {
    console.error("PATCH /huddle/session/:meeting_id/end error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;