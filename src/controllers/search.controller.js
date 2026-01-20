import prisma from "../config/prisma.js";

/**
 * Global + scoped search
 * GET /search?q=keyword&channelId=&userId=
 */
export const searchAll = async (req, res) => {
  const { q, channelId, userId } = req.query;

  if (!q || q.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Query required",
    });
  }

  try {
    // ---------------- USERS (global only) ----------------
    const users = !channelId && !userId
      ? await prisma.users.findMany({
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
        })
      : [];

    // ---------------- CHANNELS (global only) ----------------
    const channels = !channelId
      ? await prisma.channels.findMany({
          where: {
            name: { contains: q },
          },
          select: {
            id: true,
            name: true,
          },
          take: 50,
        })
      : [];

    // ---------------- MESSAGES (content + files) ----------------
    const messages = await prisma.messages.findMany({
      where: {
        ...(channelId && { channel_id: Number(channelId) }),
        ...(userId && { sender_id: Number(userId) }),
        OR: [
          { content: { contains: q } },
          { files: { contains: q } },
        ],
      },
      select: {
        id: true,
        content: true,
        files: true,
        channel_id: true,
        sender_id: true,
      },
      take: 50,
    });

    res.status(200).json({
      success: true,
      data: {
        users,
        channels,
        messages,
      },
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      success: false,
      message: "DB Error",
    });
  }
};


// import prisma from "../config/prisma.js";

// /**
//  * Global search (users, channels, messages)
//  * GET /search?q=keyword
//  */
// export const searchAll = async (req, res) => {
//   const { q } = req.query;

//   if (!q || q.trim() === "") {
//     return res.status(400).json({ error: "Query required" });
//   }

//   try {
//     const [users, channels, messages] = await Promise.all([
//       // USERS
//       prisma.users.findMany({
//         where: {
//           OR: [
//             { name: { contains: q } },
//             { email: { contains: q } },
//           ],
//         },
//         select: {
//           id: true,
//           name: true,
//           email: true,
//         },
//         take: 50,
//       }),

//       // CHANNELS
//       prisma.channels.findMany({
//         where: {
//           name: { contains: q },
//         },
//         select: {
//           id: true,
//           name: true,
//         },
//         take: 50,
//       }),

//       // MESSAGES
//       prisma.messages.findMany({
//         where: {
//           content: { contains: q },
//         },
//         select: {
//           id: true,
//           content: true,
//           channel_id: true,
//           sender_id: true,
//         },
//         take: 50,
//       }),
//     ]);

//     res.json({
//       users,
//       channels,
//       messages,
//     });
//   } catch (err) {
//     console.error("Search error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// };
    