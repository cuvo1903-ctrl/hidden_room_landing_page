import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function error(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

function normalizeRoles(rawRoles: unknown) {
  return String(rawRoles ?? '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function hasAdminRole(rawRoles: unknown) {
  return normalizeRoles(rawRoles).includes('admin');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') return error('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return error('Missing Supabase function environment variables', 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return error('Unauthorized', 401);

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('roles')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfileError) return error(callerProfileError.message ?? 'Failed to verify user', 500);
  if (!hasAdminRole(callerProfile?.roles)) return error('Forbidden', 403);

  return json({
    online: true,
    hostname: 'mysauth-server',
    tailscaleIp: '100.101.102.103',
    uptime: '1 día 4 h 22 m',
    cpu: '12% / 4 núcleos',
    ram: '3.8 GB / 8 GB',
    disk: '72 GB / 120 GB',
    temperature: '47°C',
  });
});
