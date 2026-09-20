import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars. Copy .env.example to .env and fill them in.",
  );
}

// Single shared Supabase client for the whole app (auth + any direct table access).
// The anon/publishable key is safe to expose in frontend code — it only allows
// operations permitted by Supabase's Row Level Security policies.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
