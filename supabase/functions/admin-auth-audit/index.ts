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

function error(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

function hasAdminRole(rawRoles: unknown) {
  const roles = String(rawRoles ?? '')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  return roles.some((role) => roleRank.indexOf(role) >= roleRank.indexOf('admin'));
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeUserId(value: unknown) {
  return String(value ?? '').trim();
}

function publicProfileSummary(profile: Record<string, any> | null | undefined) {
  if (!profile) return null;
  return {
    id: profile.id ?? null,
    user_id: profile.user_id ?? null,
    email: profile.email ?? null,
    display_name: profile.display_name ?? null,
    username: profile.username ?? null,
    roles: profile.roles ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('Method not allowed', 405);

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
    .select('id, roles')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (callerProfileError) return error(callerProfileError.message, 500);
  if (!hasAdminRole(callerProfile?.roles)) return error('Forbidden', 403);

  let limit = 25;
  try {
    const body = await req.json();
    const requestedLimit = Number(body?.limit);
    if (Number.isFinite(requestedLimit)) limit = Math.min(100, Math.max(5, Math.floor(requestedLimit)));
  } catch {
    // Body is optional.
  }

  const perPage = 1000;
  const authUsers: any[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const { data, error: listError } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (listError) return error(listError.message, 500);

    const users = data?.users ?? [];
    authUsers.push(...users);
    if (users.length < perPage) break;
  }

  const { data: profiles, error: profilesError } = await adminClient
    .from('users')
    .select('id, user_id, email, display_name, username, roles')
    .order('email', { ascending: true, nullsFirst: false });

  if (profilesError) return error(profilesError.message, 500);

  const profilesByAuthId = new Map((profiles ?? []).map((profile) => [String(profile.id), profile]));
  const authById = new Map(authUsers.map((user) => [String(user.id), user]));

  const emailGroups = new Map<string, { auth: any[]; profiles: any[] }>();
  const userIdGroups = new Map<string, any[]>();

  for (const user of authUsers) {
    const email = normalizeEmail(user.email);
    if (!email) continue;
    if (!emailGroups.has(email)) emailGroups.set(email, { auth: [], profiles: [] });
    emailGroups.get(email)?.auth.push(user);
  }

  for (const profile of profiles ?? []) {
    const email = normalizeEmail(profile.email);
    if (email) {
      if (!emailGroups.has(email)) emailGroups.set(email, { auth: [], profiles: [] });
      emailGroups.get(email)?.profiles.push(profile);
    }

    const userId = normalizeUserId(profile.user_id);
    if (userId) {
      if (!userIdGroups.has(userId)) userIdGroups.set(userId, []);
      userIdGroups.get(userId)?.push(profile);
    }
  }

  const serializeAuthUser = (user: any) => {
    const profile = profilesByAuthId.get(String(user.id));
    return {
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      created_at: user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      confirmed_at: user.confirmed_at ?? null,
      profile: publicProfileSummary(profile),
      needs_profile_merge: !profile,
    };
  };

  const recentLogins = authUsers
    .filter((user) => user.last_sign_in_at)
    .sort((a, b) => String(b.last_sign_in_at).localeCompare(String(a.last_sign_in_at)))
    .slice(0, limit)
    .map(serializeAuthUser);

  const recentCreated = authUsers
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map(serializeAuthUser);

  const allOrphanAuthUsers = authUsers
    .filter((user) => !profilesByAuthId.has(String(user.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const allPublicWithoutAuth = (profiles ?? [])
    .filter((profile) => !authById.has(String(profile.id)))
    .sort((a, b) => String(a.email ?? a.display_name ?? '').localeCompare(String(b.email ?? b.display_name ?? ''), 'es'));

  const allDuplicateEmails = [...emailGroups.entries()]
    .filter(([, group]) => {
      const ids = new Set([
        ...group.auth.map((user) => String(user.id)),
        ...group.profiles.map((profile) => String(profile.id)),
      ].filter(Boolean));
      return ids.size > 1 || group.auth.length > 1 || group.profiles.length > 1;
    });

  const duplicateEmails = allDuplicateEmails
    .slice(0, limit)
    .map(([email, group]) => ({
      email,
      auth_users: group.auth.map(serializeAuthUser),
      public_profiles: group.profiles.map(publicProfileSummary),
    }));

  const allDuplicateUserIds = [...userIdGroups.entries()]
    .filter(([, group]) => group.length > 1);

  const duplicateUserIds = allDuplicateUserIds
    .slice(0, limit)
    .map(([user_id, group]) => ({
      user_id,
      public_profiles: group.map(publicProfileSummary),
    }));

  const orphanAuthUsers = allOrphanAuthUsers.slice(0, limit).map(serializeAuthUser);
  const publicWithoutAuth = allPublicWithoutAuth.slice(0, limit).map(publicProfileSummary);

  return json({
    success: true,
    generated_at: new Date().toISOString(),
    totals: {
      auth_users: authUsers.length,
      public_profiles: profiles?.length ?? 0,
      auth_without_public_profile: allOrphanAuthUsers.length,
      public_profiles_without_auth: allPublicWithoutAuth.length,
      duplicate_emails: allDuplicateEmails.length,
      duplicate_user_ids: allDuplicateUserIds.length,
    },
    recent_logins: recentLogins,
    recent_created: recentCreated,
    possible_merges: {
      auth_without_public_profile: orphanAuthUsers,
      public_profiles_without_auth: publicWithoutAuth,
      duplicate_emails: duplicateEmails,
      duplicate_user_ids: duplicateUserIds,
    },
  });
});
