// const { createClient } = require("@supabase/supabase-js");

import { createClient } from "@supabase/supabase-js";
// import { createClient } from "@supabase/supabase-js"


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // server-only
);

// module.exports = supabase;

export default supabase;
    