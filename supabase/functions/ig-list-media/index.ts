import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_API_VERSION = "v24.0";
const MAX_LIMIT = 100;
const API_MODES = new Set(["instagram_login", "facebook_graph"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "25"), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, MAX_LIMIT);
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function friendlyMetaError(status: number, data: Record<string, unknown>, mode = "instagram_login") {
  const error = data?.error as Record<string, unknown> | undefined;
  const message = String(error?.message || data?.raw || "Meta no pudo responder.");
  const lower = message.toLowerCase();
  const code = Number(error?.code || 0);

  if (code === 190 || (status === 400 && (lower.includes("access token") || lower.includes("token")))) {
    return mode === "facebook_graph"
      ? "Token de Facebook invalido o expirado. Genera un Facebook User/Page access token valido."
      : "Token invalido o expirado. Genera un nuevo Access Token de Instagram.";
  }
  if (code === 10) {
    return "Permisos insuficientes en Meta. Verifica permisos de Facebook/Instagram para leer paginas, cuenta de Instagram y comentarios.";
  }
  if (code === 100) {
    return "Parametro invalido para Meta. Verifica que el ID pertenezca a la cuenta conectada y que el endpoint soporte esos campos.";
  }
  if (status === 401 || status === 403 || lower.includes("permission") || lower.includes("permissions")) {
    return "Permisos insuficientes para leer publicaciones de esta cuenta.";
  }
  if (status === 429 || code === 4 || code === 17 || code === 32 || lower.includes("rate")) {
    return "Meta limito la frecuencia de solicitudes. Espera unos minutos e intenta de nuevo.";
  }

  return message;
}

async function requireAdmin(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { response: json({ error: "Faltan variables de Supabase." }, 500) };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) {
    return { response: json({ error: "Unauthorized" }, 401) };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("users")
    .select("roles")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    return { response: json({ error: profileError.message }, 500) };
  }

  const isAdmin = String(profile?.roles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");

  if (!isAdmin) {
    return { response: json({ error: "Forbidden: se requiere rol admin." }, 403) };
  }

  return { user: authData.user };
}

async function metaFetch(url: URL, mode: string) {
  const response = await fetch(url);
  const data = await readResponseBody(response);
  if (!response.ok) {
    console.error("[ig-list-media] Meta error", {
      mode,
      endpoint: url.origin + url.pathname,
      status: response.status,
      meta_error: data?.error ?? data,
    });
    const error = new Error(friendlyMetaError(response.status, data, mode));
    (error as Error & { status?: number; meta?: Record<string, unknown> }).status = response.status;
    (error as Error & { status?: number; meta?: Record<string, unknown> }).meta = data;
    throw error;
  }
  return data;
}

async function listInstagramLoginMedia(accessToken: string, limit: number) {
  const url = new URL("https://graph.instagram.com/" + META_API_VERSION + "/me/media");
  url.searchParams.set("fields", "id,caption,permalink,media_type,timestamp,comments_count,thumbnail_url");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", accessToken);
  const data = await metaFetch(url, "instagram_login");
  return {
    media: (Array.isArray(data?.data) ? data.data : []).map((item: Record<string, unknown>) => ({
      ...item,
      api_mode: "instagram_login",
    })),
    pages: [],
    ig_accounts: [],
  };
}

async function listFacebookGraphMedia(accessToken: string, limit: number) {
  const accountsUrl = new URL("https://graph.facebook.com/" + META_API_VERSION + "/me/accounts");
  accountsUrl.searchParams.set("fields", "id,name,access_token");
  accountsUrl.searchParams.set("limit", "100");
  accountsUrl.searchParams.set("access_token", accessToken);

  let pages: Record<string, unknown>[] = [];
  try {
    const accountsData = await metaFetch(accountsUrl, "facebook_graph");
    pages = Array.isArray(accountsData?.data) ? accountsData.data : [];
  } catch (error) {
    console.info("[ig-list-media] /me/accounts no disponible; probando token como Page token", {
      mode: "facebook_graph",
      status: (error as Error & { status?: number }).status ?? null,
    });
    const pageUrl = new URL("https://graph.facebook.com/" + META_API_VERSION + "/me");
    pageUrl.searchParams.set("fields", "id,name,instagram_business_account");
    pageUrl.searchParams.set("access_token", accessToken);
    const pageData = await metaFetch(pageUrl, "facebook_graph");
    if (pageData?.id) pages = [{ ...pageData, access_token: accessToken }];
  }

  const media: Record<string, unknown>[] = [];
  const igAccounts: Record<string, unknown>[] = [];

  for (const page of pages) {
    const pageId = String(page?.id || "").trim();
    if (!pageId) continue;

    const pageToken = String(page?.access_token || accessToken).trim();
    let pageData = page;
    if (!pageData?.instagram_business_account) {
      const pageUrl = new URL("https://graph.facebook.com/" + META_API_VERSION + "/" + encodeURIComponent(pageId));
      pageUrl.searchParams.set("fields", "instagram_business_account");
      pageUrl.searchParams.set("access_token", pageToken);
      pageData = await metaFetch(pageUrl, "facebook_graph");
    }
    const igUserId = String(pageData?.instagram_business_account?.id || "").trim();
    if (!igUserId) continue;

    igAccounts.push({
      page_id: pageId,
      page_name: page?.name || null,
      ig_user_id: igUserId,
    });

    const mediaUrl = new URL("https://graph.facebook.com/" + META_API_VERSION + "/" + encodeURIComponent(igUserId) + "/media");
    mediaUrl.searchParams.set("fields", "id,caption,comments_count,permalink,timestamp,media_type,thumbnail_url");
    mediaUrl.searchParams.set("limit", String(limit));
    mediaUrl.searchParams.set("access_token", pageToken);
    const mediaData = await metaFetch(mediaUrl, "facebook_graph");
    if (Array.isArray(mediaData?.data)) {
      media.push(...mediaData.data.map((item: Record<string, unknown>) => ({
        ...item,
        api_mode: "facebook_graph",
        page_id: pageId,
        page_name: page?.name || null,
        ig_user_id: igUserId,
      })));
    }
  }

  return {
    media,
    pages: pages.map((page: Record<string, unknown>) => ({ id: page.id, name: page.name || null })),
    ig_accounts: igAccounts,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object") return json({ error: "JSON invalido." }, 400);

  const payload = body as Record<string, unknown>;
  const rawMode = String(payload.api_mode || payload.mode || "instagram_login").trim();
  const apiMode = API_MODES.has(rawMode) ? rawMode : "instagram_login";
  const envTokenName = apiMode === "facebook_graph" ? "FB_ACCESS_TOKEN" : "IG_ACCESS_TOKEN";
  const accessToken = String(payload.access_token || Deno.env.get(envTokenName) || Deno.env.get("IG_ACCESS_TOKEN") || "").trim();
  if (!accessToken) {
    return json({ error: "Falta access_token o secreto " + envTokenName + "." }, 400);
  }

  const limit = normalizeLimit(payload.limit);

  try {
    const result = apiMode === "facebook_graph"
      ? await listFacebookGraphMedia(accessToken, limit)
      : await listInstagramLoginMedia(accessToken, limit);

    return json({
      ok: true,
      api_mode: apiMode,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: "No se pudo conectar con Meta: " + message }, 502);
  }
});
