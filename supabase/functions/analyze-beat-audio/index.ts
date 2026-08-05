import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-analyze-target, x-file-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

function cleanText(value: unknown, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeRoles(rawRoles: unknown) {
  return String(rawRoles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function hasAdminRole(rawRoles: unknown) {
  return normalizeRoles(rawRoles).includes("admin");
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function validTarget(value: string) {
  return value === "bpm" || value === "key" || value === "all";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return error("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const analyzerUrl = Deno.env.get("BEAT_ANALYZER_URL");
  const analyzerSecret = Deno.env.get("BEAT_ANALYZER_SECRET");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !analyzerUrl || !analyzerSecret) {
    return error("Analizador no configurado.", 500);
  }

  const token = getBearerToken(req);
  if (!token) return error("Unauthorized", 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return error("Unauthorized", 401);

  const { data: profile, error: profileError } = await adminClient
    .from("users")
    .select("roles")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (profileError) return error(profileError.message || "No se pudo validar usuario.", 500);
  if (!profile || !hasAdminRole(profile.roles)) return error("Forbidden", 403);

  const target = cleanText(req.headers.get("x-analyze-target") || "all", 20).toLowerCase();
  if (!validTarget(target)) return error("Tipo de analisis invalido.", 400);

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  const isJson = contentType.toLowerCase().includes("application/json");
  let body: BodyInit;
  let forwardedContentType = contentType;

  if (isJson) {
    const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
    const audioPath = cleanText(payload?.audio_path, 300);
    if (!audioPath) return error("El beat no tiene audio en Cloud para analizar.", 400);
    body = JSON.stringify({ audio_path: audioPath });
    forwardedContentType = "application/json";
  } else {
    if (!contentType.toLowerCase().startsWith("audio/") && !contentType.includes("octet-stream")) {
      return error("El archivo debe ser audio.", 400);
    }
    const buffer = await req.arrayBuffer();
    if (!buffer.byteLength) return error("Archivo vacio.", 400);
    body = buffer;
  }

  const analyzerResponse = await fetch(analyzerUrl, {
    method: "POST",
    headers: {
      "Content-Type": forwardedContentType,
      "X-Beat-Analyzer-Secret": analyzerSecret,
      "X-Analyze-Target": target,
      "X-File-Name": cleanText(req.headers.get("x-file-name"), 180),
    },
    body,
  });

  const result = await analyzerResponse.json().catch(() => ({}));
  if (!analyzerResponse.ok) {
    return error(cleanText(result.error || "No se pudo analizar el audio.", 300), analyzerResponse.status);
  }

  return json({ success: true, ...result });
});
