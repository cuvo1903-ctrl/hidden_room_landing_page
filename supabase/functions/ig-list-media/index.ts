import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INSTAGRAM_API_VERSION = "v24.0";
const MAX_LIMIT = 100;

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

function friendlyMetaError(status: number, data: Record<string, unknown>) {
  const error = data?.error as Record<string, unknown> | undefined;
  const message = String(error?.message || data?.raw || "Instagram no pudo responder.");
  const lower = message.toLowerCase();
  const code = Number(error?.code || 0);

  if (status === 400 && (lower.includes("access token") || lower.includes("token"))) {
    return "Token invalido o expirado. Genera un nuevo Access Token de Instagram.";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object") return json({ error: "JSON invalido." }, 400);

  const accessToken = String((body as Record<string, unknown>).access_token || Deno.env.get("IG_ACCESS_TOKEN") || "").trim();
  if (!accessToken) {
    return json({ error: "Falta access_token o secreto IG_ACCESS_TOKEN." }, 400);
  }

  const limit = normalizeLimit((body as Record<string, unknown>).limit);
  const url = new URL(`https://graph.instagram.com/${INSTAGRAM_API_VERSION}/me/media`);
  url.searchParams.set("fields", "id,caption,permalink,media_type,timestamp,thumbnail_url");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url);
    const data = await readResponseBody(response);
    if (!response.ok) {
      return json({ ok: false, error: friendlyMetaError(response.status, data) }, response.status);
    }

    return json({
      ok: true,
      media: Array.isArray(data?.data) ? data.data : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: `No se pudo conectar con Instagram: ${message}` }, 502);
  }
});
