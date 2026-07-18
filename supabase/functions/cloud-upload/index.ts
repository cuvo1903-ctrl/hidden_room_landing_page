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

function isSafeFileName(fileName: string) {
  return Boolean(
    fileName
    && fileName !== '.'
    && fileName !== '..'
    && !fileName.includes('/')
    && !fileName.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(fileName)
  );
}

function isOwnedStoragePath(storagePath: string, userId: string) {
  if (!storagePath || storagePath.startsWith('/') || storagePath.includes('\\')) return false;
  const parts = storagePath.split('/');
  return parts.length === 2
    && parts[0] === userId
    && Boolean(parts[1])
    && parts[1] !== '.'
    && parts[1] !== '..';
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
  if (req.method !== 'POST') return error('Method not allowed', 405);

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

  const body = await req.json().catch(() => null);
  const requestedPath = normalizeRequestPath((body as any)?.path);
  const filename = String((body as any)?.filename || '').trim();
  const storagePath = String((body as any)?.storage_path || '').trim();
  const size = Number((body as any)?.size);
  const mimeType = String((body as any)?.mime_type || 'application/octet-stream').trim();

  if (!isSafeFileName(filename)) return error('El nombre del archivo no es válido.', 400);
  if (!isOwnedStoragePath(storagePath, callerData.user.id)) {
    return error('La ruta temporal del archivo no es válida.', 400);
  }
  if (!Number.isSafeInteger(size) || size <= 0) return error('El tamano del archivo no es valido o esta vacio.', 400);

  try {
    const jobId = await createJob(adminClient, {
      action: 'upload',
      path: requestedPath,
      payload: {
        filename,
        storage_path: storagePath,
        size,
        mime_type: mimeType || 'application/octet-stream',
      },
      status: 'pending',
      created_by: callerData.user.id,
    });

    const result = await waitForJobResult(adminClient, jobId);
    return json(result, 200);
  } catch (err) {
    return error(String(err), 500);
  }
});
