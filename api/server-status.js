const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function parseCookie(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (!name) return cookies;
    cookies[name.trim()] = rest.join('=').trim();
    return cookies;
  }, {});
}

function getBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function getServerStatusFromEnv() {
  const hostname = process.env.SERVER_STATUS_HOSTNAME;
  const tailscaleIp = process.env.SERVER_STATUS_TAILSCALE_IP;
  const uptime = process.env.SERVER_STATUS_UPTIME;
  const cpu = process.env.SERVER_STATUS_CPU;
  const ram = process.env.SERVER_STATUS_RAM;
  const disk = process.env.SERVER_STATUS_DISK;
  const temperature = process.env.SERVER_STATUS_TEMPERATURE;

  if (hostname || tailscaleIp || uptime || cpu || ram || disk || temperature) {
    return {
      online: true,
      hostname: hostname || 'unknown-host',
      tailscaleIp: tailscaleIp || 'unknown',
      uptime: uptime || 'unknown',
      cpu: cpu || 'unknown',
      ram: ram || 'unknown',
      disk: disk || 'unknown',
      temperature: temperature || 'unknown',
    };
  }

  return null;
}

function getMockServerStatus() {
  return {
    online: true,
    hostname: 'mysauth-server',
    tailscaleIp: '100.101.102.103',
    uptime: '1 día 4 h 22 m',
    cpu: '12% / 4 núcleos',
    ram: '3.8 GB / 8 GB',
    disk: '72 GB / 120 GB',
    temperature: '47°C',
  };
}

function sendJson(res, body, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  return res.end(JSON.stringify(body));
}

function normalizeRoles(rawRoles) {
  if (!rawRoles) return [];
  return String(rawRoles)
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function hasAdminRole(rawRoles) {
  return normalizeRoles(rawRoles).includes('admin');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, { error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return sendJson(res, { error: 'Server configuration incomplete' }, 500);
  }

  const token = getBearerToken(req) || parseCookie(req.headers.cookie || '')['sb-access-token'];
  if (!token) {
    return sendJson(res, { error: 'Unauthorized' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData?.user) {
    return sendJson(res, { error: 'Unauthorized' }, 401);
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('roles')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfileError) {
    return sendJson(res, { error: callerProfileError.message || 'Failed to verify user' }, 500);
  }

  if (!callerProfile || !hasAdminRole(callerProfile.roles)) {
    return sendJson(res, { error: 'Forbidden' }, 403);
  }

  const serverStatus = getServerStatusFromEnv() || getMockServerStatus();
  return sendJson(res, serverStatus);
};
