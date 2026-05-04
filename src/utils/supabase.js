import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is required");
}

if (!SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_SERVICE_KEY is required");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const createStorageClientForUser = (userId) => {
  if (!SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY is required for user-scoped storage");
  }

  if (!SUPABASE_JWT_SECRET) {
    throw new Error("SUPABASE_JWT_SECRET is required for user-scoped storage");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: String(userId),
    user_id: Number(userId),
    iat: now,
    exp: now + 60 * 5,
  };

  const token = jwt.sign(payload, SUPABASE_JWT_SECRET);

  if (process.env.DEBUG_SUPABASE_STORAGE === "true") {
    console.log("[Supabase] createStorageClientForUser claims:", payload);
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
};

export default supabaseAdmin;
