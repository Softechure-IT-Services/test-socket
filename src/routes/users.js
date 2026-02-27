import express from "express";
import verifyToken from "../middleware/auth.js";

const router = express.Router();
import {
  getAllUsers,
  getUserById,
  searchUsers,
  updateUser,
  setUserOnlineStatus,
  getUserChannels,
  getUserMessages,
} from "../controllers/user.controller.js";

// Get all users
router.get("/", verifyToken, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Search users
router.get("/search", verifyToken, async (req, res) => {
  try {
    const { q = "", exclude } = req.query;
    if (!q.trim()) return res.json([]);
    const users = await searchUsers(q, exclude);
    res.json(users);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Get single user
// Guard: reject non-numeric segments so GET /users/me is never caught here
// (the /me route lives in profile.js and must be mounted before this router)
router.get("/:userId", async (req, res) => {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid user ID." });
  }
  try {
    const user = await getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Create user
// router.post("/", async (req, res) => {
//   try {
//     const user = await createUser(req.body);
//     res.status(201).json(user);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// Update user
router.put("/:userId", async (req, res) => {
  try {
    const user = await updateUser(req.params.userId, req.body);
    res.json(user);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Set user online
router.post("/:userId/online", async (req, res) => {
  try {
    const user = await setUserOnlineStatus(req.params.userId, true);
    res.json(user);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Set user offline
router.post("/:userId/offline", async (req, res) => {
  try {
    const user = await setUserOnlineStatus(req.params.userId, false);
    res.json(user);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Get channels the user is in
router.get("/:userId/channels", async (req, res) => {
  try {
    const channels = await getUserChannels(req.params.userId);
    res.json(channels.map(c => c.channel));
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

// Get messages sent by the user
router.get("/:userId/messages", async (req, res) => {
  try {
    const messages = await getUserMessages(req.params.userId);
    res.json(messages);
  } catch (err) {
    console.error("Prisma error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

export default router;


// import express from "express";
// import verifyToken from "../middleware/auth.js";

// const router = express.Router();
// import {
//   getAllUsers,
//   getUserById,
//   searchUsers,
//   updateUser,
//   setUserOnlineStatus,
//   getUserChannels,
//   getUserMessages,
// } from "../controllers/user.controller.js";

// // Get all users
// router.get("/", verifyToken, async (req, res) => {
//   try {
//     const users = await getAllUsers();
//     res.json(users);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Search users
// router.get("/search", verifyToken, async (req, res) => {
//   try {
//     const { q = "", exclude } = req.query;
//     if (!q.trim()) return res.json([]);
//     const users = await searchUsers(q, exclude);
//     res.json(users);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Get single user
// router.get("/:userId", async (req, res) => {
//   try {
//     const user = await getUserById(req.params.userId);
//     if (!user) return res.status(404).json({ error: "User not found" });
//     res.json(user);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Create user
// // router.post("/", async (req, res) => {
// //   try {
// //     const user = await createUser(req.body);
// //     res.status(201).json(user);
// //   } catch (err) {
// //     console.error("Prisma error:", err);
// //     res.status(500).json({ error: "DB Error" });
// //   }
// // });

// // Update user
// router.put("/:userId", async (req, res) => {
//   try {
//     const user = await updateUser(req.params.userId, req.body);
//     res.json(user);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Set user online
// router.post("/:userId/online", async (req, res) => {
//   try {
//     const user = await setUserOnlineStatus(req.params.userId, true);
//     res.json(user);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Set user offline
// router.post("/:userId/offline", async (req, res) => {
//   try {
//     const user = await setUserOnlineStatus(req.params.userId, false);
//     res.json(user);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Get channels the user is in
// router.get("/:userId/channels", async (req, res) => {
//   try {
//     const channels = await getUserChannels(req.params.userId);
//     res.json(channels.map(c => c.channel));
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// // Get messages sent by the user
// router.get("/:userId/messages", async (req, res) => {
//   try {
//     const messages = await getUserMessages(req.params.userId);
//     res.json(messages);
//   } catch (err) {
//     console.error("Prisma error:", err);
//     res.status(500).json({ error: "DB Error" });
//   }
// });

// export default router;
