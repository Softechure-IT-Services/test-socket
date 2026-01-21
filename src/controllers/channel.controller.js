import prisma from "../config/prisma.js";

export const getChannelFiles = async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel id",
      });
    }

    const messages = await prisma.messages.findMany({
      where: {
        channel_id: channelId,
        AND:[
          { files: { not: null } },
          { files: { not: "[]" } },
          { files: { not: "" } },
        ]
      },
      select: {
        id: true,
        files: true,
        created_at: true,
        users: {
          select: {
            id: true,
            name: true,
            avatar_url: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const files = messages.map(m => ({
      message_id: m.id,
      file: m.files, // parse if JSON string
      created_at: m.created_at,
      sender: {
        id: m.users.id,
        name: m.users.name,
        avatar_url: m.users.avatar_url,
      },
    }));

    res.status(200).json({
      success: true,
      data: {
        channel_id: channelId,
        total: files.length,
        files,
      },
    });
  } catch (error) {
    console.error("Get channel files error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


export const getChannelPinnedMessages = async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel id",
      });
    }

    const messages = await prisma.messages.findMany({
      where: {
        channel_id: channelId,
        pinned: {
          not: null,
        },
      },
      select: {
        id: true,
        content: true,
        pinned: true,
        created_at: true,
        updated_at: true,
        users: {
          select: {
            id: true,
            name: true,
            avatar_url: true,
          },
        },
      },
      orderBy: {
        updated_at: "desc", // most recently pinned first
      },
    });

    const pinnedMessages = messages.map(m => ({
      message_id: m.id,
      content: m.content,
      pinned: m.pinned, // metadata if any
      created_at: m.created_at,
      updated_at: m.updated_at,
      sender: {
        id: m.users.id,
        name: m.users.name,
        avatar_url: m.users.avatar_url,
      },
    }));

    res.status(200).json({
      success: true,
      data: {
        channel_id: channelId,
        total: pinnedMessages.length,
        pinned_messages: pinnedMessages,
      },
    });
  } catch (error) {
    console.error("Get pinned messages error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
