// dm.controller.js
import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";
import { withPresencePrivacy } from "../utils/userPreferences.js";

export const createOrGetDM = async (req, res) => {
  const userId = req.user.id;
  const otherUserId = Number(req.params.otherUserId);

  if (!otherUserId || otherUserId === userId) {
    return res.status(400).json({ error: "Invalid user" });
  }

  try {
    // 1. Check if DM already exists
    const existingDM = await prisma.channels.findFirst({
      where: {
        is_dm: true,
        channel_members: {
          every: {
            user_id: { in: [userId, otherUserId] },
          },
        },
      },
      select: { id: true },
    });

    if (existingDM) {
      return res.json({ dm_id: existingDM.id });
    }

    // 2. Create DM
    const dmChannel = await prisma.channels.create({
      data: {
        name: `DM_${userId}_${otherUserId}_${Date.now()}`,
        is_private: true,
        is_dm: true,
        created_by: userId,
        channel_members: {
          create: [{ user_id: userId }, { user_id: otherUserId }],
        },
      },
      select: { id: true },
    });

    if (io) {
      io.to(`user_${userId}`).emit("dmCreated", {});
      io.to(`user_${otherUserId}`).emit("dmCreated", {});
    }

    res.json({ dm_id: dmChannel.id });
  } catch (err) {
    console.error("createOrGetDM error:", err);
    res.status(500).json({ error: "Failed to create/get DM" });
  }
};

export const listMyDMs = async (req, res) => {
  const userId = req.user.id;

  try {
    const dms = await prisma.channels.findMany({
      where: {
        is_dm: true,
        channel_members: { some: { user_id: userId } },
      },
      orderBy: { updated_at: "desc" },
      include: {
        channel_members: {
          where: { user_id: { not: userId } },
          include: {
            users: {
              select: {
                id: true,
                name: true,
                username:true,
                avatar_url: true,
                status:true,
                is_online: true,
                is_huddling: true, // ✅ Include huddling status
                last_seen: true,
              },
            },
          },
        },
      },
    });

    const otherUsers = dms
      .map((dm) => dm.channel_members[0]?.users)
      .filter(Boolean);
    const sanitizedOtherUsers = await withPresencePrivacy(otherUsers, userId);
    const sanitizedById = new Map(
      sanitizedOtherUsers.map((entry) => [String(entry.id), entry])
    );

    const formatted = dms.map((dm) => {
      const rawOtherUser = dm.channel_members[0]?.users;
      const otherUser =
        sanitizedById.get(String(rawOtherUser?.id)) ?? rawOtherUser;
      return {
        id: dm.id,
        other_user_id: otherUser?.id,
        name: otherUser?.name,
        username: otherUser?.username,
        avatar_url: otherUser?.avatar_url,
        status: otherUser?.status,
        is_online: !!otherUser?.is_online,
        is_huddling: !!otherUser?.is_huddling,
        last_seen: otherUser?.last_seen,
        presence_hidden: !!otherUser?.presence_hidden,
        is_private: dm.is_private,
        is_dm: dm.is_dm,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("listMyDMs error:", err);
    res.status(500).json({ error: "Failed to fetch DMs" });
  }
};
