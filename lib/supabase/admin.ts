import "server-only";

import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase/config";

export function createAdminClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!rawUrl || !serviceRoleKey) {
    throw new Error("Supabase service role environment variable is missing.");
  }

  return createClient(normalizeSupabaseProjectUrl(rawUrl), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
