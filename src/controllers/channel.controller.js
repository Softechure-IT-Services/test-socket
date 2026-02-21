import prisma from "../config/prisma.js";
import { io } from "../sockets/index.js";

// export const getChannelFiles = async (req, res) => {
//   try {
//     const channelId = Number(req.params.channelId);

//     if (!channelId) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid channel id",
//       });
//     }

//     const messages = await prisma.messages.findMany({
//       where: {
//         channel_id: channelId,
//         files: {
//           not: null,
//         },
//       },
//       select: {
//         id: true,
//         files: true,
//         created_at: true,
//         users: {
//           select: {
//             id: true,
//             name: true,
//             avatar_url: true,
//           },
//         },
//       },
//       orderBy: {
//         created_at: "desc",
//       },
//     });

//     const files = messages.map(m => ({
//       message_id: m.id,
//       file: m.files, // parse if JSON string
//       created_at: m.created_at,
//       sender: {
//         id: m.users.id,
//         name: m.users.name,
//         avatar_url: m.users.avatar_url,
//       },
//     }));

//     res.status(200).json({
//       success: true,
//       data: {
//         channel_id: channelId,
//         total: files.length,
//         files,
//       },
//     });
//   } catch (error) {
//     console.error("Get channel files error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };


export const getChannelFiles = async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    if (!channelId) {
      return res.status(400).json({ success: false, message: "Invalid channel id" });
    }

    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    // Fetch all messages with files for this channel (ordered newest first)
    // We can't paginate at DB level easily because one message can have multiple
    // files, so we fetch in batches of messages and flatten.
    // A pragmatic approach: fetch limit*2 messages per page to account for
    // multi-file messages, then trim to the correct slice of files.
    //
    // For large channels consider a dedicated file table; for now this is fine.

    const messages = await prisma.messages.findMany({
      where: {
        channel_id: channelId,
        AND: [
          { files: { not: null } },
          { files: { not: "[]" } },
          { files: { not: "" } },
        ],
      },
      select: {
        id: true,
        files: true,
        created_at: true,
        users: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    });

    const files = messages.flatMap((message) => {
      let parsedFiles = [];
      try {
        parsedFiles = JSON.parse(message.files);
      } catch {
        return [];
      }

      return parsedFiles.map((file) => ({
        message_id: message.id,
        created_at: message.created_at,
        sender: {
          id: message.users.id,
          name: message.users.name,
          avatar_url: message.users.avatar_url,
        },
        ...file,
      }));
    });

    res.status(200).json({
      success: true,
      data: {
        channel_id: channelId,
        page,
        limit,
        total: files.length,
        files,
      },
    });
  } catch (error) {
    console.error("Get channel files error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
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
       pinned:true,
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



export const createOrCheckChannel = async (req, res) => {
  console.log("Authenticated user:", req.user);
  try {
    const { name, isPrivate, memberIds = [], create = false } = req.body;
    const userId = req.user.id;
    // const userId = 87;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Channel name required",
      });
    }

    const channelName = name.trim();

    // 🔍 Check unique channel name
    const existingChannel = await prisma.channels.findFirst({
      where: {
        name: channelName,
      },
      select: {
        id: true,
      },
    });

    // ❌ Name already exists
    if (existingChannel) {
      return res.status(200).json({
        success: true,
        data: {
          available: false,
          message: "Channel name already exists",
        },
      });
    }

    // ✅ Only checking availability
    if (!create) {
      return res.status(200).json({
        success: true,
        data: {
          available: true,
          message: "Channel name is available",
        },
      });
    }

    // ❌ Private channel validation
    if (isPrivate && memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Private channel needs members",
      });
    }

    // 🔒 Create channel transaction
    const result = await prisma.$transaction(async (tx) => {
      const channel = await tx.channels.create({
        data: {
          name: channelName,
          is_private: isPrivate ?? false,
          is_dm: false,
          created_by: userId,
        },
      });

      // 🟢 Public channel
      if (!isPrivate) {
        return {
          id: channel.id,
          name: channel.name,
          isPrivate: false,
        };
      }

      // 🔐 Private channel members
      const uniqueMemberIds = Array.from(
        new Set([userId, ...memberIds])
      );

      await tx.channel_members.createMany({
        data: uniqueMemberIds.map((uid) => ({
          channel_id: channel.id,
          user_id: uid,
        })),
        skipDuplicates: true,
      });

      return {
        id: channel.id,
        name: channel.name,
        isPrivate: true,
        members: uniqueMemberIds,
      };
    });

    // 📢 Socket event
    // io.emit("channelCreated", {
    //   id: result.id,
    //   name: result.name,
    //   isPrivate: result.isPrivate,
    // });

    // 🔒 Only private members
if (result.isPrivate && result.members?.length > 0) {
  result.members.forEach((uid) => {
    io.to(`user_${uid}`).emit("channelCreated", {
      id: result.id,
      name: result.name,
      isPrivate: true,
      members: result.members,
    });
  });
} else {
  // Public channel → emit to everyone
  io.emit("channelCreated", {
    id: result.id,
    name: result.name,
    isPrivate: false,
  });
}

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Create channel error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
