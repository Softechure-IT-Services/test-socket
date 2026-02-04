import express from "express";
const router = express.Router();
import db from "../config/db.js";
import verifyToken from "../middleware/auth.js";
import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";
import { getChannelFiles, getChannelPinnedMessages, createOrCheckChannel } from "../controllers/channel.controller.js";

router.use(verifyToken);

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const getDms = req.query.get_dms !== "false";

    const channels = await prisma.channels.findMany({
      where: {
        AND: [
          getDms ? {} : { is_dm: false },
          {
            OR: [
              { is_private: false },
              {
                channel_members: {
                  some: { user_id: userId },
                },
              },
            ],
          },
        ],
      },
      orderBy: {
        created_at: "desc",
      },
    });

    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

// router.get("/:channelId/messages", async (req, res) => {
//   const channelId = Number(req.params.channelId);
//   const limit = Number(req.query.limit) || 20;
//   const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  
//   const channel = await prisma.channels.findUnique({
//   where: { id: channelId },
//   include: { channel_members: true },
// });

// if (channel.is_private) {
//   const memberIds = channel.channel_members.map((m) => m.user_id);
//   if (!memberIds.includes(req.user.id)) {
//     return res.status(403).json({ error: "Forbidden" });
//   }
// }

//   try {

//     const messages = await prisma.messages.findMany({
//       where: {
//         channel_id: channelId,
//       },
//       include: {
//         users: {
//           select: {
//             name: true,
//             avatar_url: true,
//           },
//         },
//       },
//       orderBy: {
//         id: "desc", // newest first
//       },
//       take: limit,
//       ...(cursor && {
//         cursor: { id: cursor },
//         skip: 1, // skip the cursor message itself
//       }),
//     });

//     const formatted = messages
//       .map(m => ({
//         id: m.id,
//         channel_id: m.channel_id,
//         sender_id: m.sender_id,
//         content: m.content,
//         files: m.files,
//         reactions: m.reactions,
//         pinned: m.pinned,
//         created_at: m.created_at,
//         updated_at: m.updated_at,
//         sender_name: m.users?.name ?? null,
//         avatar_url: m.users?.avatar_url ?? null,
//       }))
//       .reverse(); // oldest → newest for UI

//     res.json({
//       messages: formatted,
//       nextCursor: messages.length ? messages[messages.length - 1].id : null,
//     });
//   } catch (err) {
//     console.error("Prisma messages error:", err);
//     res.status(500).json({
//       error: "DB Error",
//       details: err.message,
//     });
//   }
// });

router.get("/:channelId/messages", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const limit = Number(req.query.limit) || 20;
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;

  // ... your channel membership checks ...

  try {
    const messages = await prisma.messages.findMany({
      where: {
        channel_id: channelId,
        ...(cursor && { id: { lt: cursor } }), // get older than cursor
      },
      include: {
        users: {
          select: {
            name: true,
            avatar_url: true,
          },
        },
      },
      orderBy: {
        id: "desc", // newest first
      },
      take: limit,
    });

    const formatted = messages
      .map((m) => ({
        id: m.id,
        channel_id: m.channel_id,
        sender_id: m.sender_id,
        content: m.content,
        files: m.files,
        reactions: m.reactions,
        pinned: m.pinned,
        created_at: m.created_at,
        updated_at: m.updated_at,
        sender_name: m.users?.name ?? null,
        avatar_url: m.users?.avatar_url ?? null,
      }))
      .reverse(); // oldest → newest for UI

    const nextCursor =
      messages.length === limit ? messages[messages.length - 1].id : null;

    res.json({
      messages: formatted,
      nextCursor,
    });
  } catch (err) {
    console.error("Prisma messages error:", err);
    res.status(500).json({
      error: "DB Error",
      details: err.message,
    });
  }
});

router.get("/:channelId/members", async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);

    // 1️⃣ Get channel info
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        name: true,
        is_private: true,
      },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // 2️⃣ Get members
    const members = await prisma.channel_members.findMany({
      where: { channel_id: channelId },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
    });

    // 3️⃣ Return combined response
    res.json({
      channel,
      members: members.map((m) => m.users),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});


// router.post("/", async (req, res) => {
//   try {
//     const { name, isPrivate, memberIds = [] } = req.body;

//     // TEMP: hard-coded user (replace with req.user.id later)
//     const userId = req.user.id;

//     if (!name || !name.trim()) {
//       return res.status(400).json({ error: "Channel name required" });
//     }

//     // ❌ Private channel must have members
//     if (isPrivate && memberIds.length === 0) {
//       return res.status(400).json({ error: "Private channel needs members" });
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       // 1️⃣ Create channel
//       const channel = await tx.channels.create({
//         data: {
//           name: name.trim(),
//           is_private: isPrivate ?? false,
//           is_dm: false,
//           created_by: userId,
//         },
//       });

//       // 🟢 PUBLIC CHANNEL → NO MEMBERS
//       if (!isPrivate) {
//         return {
//           id: channel.id,
//           name: channel.name,
//           isPrivate: false,
//         };
//       }

//       // res.json(memberIds);

//       // 🔒 PRIVATE CHANNEL → ADD MEMBERS
//       const uniqueMemberIds = Array.from(new Set([userId, ...memberIds]));

//       await tx.channel_members.createMany({
//         data: uniqueMemberIds.map((uid) => ({
//           channel_id: channel.id,
//           user_id: uid,
//         })),
//         skipDuplicates: true, // matches INSERT IGNORE behavior
//       });

//       return {
//         id: channel.id,
//         name: channel.name,
//         isPrivate: true,
//         members: uniqueMemberIds,
//       };
//     });

//     res.status(201).json(result);
//     io.emit("channelCreated", {
//       id: result.id,
//       name: result.name,
//       isPrivate: result.isPrivate,
//     });
//   } catch (err) {
//     console.error("Create channel error:", err);
//     res.status(500).json({
//       error: "Channel creation failed",
//       details: err.message,
//     });
//   }
// });


// new
router.post("/", createOrCheckChannel);
// new end


router.post("/:channelId/join", async (req, res) => {
  const userId = req.user.id;

  const channelId = Number(req.params.channelId);

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_private) {
      return res.status(403).json({ error: "Cannot join private channel" });
    }

    // Equivalent to INSERT IGNORE
    await prisma.channel_members.upsert({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
      update: {},
      create: {
        channel_id: channelId,
        user_id: userId,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Join failed" });
  }
});

router.get("/:id", async (req, res) => {
  const channelId = Number(req.params.id);
  const userId = req.user.id; // get logged-in user from middleware

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
    });
    if (!channel) return res.status(404).json({ error: "Not found" });

    if (channel.is_dm) {
      const dmUser = await prisma.channel_members.findFirst({
        where: {
          channel_id: channelId,
          user_id: { not: userId }, // only gets the "other" user
        },
        include: {
          users: { select: { id: true, name: true, avatar_url: true } },
        },
      });

      return res.json({
        channel,
        dm_user: dmUser?.users ?? null,
      });
    }

    // Normal channel
    const members = await prisma.channel_members.findMany({
      where: { channel_id: channelId },
      include: { users: { select: { id: true, name: true, email: true } } },
    });

    res.json({ channel, members: members.map((m) => m.users) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.post("/:channelId/pin/:messageId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const userId = req.user.id;

  try {
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { is_private: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_private) {
      const isMember = await prisma.channel_members.findUnique({
        where: {
          channel_id_user_id: {
            channel_id: channelId,
            user_id: userId,
          },
        },
      });

      if (!isMember) {
        return res.status(403).json({ error: "Not a channel member" });
      }
    }

    const message = await prisma.messages.findFirst({
      where: {
        id: messageId,
        channel_id: channelId,
      },
      select: { pinned: true },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.pinned) {
      return res.status(400).json({ error: "Message already pinned" });
    }

    await prisma.messages.update({
      where: { id: messageId },
      data: {
        pinned: "1",
        // pinned_by: userId,
        // pinned_at: new Date(),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});



// files and pin api
router.get("/:channelId/files", getChannelFiles);
router.get("/:channelId/pinned", getChannelPinnedMessages);
// files and pin api end

router.delete("/:channelId/pin/:messageId", async (req, res) => {
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  // const userId = req.user.id;
  const userId = req.user.id;

  try {
    const message = await prisma.messages.findFirst({
      where: {
        id: messageId,
        channel_id: channelId,
      },
      include: {
        channels: {
          select: { created_by: true },
        },
      },
    });

    if (!message || !message.pinned) {
      return res.status(404).json({ error: "Message not pinned or not found" });
    }

    if (
      String(message.pinned_by) !== String(userId) &&
      String(message.channels.created_by) !== String(userId)
    ) {
      return res.status(403).json({ error: "Not allowed to unpin" });
    }

    await prisma.messages.update({
      where: { id: messageId },
      data: {
        pinned: null,
        pinned_by: null,
        pinned_at: null,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB Error" });
  }
});

router.get("/:channelId/pins", (req, res) => {
  const { channelId } = req.params;

  const sql = `
    SELECT
      m.id,
      m.content,
      m.sender_id,
      u.name AS sender_name,
      u.avatar_url,
      m.pinned_by,
      p.name AS pinner_name,
      m.pinned_at
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN users p ON p.id = m.pinned_by
    WHERE m.channel_id = ? AND m.pinned = 1
    ORDER BY m.pinned_at DESC
  `;
  db.query(sql, [channelId], (err, rows) => {
    if (err) return res.status(500).json({ error: "DB Error" });
    res.json(rows);
  });
});

router.post("/:channelId/leave", async (req, res) => {
  try {
    const userId = req.user.id;
    const channelId = Number(req.params.channelId);

    if (!channelId) {
      return res.status(400).json({ error: "Invalid channel id" });
    }

    // Check channel exists
    const channel = await prisma.channels.findUnique({
      where: { id: channelId },
      select: { id: true, is_private: true, is_dm: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.is_dm) {
      return res.status(400).json({ error: "Cannot leave DM channel" });
    }

    // Check membership
    const membership = await prisma.channel_members.findUnique({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
    });

    if (!membership) {
      return res.status(400).json({ error: "You are not a member of this channel" });
    }

    // Remove membership
    await prisma.channel_members.delete({
      where: {
        channel_id_user_id: {
          channel_id: channelId,
          user_id: userId,
        },
      },
    });

    // OPTIONAL: if private channel and no members left → delete channel
    if (channel.is_private) {
      const remaining = await prisma.channel_members.count({
        where: { channel_id: channelId },
      });

      if (remaining === 0) {
        await prisma.channels.delete({ where: { id: channelId } });
      }
    }

    io.to(`channel_${channelId}`).emit("userLeftChannel", {
      channelId,
      userId,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("Leave channel error:", err);
    res.status(500).json({ error: "Failed to leave channel" });
  }
});

router.get("/messages/:messageId/download", async (req, res) => {
  const messageId = Number(req.params.messageId);
  const userId = req.user.id;

  try {
    const message = await prisma.messages.findUnique({
      where: { id: messageId },
      select: {
        files: true,
        channel_id: true,
      },
    });

    if (!message || !message.files) {
      return res.status(404).json({ error: "File not found" });
    }

    // 🔐 Check channel access
    const isMember = await prisma.channel_members.findFirst({
      where: {
        channel_id: message.channel_id,
        user_id: userId,
      },
    });

    if (!isMember) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 🧠 Resolve file path
    const filePath = path.join(
      process.cwd(),
      "uploads",
      message.files
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File missing on server" });
    }

    // ✅ THIS triggers browser download
    res.download(filePath);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
});


router.post(
  "/messages/:messageId/forward/:channelId",
  async (req, res) => {
    const messageId = Number(req.params.messageId);
    const channelId = Number(req.params.channelId);
    const userId = req.user.id;

    try {
      const original = await prisma.messages.findUnique({
        where: { id: messageId },
        select: {
          files: true,
        },
      });

      if (!original || !original.files) {
        return res.status(404).json({ error: "File not found" });
      }

      const newMessage = await prisma.messages.create({
        data: {
          channel_id: channelId,
          sender_id: userId,
          content: null,
          files: original.files,
        },
      });

      io.to(`channel_${channelId}`).emit("newMessage", newMessage);

      res.json({ success: true, message: newMessage });
    } catch (err) {
      console.error("Forward error:", err);
      res.status(500).json({ error: "Forward failed" });
    }
  }
);




export default router;
