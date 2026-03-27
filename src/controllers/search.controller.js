import prisma from "../config/prisma.js";

export const searchAll = async (req, res) => {
  const userId = req.user.id;
  const { q } = req.query;

  if (!q) return res.json({ messages: [], channels: [], users: [] });

  try {
    const [messages, channels, users] = await Promise.all([
      prisma.messages.findMany({
        where: {
          content: { contains: q },
          OR: [
            { channel_id: null }, // DM messages handles differently? No, let's just search all accessible
            {
              channel: {
                OR: [
                  { is_private: false },
                  { channel_members: { some: { user_id: userId } } },
                ],
              },
            },
          ],
        },
        include: {
          users: { select: { name: true, username: true, avatar_url: true } },
          channel: {
            select: {
              name: true,
              is_dm: true,
              channel_members: {
                where: { user_id: { not: userId } },
                select: { users: { select: { username: true } } },
                take: 1,
              },
            },
          },
          // Include thread relation so we can expose the parent
          // message id for thread replies. This lets the client
          // reliably open the thread panel and highlight replies.
          thread: {
            select: {
              parent_message_id: true,
            },
          },
        },
        take: 20,
      }),
      prisma.channels.findMany({
        where: {
          name: { contains: q },
          is_dm: false,
          OR: [
            { is_private: false },
            { channel_members: { some: { user_id: userId } } },
          ],
        },
        take: 10,
      }),
      prisma.users.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { username: { contains: q } },
          ],
        },
        select: {
          id: true,
          name: true,
          username: true,
          avatar_url: true,
          is_online: true,
        },
        take: 10,
      }),
    ]);

    const mappedMessages = messages.map((m) => ({
      id: m.id,
      content: m.content,
      created_at: m.created_at,
      channel_id: m.channel_id,
      // For replies that belong to a thread, thread_parent_id is the
      // thread row id and thread.parent_message_id is the actual
      // parent message id. The client uses both:
      // - is_thread_reply + thread_parent_message_id to decide whether
      //   to auto-open the thread panel
      // - scrollTo (the reply id) to highlight inside the thread.
      thread_parent_id: m.thread_parent_id,
      thread_parent_message_id: m.thread?.parent_message_id ?? null,
      is_thread_reply: !!m.thread_parent_id,
      channel_name: m.channel?.is_dm
        ? m.channel.channel_members?.[0]?.users?.username || "Direct Message"
        : m.channel?.name || null,
      is_dm_channel: m.channel?.is_dm || false,
      sender_name: m.users?.username || m.users?.name || "Unknown",
      sender_avatar: m.users?.avatar_url || null,
      kind: "message",
    }));

    const mappedChannels = channels.map((c) => ({
      ...c,
      kind: "channel",
    }));

    const mappedPeople = users.map((u) => ({
      id: u.id,
      name: u.username || u.name,
      email: "", // email not selected in users query
      avatar_url: u.avatar_url,
      dm_channel_id: null, // need to fetch if existing?
      kind: "person",
    }));

    res.json({
      success: true,
      data: {
        messages: mappedMessages,
        channels: mappedChannels,
        people: mappedPeople,
      },
    });
  } catch (err) {
    console.error("searchAll error:", err);
    res.status(500).json({ error: "Search failed" });
  }
};
