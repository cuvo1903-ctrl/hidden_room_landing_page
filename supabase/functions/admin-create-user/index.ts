import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const roleRank = ['client', 'pr', 'collaborator', 'partner', 'admin'];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function normalizePhone(value: unknown) {
  const phone = String(value ?? '').replace(/\D/g, '');
  return phone || null;
}

function nullableString(value: unknown) {
  const clean = String(value ?? '').trim();
  return clean || null;
}

function authErrorStatus(message = '') {
  const lower = message.toLowerCase();
  if (lower.includes('already') || lower.includes('duplicate') || lower.includes('registered')) return 409;
  return 400;
}

function hasAdminRole(rawRoles: unknown) {
  const roles = String(rawRoles ?? '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  return roles.some((role) => roleRank.indexOf(role) >= roleRank.indexOf('admin'));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Missing Supabase function environment variables' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: 'Unauthorized' }, 401);

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from('users')
    .select('id, roles')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfileError) return json({ error: callerProfileError.message }, 500);
  if (!hasAdminRole(callerProfile?.roles)) return json({ error: 'Forbidden' }, 403);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? body.profile?.email ?? '').trim().toLowerCase();
  const profile = body.profile ?? {};
  const displayName = String(body.display_name ?? profile.display_name ?? '').trim();
  const whatsapp = normalizePhone(body.whatsapp ?? profile.whatsapp);
  const username = nullableString(body.username ?? profile.username);
  const userId = nullableString(body.user_id ?? profile.user_id);
  const roles = String(body.roles ?? profile.roles ?? 'client').trim() || 'client';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email' }, 400);
  if (!displayName) return json({ error: 'display_name is required' }, 400);

  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    phone: whatsapp ?? undefined,
    password: tempPassword,
    email_confirm: true,
    phone_confirm: Boolean(whatsapp),
    user_metadata: {
      display_name: displayName,
      whatsapp,
    },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? 'Could not create auth user' }, authErrorStatus(createError?.message));
  }

  const { error: profileError } = await adminClient
    .from('users')
    .upsert({
      id: created.user.id,
      display_name: displayName,
      email,
      whatsapp,
      username,
      user_id: userId,
      roles,
      temp_password: tempPassword,
    }, { onConflict: 'id' });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    const status = /duplicate|unique/i.test(profileError.message) ? 409 : 500;
    return json({ error: profileError.message }, status);
  }

  return json({
    ok: true,
    message: 'Usuario creado y sincronizado correctamente.',
    user: {
      id: created.user.id,
      email,
      phone: whatsapp,
      display_name: displayName,
      whatsapp,
      username,
      user_id: userId,
      roles,
    },
    temp_password: tempPassword,
  });
});
