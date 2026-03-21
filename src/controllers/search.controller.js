import prisma from "../config/prisma.js";

/**
 * Unified Slack-style search
 * GET /search?q=<query>
 *
 * Prefix rules:
 *   #<term>       → channels matching name, + messages within that channel
 *   @<term>       → people matching name
 *   <term>        → channels + people + messages (global)
 */
export const searchAll = async (req, res) => {
  const userId = req.user?.id;
  const rawQ = typeof req.query.q === "string" ? req.query.q : "";

  if (!rawQ.trim()) {
    return res.status(400).json({ success: false, message: "Query required" });
  }

  // ── Parse prefix ──────────────────────────────────────────────────────────
  let mode = "all";
  let term = rawQ.trim();
  let messageQuery = "";

  try {
    if (term.startsWith("#")) {
      mode = "channel";
      const withoutHash = term.slice(1);
      
      const visibleChannels = await prisma.channels.findMany({
        where: {
          is_dm: false,
          OR: [
            { is_private: false },
            { channel_members: { some: { user_id: userId } } },
          ],
        },
        select: { id: true, name: true, is_private: true },
      });

      let matchedChannel = null;
      let longestMatchLen = 0;
      for (const c of visibleChannels) {
        const cName = c.name.toLowerCase();
        if (withoutHash.toLowerCase().startsWith(cName)) {
           if (withoutHash.length === cName.length || withoutHash[cName.length] === ' ') {
             if (cName.length > longestMatchLen) {
               longestMatchLen = cName.length;
               matchedChannel = c;
             }
           }
        }
      }

      if (matchedChannel) {
        term = matchedChannel.name;
        messageQuery = withoutHash.slice(longestMatchLen).trim();
      } else {
        const spaceIdx = withoutHash.indexOf(" ");
        if (spaceIdx !== -1) {
          term = withoutHash.slice(0, spaceIdx);
          messageQuery = withoutHash.slice(spaceIdx + 1).trim();
        } else {
          term = withoutHash;
        }
      }
    } else if (term.startsWith("@")) {
      mode = "people";
      const withoutAt = term.slice(1);
      
      const users = await prisma.users.findMany({
         where: { id: { not: userId } },
         select: { id: true, name: true, email: true, avatar_url: true }
      });

      let matchedUser = null;
      let longestMatchLen = 0;
      for (const u of users) {
        const uName = u.name.toLowerCase();
        if (withoutAt.toLowerCase().startsWith(uName)) {
           if (withoutAt.length === uName.length || withoutAt[uName.length] === ' ') {
             if (uName.length > longestMatchLen) {
               longestMatchLen = uName.length;
               matchedUser = u;
             }
           }
        }
      }

      if (matchedUser) {
        term = matchedUser.name;
        messageQuery = withoutAt.slice(longestMatchLen).trim();
      } else {
        const spaceIdx = withoutAt.indexOf(" ");
        if (spaceIdx !== -1) {
          term = withoutAt.slice(0, spaceIdx);
          messageQuery = withoutAt.slice(spaceIdx + 1).trim();
        } else {
          term = withoutAt;
        }
      }
    }

    const q = term;

    // ── 1. Channels ───────────────────────────────────────────────────────────
    const channels =
      mode === "people"
        ? []
        : await prisma.channels.findMany({
            where: {
              is_dm: false,
              ...(q ? { name: { contains: q } } : {}),
              OR: [
                { is_private: false },
                { channel_members: { some: { user_id: userId } } },
              ],
            },
            select: {
              id: true,
              name: true,
              is_private: true,
            },
            orderBy: { name: "asc" },
            take: 5,
          });

    // ── 2. People ─────────────────────────────────────────────────────────────
    const rawPeople =
      mode === "channel"
        ? []
        : await prisma.users.findMany({
            where: {
              id: { not: userId },
              ...(q
                ? {
                    OR: [
                      { name: { contains: q } },
                      { email: { contains: q } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              name: true,
              email: true,
              avatar_url: true,
              is_online: true,
              last_seen: true,
            },
            orderBy: { name: "asc" },
            take: 5,
          });

    const people = await Promise.all(
      rawPeople.map(async (person) => {
        const dmChannel = await prisma.channels.findFirst({
          where: {
            is_dm: true,
            channel_members: { some: { user_id: userId } },
            AND: { channel_members: { some: { user_id: person.id } } },
          },
          select: { id: true },
        });
        return {
          ...person,
          avatar_url: person.avatar_url ?? null,
          dm_channel_id: dmChannel?.id ?? null,
          kind: "person",
        };
      })
    );

    // ── 3. Messages ───────────────────────────────────────────────────────────
    let messages = [];

    const shouldSearchMessages = mode === "all" || mode === "channel" || mode === "people";

    if (shouldSearchMessages) {
      let scopedChannelIds = [];
      let channelMap = {};

      if (mode === "channel" && channels.length > 0) {
        scopedChannelIds = channels.map((c) => c.id);
        channelMap = Object.fromEntries(
          channels.map((c) => [c.id, { name: c.name, is_dm: false }])
        );
      } else if (mode === "people" && people.length > 0) {
        scopedChannelIds = people.map((p) => p.dm_channel_id).filter(id => id !== null);
        for (const p of people) {
          if (p.dm_channel_id) {
            channelMap[p.dm_channel_id] = { name: p.name, is_dm: true };
          }
        }
      } else if (mode === "all") {
        const visibleChannels = await prisma.channels.findMany({
          where: {
            OR: [
              { is_private: false },
              { channel_members: { some: { user_id: userId } } },
            ],
          },
          select: { id: true, name: true, is_dm: true },
        });
        scopedChannelIds = visibleChannels.map((c) => c.id);
        channelMap = Object.fromEntries(
          visibleChannels.map((c) => [c.id, { name: c.name, is_dm: c.is_dm }])
        );
      }

      const effectiveQuery = mode === "all" ? q : messageQuery;

      if (scopedChannelIds.length > 0) {
        const threadsInChannels = await prisma.threads.findMany({
          where: { channel_id: { in: scopedChannelIds } },
          select: { id: true, channel_id: true }
        });
        const threadIds = threadsInChannels.map(t => t.id);

        const rawMessages = await prisma.messages.findMany({
          where: {
            OR: [
              { channel_id: { in: scopedChannelIds } },
              ...(threadIds.length > 0 ? [{ thread_parent_id: { in: threadIds } }] : [])
            ],
            content: effectiveQuery
              ? { contains: effectiveQuery, not: null }
              : { not: null },
          },
          select: {
            id: true,
            content: true,
            created_at: true,
            channel_id: true,
            thread_parent_id: true,
            users: {
              select: { id: true, name: true, avatar_url: true },
            },
          },
          orderBy: { created_at: "desc" },
          take: 8,
        });

        const threadToChannelMap = Object.fromEntries(
          threadsInChannels.map(t => [t.id, t.channel_id])
        );

        messages = rawMessages.map((m) => {
          const mChannelId = m.channel_id || threadToChannelMap[m.thread_parent_id];
          return {
            id: m.id,
            content: m.content,
            created_at: m.created_at,
            channel_id: mChannelId,
            thread_parent_id: m.thread_parent_id ?? null,
            channel_name: mChannelId ? (channelMap[mChannelId]?.name ?? null) : null,
            is_dm_channel: mChannelId ? (channelMap[mChannelId]?.is_dm ?? false) : false,
            sender_name: m.users?.name ?? null,
            sender_avatar: m.users?.avatar_url ?? null,
            kind: "message",
          };
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: { channels, people, messages },
    });
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ success: false, message: "DB Error" });
  }
};
