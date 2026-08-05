import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const systemPrompt = `
Eres KAIREN, la IA interna de Hidden Room / Mysauth.

Ayudas con:
- ERP
- membresías
- contratos
- eventos
- tienda
- media
- red social
- Supabase
- desarrollo web
- documentación
- estrategia operativa

Responde en español mexicano, claro, directo y práctico.
Si no tienes suficiente información, dilo claramente.
`;

type Provider = "gemini" | "openrouter" | "ollama";
type ChatRole = "user" | "model";

type ChatMessage = {
  role: ChatRole;
  text: string;
};

const DEFAULT_PROVIDER: Provider = "gemini";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const KAIREN_PERMISSION = "Kairen AI";

const MODEL_GROUPS = {
  chat: [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-3.5-flash",
    "gemma-4-26b",
    "gemma-4-31b",
  ],
  audio: [
    "gemini-2.5-flash-tts",
    "gemini-3.1-flash-tts",
    "gemini-2.5-flash-native-audio-dialog",
    "gemini-3-flash-live",
    "gemini-3.5-live-translate",
  ],
  embeddings: [
    "gemini-embedding-1",
    "gemini-embedding-2",
  ],
  robotics: [
    "gemini-robotics-er-1.5-preview",
    "gemini-robotics-er-1.6-preview",
  ],
} as const;

const GEMINI_MODELS = new Set<string>(Object.values(MODEL_GROUPS).flat());
const CHAT_MODELS = new Set<string>(MODEL_GROUPS.chat);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-20)
    .filter((message) => message?.role === "user" || message?.role === "model")
    .map((message) => ({
      role: message.role as ChatRole,
      text: String(message?.text ?? "").trim().slice(0, 8000),
    }))
    .filter((message) => message.text);
}

function configuredProviders() {
  return {
    gemini: Boolean(Deno.env.get("GEMINI_API_KEY")),
    openrouter: Boolean(Deno.env.get("OPENROUTER_API_KEY")),
    ollama: Boolean(Deno.env.get("OLLAMA_BASE_URL")),
  };
}

function normalizeProvider(value: unknown): Provider | null {
  const provider = String(value ?? "").trim().toLowerCase();
  return provider === "gemini" || provider === "openrouter" || provider === "ollama"
    ? provider
    : null;
}

function friendlyGeminiError(status: number, originalMessage: string) {
  const normalized = originalMessage.toLowerCase();

  if (status === 429) {
    if (
      normalized.includes("quota") ||
      normalized.includes("free tier") ||
      normalized.includes("credit")
    ) {
      return `Modelo sin cuota: ${originalMessage}`;
    }
    return `Límite de frecuencia alcanzado: ${originalMessage}`;
  }

  if (status === 401 || status === 403) {
    return `API key inválida o sin permisos: ${originalMessage}`;
  }

  if (status === 404) {
    return `Modelo no disponible: ${originalMessage}`;
  }

  return originalMessage;
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

async function callGemini(messages: ChatMessage[], model: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: "API key faltante: GEMINI_API_KEY no está configurada." }, 503);
  }

  if (!CHAT_MODELS.has(model)) {
    return json({
      error: `El modelo ${model} está permitido, pero no es compatible con este chat de texto.`,
    }, 400);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: messages.map((message) => ({
            role: message.role,
            parts: [{ text: message.text }],
          })),
          generationConfig: {
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    const data = await readResponseBody(response);
    if (!response.ok) {
      const originalError =
        data?.error?.message || data?.raw || "Gemini no pudo responder.";
      return json({
        error: friendlyGeminiError(response.status, originalError),
      }, response.status);
    }

    const reply = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: unknown }) => String(part?.text ?? ""))
      .join("")
      .trim();

    if (!reply) {
      return json({ error: "Gemini devolvió una respuesta vacía." }, 502);
    }

    return json({ reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `No se pudo conectar con Gemini: ${message}` }, 502);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Faltan variables de Supabase." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  const [
    { data: profile, error: profileError },
    { data: permission, error: permissionError },
  ] = await Promise.all([
    adminClient
      .from("users")
      .select("roles")
      .eq("id", authData.user.id)
      .maybeSingle(),
    adminClient
      .from("user_permissions")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("permission_key", KAIREN_PERMISSION)
      .maybeSingle(),
  ]);

  if (profileError || permissionError) {
    return json({ error: (profileError || permissionError)?.message }, 500);
  }

  const isAdmin = String(profile?.roles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");

  if (!isAdmin && !permission) {
    return json({ error: `Forbidden: se requiere el permiso ${KAIREN_PERMISSION}.` }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  if (body.action === "config") {
    return json({
      providers: configuredProviders(),
      default_provider: normalizeProvider(Deno.env.get("AI_PROVIDER")) || DEFAULT_PROVIDER,
      default_model: Deno.env.get("AI_MODEL")?.trim() || DEFAULT_MODEL,
    });
  }

  const provider =
    normalizeProvider(body.provider) ||
    normalizeProvider(Deno.env.get("AI_PROVIDER")) ||
    DEFAULT_PROVIDER;
  const model = String(
    body.model || Deno.env.get("AI_MODEL") || DEFAULT_MODEL,
  ).trim();
  const message = String(body.message ?? "").trim().slice(0, 8000);
  const history = normalizeHistory(body.history);

  if (!configuredProviders()[provider]) {
    return json({ error: `Provider no disponible: ${provider}.` }, 503);
  }

  if (!message) {
    return json({ error: "Falta message." }, 400);
  }

  if (provider === "gemini" && !GEMINI_MODELS.has(model)) {
    return json({ error: `Modelo no permitido: ${model}.` }, 400);
  }

  const messages = [...history, { role: "user" as const, text: message }];

  switch (provider) {
    case "gemini":
      return callGemini(messages, model);
    case "openrouter":
      return json({ error: "Provider no disponible: OpenRouter aún no está implementado." }, 503);
    case "ollama":
      return json({ error: "Provider no disponible: Ollama aún no está implementado." }, 503);
  }
});
