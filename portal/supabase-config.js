/* Hidden Room Supabase browser configuration.
 *
 * Only the publishable/anon key belongs here. Never add a service-role key.
 * Deployments may override these values before modules load:
 *   window.HIDDEN_ROOM_SUPABASE_CONFIG = { url, publishableKey }
 */
const DEFAULT_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const runtimeConfig = globalThis.HIDDEN_ROOM_SUPABASE_CONFIG || {};
export const SUPABASE_URL = runtimeConfig.url || DEFAULT_URL;
export const SUPABASE_PUBLISHABLE_KEY = runtimeConfig.publishableKey || DEFAULT_PUBLISHABLE_KEY;

let clientPromise;

export function getSupabaseClient() {
  if (globalThis.__hiddenRoomSupabaseClient) {
    return Promise.resolve(globalThis.__hiddenRoomSupabaseClient);
  }

  if (!clientPromise) {
    clientPromise = import(CDN_URL).then(({ createClient }) => {
      const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      });
      globalThis.__hiddenRoomSupabaseClient = client;
      return client;
    });
  }

  return clientPromise;
}
