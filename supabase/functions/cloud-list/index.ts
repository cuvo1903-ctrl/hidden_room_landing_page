import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function normalizeRequestPath(requestPath: string | null | undefined) {
  if (!requestPath || requestPath === '/') return '/';
  let normalized = String(requestPath).replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function parseCookie(cookieHeader = '') {
  return cookieHeader.split(';').reduce<Record<string, string>>((cookies, cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (!name) return cookies;
    cookies[name.trim()] = rest.join('=').trim();
    return cookies;
  }, {});
}

function getBearerToken(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  const cookies = parseCookie(req.headers.get('cookie') || '');
  return cookies['sb-access-token'] || cookies['sb-refresh-token'] || null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createJob(client, job) {
  const { data, error } = await client
    .from('cloud_jobs')
    .insert(job)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to create cloud job');
  if (!data || !data.id) throw new Error('Job insert returned no id');
  return data.id;
}

async function waitForJobResult(client, jobId) {
  const timeoutMs = 8000;
  const intervalMs = 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data: row, error } = await client
      .from('cloud_jobs')
      .select('status,result,error')
      .eq('id', jobId)
      .maybeSingle();

    if (error) throw new Error(error.message || 'Failed to read job status');
    if (!row) throw new Error('Job not found');

    if (row.status === 'done') {
      return row.result ?? {};
    }
    if (row.status === 'error') {
      throw new Error(String(row.error ?? 'Job failed'));
    }

    await delay(intervalMs);
  }

  return { pending: true, jobId, message: 'Job created and pending. Debian agent will process it soon.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'GET') return error('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return error('Missing Supabase environment variables', 500);
  }

  const token = getBearerToken(req);
  if (!token) return error('Unauthorized', 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
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
  if (!callerProfile || !hasAdminRole(callerProfile.roles)) return error('Forbidden', 403);

  const url = new URL(req.url);
  const requestedPath = normalizeRequestPath(url.searchParams.get('path'));

  try {
    const jobId = await createJob(adminClient, {
      action: 'list',
      path: requestedPath,
      payload: {},
      created_by: callerData.user.id,
    });

    const result = await waitForJobResult(adminClient, jobId);
    return json(result, 200);
  } catch (err) {
    return error(String(err), 500);
  }
});
