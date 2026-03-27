// controllers/user.controller.js
import prisma from "../config/prisma.js";

/**
 * Get all users
 */
export const getAllUsers = async () => {
  return prisma.users.findMany({
    select: {
      id: true,
      external_id: true,
      name: true,
      username: true,
      email: true,
      avatar_url: true,
      is_online: true,
      last_seen: true,
      created_at: true,
      updated_at: true,
    },
  });
};

/**
 * Get a single user by ID
 * @param {number} userId
 */
export const getUserById = async (userId) => {
  return prisma.users.findUnique({
    where: { id: Number(userId) },
    select: {
      id: true,
      external_id: true,
      name: true,
      username: true,
      email: true,
      avatar_url: true,
      is_online: true,
      last_seen: true,
      created_at: true,
      updated_at: true,
    },
  });
};

/**
 * Search users by name, optionally exclude one user
 */
export const searchUsers = async (q, exclude) => {
  const where = {
    name: { contains: q },
  };
  if (exclude) where.id = { not: Number(exclude) };

  return prisma.users.findMany({
    where,
    select: {
      id: true,
      name: true,
      username: true,
      avatar_url: true,
      is_online: true,
    },
    take: 20,
    orderBy: { name: "asc" },
  });
};

/**
 * Create a new user
 */
// export const createUser = async ({ external_id, name, email, avatar_url }) => {
//   return prisma.users.create({
//     data: {
//       external_id,
//       name,
//       email,
//       avatar_url,
//       is_online: false,
//       last_seen: new Date(),
//     },
//     select: {
//       id: true,
//       external_id: true,
//       name: true,
//       email: true,
//       avatar_url: true,
//       is_online: true,
//       last_seen: true,
//     },
//   });
// };

/**
 * Update user
 */
export const updateUser = async (userId, { name, email, avatar_url, username }) => {
  const data = {};
  if (name !== undefined) data.name = name;
  if (email !== undefined) data.email = email;
  if (avatar_url !== undefined) data.avatar_url = avatar_url;
  if (username !== undefined) {
    const { normaliseUsername, validateUsername, isUsernameAvailable } = await import("./auth.controller.js");
    const norm = normaliseUsername(username);
    const err = validateUsername(norm);
    if (err) throw { status: 400, message: err };
    const available = await isUsernameAvailable(norm, userId);
    if (!available) throw { status: 409, message: "Username already taken" };
    data.username = norm;
  }
  data.updated_at = new Date();

  return prisma.users.update({
    where: { id: Number(userId) },
    data,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      avatar_url: true,
    },
  });
};

/**
 * Check username availability
 * Returns { available: boolean }
 */
export const checkUsernameAvailable = async (username, excludeUserId = null) => {
  const { isUsernameAvailable, normaliseUsername, validateUsername } = await import("./auth.controller.js");
  const norm = normaliseUsername(username);
  const error = validateUsername(norm);
  if (error) return { available: false, error };
  const available = await isUsernameAvailable(norm, excludeUserId);
  return { available };
};

/**
 * Set user online/offline
 */
export const setUserOnlineStatus = async (userId, isOnline) => {
  return prisma.users.update({
    where: { id: Number(userId) },
    data: {
      is_online: isOnline,
      last_seen: new Date(),
      updated_at: new Date(),
    },
    select: {
      id: true,
      is_online: true,
      last_seen: true,
    },
  });
};

/**
 * Get channels the user is in
 */
export const getUserChannels = async (userId) => {
  return prisma.channel_members.findMany({
    where: { user_id: Number(userId) },
    select: {
      channel: true, // include all channel fields
    },
  });
};

/**
 * Get messages sent by the user
 */
export const getUserMessages = async (userId) => {
  return prisma.messages.findMany({
    where: { sender_id: Number(userId) },
    orderBy: { created_at: "desc" },
  });
};