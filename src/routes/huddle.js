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
import { io } from "../sockets/index.js";

const router = express.Router();
const prisma = new PrismaClient();

async function getStartedByUsername(userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return null;

  const user = await prisma.users.findUnique({
    where: { id: numericUserId },
    select: {
      username: true,
      name: true,
    },
  });

  return user?.username?.trim() || user?.name?.trim() || null;
}

async function enrichSessionWithStarter(session) {
  if (!session) return null;

  const startedByUsername = await getStartedByUsername(session.started_by);
  return {
    ...session,
    started_by_username: startedByUsername,
  };
}

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
    const user = await prisma.users.findUnique({
      where: { id: Number(user_id) },
      select: {
        id: true,
        name: true,
        username: true,
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
 * POST /huddle/channel/:channelId/start
 * Starts (or returns existing active) huddle for a channel.
 * Emits a realtime popup event to channel members.
 */
router.post("/channel/:channelId/start", authenticateToken, async (req, res) => {
  const channelId = Number(req.params.channelId);
  const startedBy = Number(req.user?.id);

  if (!Number.isFinite(channelId)) {
    return res.status(400).json({ error: "Invalid channel id" });
  }
  if (!Number.isFinite(startedBy)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Ensure channel exists
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { id: true, name: true },
    });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Ensure starter is a channel member
    const starterMembership = await prisma.channel_members.findFirst({
      where: { channel_id: channelId, user_id: startedBy },
      select: { user_id: true },
    });
    if (!starterMembership) {
      return res.status(403).json({ error: "You are not a member of this channel" });
    }

    // Slack-like behavior: if an active huddle already exists, reuse it.
    let session = await prisma.huddleSession.findFirst({
      where: { channel_id: channelId, ended_at: null },
      orderBy: { started_at: "desc" },
    });

    let created = false;
    if (!session) {
      const meetingId = `channel-${channelId}-${Date.now()}`;
      session = await prisma.huddleSession.create({
        data: {
          meeting_id: meetingId,
          channel_id: channelId,
          started_by: startedBy,
          started_at: new Date(),
        },
      });
      created = true;
    }

    // Notify all channel members so UI can show "Join Huddle" popup.
    const members = await prisma.channel_members.findMany({
      where: { channel_id: channelId },
      select: { user_id: true },
    });
    const memberIds = members.map((m) => m.user_id).filter((id) => id != null);

    const sessionWithStarter = await enrichSessionWithStarter(session);
    const payload = {
      channel_id: channelId,
      channel_name: channel.name,
      meeting_id: session.meeting_id,
      started_by: session.started_by,
      started_by_username: sessionWithStarter?.started_by_username ?? null,
      created,
    };

    if (io) {
      io.to(`channel_${channelId}`).emit("huddleStarted", payload);
      memberIds.forEach((uid) => {
        io.to(`user_${uid}`).emit("huddleStarted", payload);
      });
    }

    return res.status(created ? 201 : 200).json({
      success: true,
      created,
      session: sessionWithStarter,
      room_id: session.meeting_id,
      started_by_username: sessionWithStarter?.started_by_username ?? null,
      members: memberIds,
    });
  } catch (err) {
    console.error("POST /huddle/channel/:channelId/start error:", err);
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

/**
 * GET /huddle/channel/:channelId/active
 * Returns active huddle session for channel (if any).
 */
router.get("/channel/:channelId/active", authenticateToken, async (req, res) => {
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(channelId)) {
    return res.status(400).json({ error: "Invalid channel id" });
  }

  try {
    const active = await prisma.huddleSession.findFirst({
      where: { channel_id: channelId, ended_at: null },
      orderBy: { started_at: "desc" },
    });
    const activeWithStarter = await enrichSessionWithStarter(active);

    return res.status(200).json({
      success: true,
      active: !!active,
      session: activeWithStarter,
      room_id: active?.meeting_id ?? null,
      started_by_username: activeWithStarter?.started_by_username ?? null,
    });
  } catch (err) {
    console.error("GET /huddle/channel/:channelId/active error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /huddle/instant
 * Generates a unique meeting ID, persists a new huddle session, and returns it.
 */
router.post("/instant", authenticateToken, async (req, res) => {
  const startedBy = Number(req.user?.id);

  if (!Number.isFinite(startedBy)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const meetingId = `instant-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const session = await prisma.huddleSession.create({
      data: {
        meeting_id: meetingId,
        started_by: startedBy,
        started_at: new Date(),
      },
    });
    const sessionWithStarter = await enrichSessionWithStarter(session);

    return res.status(201).json({
      success: true,
      created: true,
      session: sessionWithStarter,
      room_id: session.meeting_id,
      started_by_username: sessionWithStarter?.started_by_username ?? null,
    });
  } catch (err) {
    console.error("POST /huddle/instant error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
