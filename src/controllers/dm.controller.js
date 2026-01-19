import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Create or get existing DM between two users
 */
export const createOrGetDM = async (req, res) => {
  // TEMP: hardcoded until auth middleware is enabled
  const userId = 87;
  const otherUserId = Number(req.params.otherUserId);

  if (!otherUserId || otherUserId === userId) {
    return res.status(400).json({ error: "Invalid user" });
  }

  try {
    // 1️⃣ Check if DM already exists
    const existingDM = await prisma.channels.findFirst({
      where: {
        is_dm: true,
        channel_members: {
          every: {
            user_id: {
              in: [userId, otherUserId],
            },
          },
        },
      },
      select: { id: true },
    });

    if (existingDM) {
      return res.json({ dm_id: existingDM.id });
    }

    // 2️⃣ Create DM + members in transaction
    const dmChannel = await prisma.$transaction(async (tx) => {
      return tx.channels.create({
        data: {
          name: "DM",
          is_private: true,
          is_dm: true,
          created_by: userId,
          channel_members: {
            create: [
              { user_id: userId },
              { user_id: otherUserId },
            ],
          },
        },
        select: { id: true },
      });
    });

    res.json({ dm_id: dmChannel.id });
  } catch (err) {
    console.error("DM creation error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * List all DMs for logged-in user
 */
export const listMyDMs = async (req, res) => {
  // TEMP: hardcoded until auth middleware is enabled
  const userId = 87;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const dms = await prisma.channels.findMany({
      where: {
        is_dm: true,
        channel_members: {
          some: {
            user_id: userId,
          },
        },
      },
      orderBy: { id: "desc" },
      select: {
        id: true,
        is_private: true,
        is_dm: true,
        channel_members: {
          where: {
            user_id: { not: userId },
          },
          select: {
            users: {
              select: {
                id: true,
                name: true,
                avatar_url: true,
              },
            },
          },
        },
      },
    });

    const result = dms.map((dm) => {
      const otherUser = dm.channel_members[0]?.users;
      return {
        id: dm.id,
        other_user_id: otherUser?.id,
        name: otherUser?.name,
        avatar_url: otherUser?.avatar_url,
        is_private: dm.is_private,
        is_dm: dm.is_dm,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("DM fetch error:", err);
    res.status(500).json({ error: err.message });
  }
};
