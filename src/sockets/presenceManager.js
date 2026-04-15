import prisma from "../config/prisma.js";
import {
  buildPresenceEventPayload,
  getStoredPreferencesForUser,
} from "../utils/userPreferences.js";
import { io } from "./index.js";

/**
 * Persists the user's online status to the database and broadcasts the change.
 */
export async function persistPresence(userId, isOnline) {
  try {
    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        is_online: isOnline,
        last_seen: new Date(),
        updated_at: new Date(),
      },
      select: {
        id: true,
        is_online: true,
        is_huddling: true,
        last_seen: true,
      },
    });

    if (io) {
      const preferences = await getStoredPreferencesForUser(user.id);
      io.emit(
        "userPresenceChanged",
        buildPresenceEventPayload({
          userId: user.id,
          isOnline: user.is_online,
          is_huddling: user.is_huddling,
          lastSeen: user.last_seen,
          privacyPreferences: preferences.privacyPreferences,
        })
      );
    }
  } catch (err) {
    console.error(`Failed to update presence for user ${userId}:`, err.message);
  }
}

/**
 * Persists the user's huddle status to the database and broadcasts the change.
 */
export async function persistHuddleStatus(userId, isHuddling) {
  try {
    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        is_huddling: isHuddling,
        updated_at: new Date(),
      },
      select: {
        id: true,
        is_online: true,
        is_huddling: true,
        last_seen: true,
      },
    });

    if (io) {
      const preferences = await getStoredPreferencesForUser(user.id);
      io.emit(
        "userPresenceChanged",
        buildPresenceEventPayload({
          userId: user.id,
          isOnline: user.is_online,
          is_huddling: user.is_huddling,
          lastSeen: user.last_seen,
          privacyPreferences: preferences.privacyPreferences,
        })
      );
    }
  } catch (err) {
    console.error(`Failed to update huddle status for user ${userId}:`, err.message);
  }
}
