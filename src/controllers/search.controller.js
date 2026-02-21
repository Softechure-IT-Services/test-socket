import prisma from "../config/prisma.js";

/**
 * Unified Slack-style search
 * GET /search?q=<query>
 *
 * Prefix rules:
 *   #<term>       → channels matching name, + messages within that channel
 *   @<term>       → people matching name
 *   <term>        → channels + people + messages (global)
 *
 * When MainHeader fires focusNavSearch with prefill "#general ", the query
 * arrives as "#general " — we trim the term so "general " → "general".
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

  if (term.startsWith("#")) {
    mode = "channel";
    term = term.slice(1).trim(); // ← .trim() removes trailing space from prefill
  } else if (term.startsWith("@")) {
    mode = "people";
    term = term.slice(1).trim(); // ← same fix here
  }

  // term may now be empty (e.g. user just typed "#" or "@") — that's fine,
  // we show all channels / all people in that case.
  const q = term;

  try {
    // ── 1. Channels ───────────────────────────────────────────────────────────
    const channels =
      mode === "people"
        ? []
        : await prisma.channels.findMany({
            where: {
              is_dm: false,
              // Only filter by name if there's an actual term
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
              // Only filter by name/email if there's an actual term
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
    // Runs for:
    //   mode === "all"     → search everywhere (requires a term)
    //   mode === "channel" → search messages inside matched channels (even empty term
    //                        shows recent messages in that channel)
    let messages = [];

    const shouldSearchMessages = mode === "all" || mode === "channel";

    if (shouldSearchMessages) {
      // Determine which channel IDs to scope message search to
      let scopedChannelIds = [];
      let channelMap = {};

      if (mode === "channel" && channels.length > 0) {
        // Scope to the channels found by the # search
        scopedChannelIds = channels.map((c) => c.id);
        channelMap = Object.fromEntries(
          channels.map((c) => [c.id, { name: c.name, is_dm: false }])
        );
      } else if (mode === "all") {
        // All channels visible to the user
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

      if (scopedChannelIds.length > 0) {
        const rawMessages = await prisma.messages.findMany({
          where: {
            channel_id: { in: scopedChannelIds },
            // content must not be null, and optionally must contain the search term
            content: q
              ? { contains: q, not: null }
              : { not: null },
          },
          select: {
            id: true,
            content: true,
            created_at: true,
            channel_id: true,
            users: {
              select: { id: true, name: true, avatar_url: true },
            },
          },
          orderBy: { created_at: "desc" },
          take: 8,
        });

        messages = rawMessages.map((m) => ({
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          channel_id: m.channel_id,
          channel_name: m.channel_id ? (channelMap[m.channel_id]?.name ?? null) : null,
          is_dm_channel: m.channel_id ? (channelMap[m.channel_id]?.is_dm ?? false) : false,
          sender_name: m.users?.name ?? null,
          sender_avatar: m.users?.avatar_url ?? null,
          kind: "message",
        }));
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