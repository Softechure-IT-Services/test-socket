import prisma from "../config/prisma.js";

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  desktop: true,
  sound: true,
  mentions: true,
  directMessages: true,
  threadReplies: true,
  huddles: true,
  mutedChannelIds: [],
  mutedDmIds: [],
};

export const DEFAULT_PRIVACY_PREFERENCES = {
  showOnlineStatus: true,
};

let warnedAboutMissingPreferenceColumns = false;

function parseNumericUserId(rawUserId) {
  const parsed = Number(rawUserId);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function parseJsonValue(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === "object") return rawValue;

  try {
    return JSON.parse(rawValue);
  } catch {
    return {};
  }
}

function isMissingPreferenceColumnError(err) {
  const message = String(err?.message ?? "").toLowerCase();
  return (
    message.includes("notification_preferences") ||
    message.includes("privacy_preferences") ||
    message.includes("unknown column") ||
    message.includes("doesn't exist")
  );
}

function warnAboutMissingPreferenceColumns(err) {
  if (warnedAboutMissingPreferenceColumns || !isMissingPreferenceColumnError(err)) return;
  warnedAboutMissingPreferenceColumns = true;
  console.warn(
    "Preference columns are missing from the users table. Apply the latest migration to enable saved notification/privacy settings."
  );
}

export function normalizeNotificationPreferences(input = {}) {
  const raw = parseJsonValue(input);

  return {
    desktop: raw.desktop !== false,
    sound: raw.sound !== false,
    mentions: raw.mentions !== false,
    directMessages: raw.directMessages !== false,
    threadReplies: raw.threadReplies !== false,
    huddles: raw.huddles !== false,
    mutedChannelIds: normalizeIdList(raw.mutedChannelIds),
    mutedDmIds: normalizeIdList(raw.mutedDmIds),
  };
}

export function normalizePrivacyPreferences(input = {}) {
  const raw = parseJsonValue(input);

  return {
    showOnlineStatus: raw.showOnlineStatus !== false,
  };
}

export async function getStoredPreferencesByUserIds(userIds) {
  const normalizedUserIds = Array.from(
    new Set(
      userIds
        .map(parseNumericUserId)
        .filter((value) => value !== null)
    )
  );

  const result = new Map();
  normalizedUserIds.forEach((userId) => {
    result.set(String(userId), {
      notificationPreferences: normalizeNotificationPreferences(),
      privacyPreferences: normalizePrivacyPreferences(),
    });
  });

  if (normalizedUserIds.length === 0) {
    return result;
  }

  const placeholders = normalizedUserIds.map(() => "?").join(", ");

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, notification_preferences, privacy_preferences FROM users WHERE id IN (${placeholders})`,
      ...normalizedUserIds
    );

    rows.forEach((row) => {
      result.set(String(row.id), {
        notificationPreferences: normalizeNotificationPreferences(row.notification_preferences),
        privacyPreferences: normalizePrivacyPreferences(row.privacy_preferences),
      });
    });
  } catch (err) {
    warnAboutMissingPreferenceColumns(err);
  }

  return result;
}

export async function getStoredPreferencesForUser(userId) {
  const preferencesByUserId = await getStoredPreferencesByUserIds([userId]);
  return (
    preferencesByUserId.get(String(userId)) || {
      notificationPreferences: normalizeNotificationPreferences(),
      privacyPreferences: normalizePrivacyPreferences(),
    }
  );
}

export async function updateStoredPreferencesForUser(
  userId,
  {
    notificationPreferences,
    privacyPreferences,
  } = {}
) {
  const numericUserId = parseNumericUserId(userId);
  if (numericUserId === null) {
    throw new Error("Invalid user ID for preference update.");
  }

  const updates = [];
  const params = [];

  if (notificationPreferences !== undefined) {
    updates.push("notification_preferences = ?");
    params.push(JSON.stringify(normalizeNotificationPreferences(notificationPreferences)));
  }

  if (privacyPreferences !== undefined) {
    updates.push("privacy_preferences = ?");
    params.push(JSON.stringify(normalizePrivacyPreferences(privacyPreferences)));
  }

  if (updates.length === 0) {
    return getStoredPreferencesForUser(numericUserId);
  }

  params.push(numericUserId);

  await prisma.$executeRawUnsafe(
    `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
    ...params
  );

  return getStoredPreferencesForUser(numericUserId);
}

export function applyPresencePrivacy(user, viewerUserId = null, explicitPrivacyPreferences = null) {
  if (!user || user.id == null) return user;

  const numericViewerId = parseNumericUserId(viewerUserId);
  const numericUserId = parseNumericUserId(user.id);
  const isSelf = numericViewerId !== null && numericUserId !== null && numericViewerId === numericUserId;
  const privacyPreferences = normalizePrivacyPreferences(
    explicitPrivacyPreferences ?? user.privacy_preferences ?? user.privacyPreferences
  );

  if (isSelf || privacyPreferences.showOnlineStatus) {
    return {
      ...user,
      is_online: !!user.is_online,
      last_seen: user.last_seen ?? null,
      presence_hidden: false,
    };
  }

  return {
    ...user,
    is_online: false,
    last_seen: null,
    presence_hidden: true,
  };
}

export async function withPresencePrivacy(users, viewerUserId = null) {
  if (!Array.isArray(users) || users.length === 0) return [];

  const preferencesByUserId = await getStoredPreferencesByUserIds(
    users.map((user) => user?.id)
  );

  return users.map((user) => {
    const preferences = preferencesByUserId.get(String(user?.id));
    return applyPresencePrivacy(
      user,
      viewerUserId,
      preferences?.privacyPreferences
    );
  });
}

export function buildPresenceEventPayload({
  userId,
  isOnline,
  is_huddling,
  lastSeen,
  privacyPreferences,
}) {
  const normalizedPrivacyPreferences = normalizePrivacyPreferences(privacyPreferences);

  if (normalizedPrivacyPreferences.showOnlineStatus) {
    return {
      userId,
      is_online: !!isOnline,
      is_huddling: !!is_huddling, // Correctly use is_huddling parameter
      last_seen: lastSeen ?? null,
      presence_hidden: false,
    };
  }

  return {
    userId,
    is_online: false,
    last_seen: null,
    presence_hidden: true,
  };
}

export { isMissingPreferenceColumnError };
