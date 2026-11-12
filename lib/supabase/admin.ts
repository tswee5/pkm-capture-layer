// Service-role Supabase client — bypasses RLS, so only ever used server-side
// in routes that authenticate the caller themselves (currently just
// /api/capture, via its own bearer-token check). Never import this from
// client code or from a session-authenticated route.
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
