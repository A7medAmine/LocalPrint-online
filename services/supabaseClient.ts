import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — customer accounts (login, saved profile, order history) will be unavailable. Guest uploads are unaffected.",
  );
}

// Falls back to a client pointed at nothing rather than throwing, so guest
// upload keeps working even if account auth was never configured on this deployment.
export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseAnonKey || "placeholder");

export const isCustomerAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey);
