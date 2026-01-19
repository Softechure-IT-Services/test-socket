import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Global search (users, channels, messages)
 * GET /search?q=keyword
 */
export const searchAll = async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim() === "") {
    return res.status(400).json({ error: "Query required" });
  }

  try {
    const [users, channels, messages] = await Promise.all([
      // USERS
      prisma.users.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
        take: 50,
      }),

      // CHANNELS
      prisma.channels.findMany({
        where: {
          name: { contains: q },
        },
        select: {
          id: true,
          name: true,
        },
        take: 50,
      }),

      // MESSAGES
      prisma.messages.findMany({
        where: {
          content: { contains: q },
        },
        select: {
          id: true,
          content: true,
          channel_id: true,
          sender_id: true,
        },
        take: 50,
      }),
    ]);

    res.json({
      users,
      channels,
      messages,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "DB Error" });
  }
};
    