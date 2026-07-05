import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INSTAGRAM_API_VERSION = "v24.0";
const MENTION_PATTERN = /@[a-zA-Z0-9._]+/g;
const COMMENTS_PAGE_LIMIT = 100;
const MAX_PAGES = 500;

type CommentRow = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
};

type MentionTotal = {
  mention: string;
  count: number;
};

type MentionUnique = {
  mention: string;
  count: number;
  authors: string[];
};

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
    return "Permisos insuficientes para leer comentarios de esta publicacion.";
  }
  if (status === 404) {
    return "No se encontro la publicacion o no pertenece a la cuenta conectada.";
  }
  if (status === 429 || code === 4 || code === 17 || code === 32 || lower.includes("rate")) {
    return "Meta limito la frecuencia de solicitudes. Espera unos minutos e intenta de nuevo.";
  }

  return message;
}

function normalizeMention(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAuthor(value: unknown, fallback: string) {
  const username = String(value ?? "").trim().toLowerCase();
  return username || fallback;
}

function sortRanking<T extends { count: number; mention: string }>(rows: T[]) {
  return rows.sort((a, b) => b.count - a.count || a.mention.localeCompare(b.mention));
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

  return { user: authData.user, adminClient };
}

async function fetchAllComments(mediaId: string, accessToken: string) {
  const firstUrl = new URL(`https://graph.instagram.com/${INSTAGRAM_API_VERSION}/${encodeURIComponent(mediaId)}/comments`);
  firstUrl.searchParams.set("fields", "id,text,username,timestamp");
  firstUrl.searchParams.set("limit", String(COMMENTS_PAGE_LIMIT));
  firstUrl.searchParams.set("access_token", accessToken);

  const comments: CommentRow[] = [];
  let nextUrl: string | null = firstUrl.toString();
  const seenUrls = new Set<string>();
  let page = 0;
  let truncated = false;
  let warning: string | null = null;

  while (nextUrl) {
    if (seenUrls.has(nextUrl)) {
      throw new Error("La paginacion de Meta regreso una pagina repetida.");
    }
    if (page >= MAX_PAGES) {
      truncated = true;
      warning = `Se analizaron ${comments.length} comentarios en ${MAX_PAGES} paginas. La publicacion tiene mas paginas disponibles; exporta con cautela porque el ranking puede ser parcial.`;
      break;
    }

    seenUrls.add(nextUrl);
    page += 1;

    const response = await fetch(nextUrl);
    const data = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(friendlyMetaError(response.status, data));
    }

    if (Array.isArray(data?.data)) comments.push(...data.data);
    nextUrl = typeof data?.paging?.next === "string" ? data.paging.next : null;
  }

  return { comments, pages: page, truncated, warning };
}

function analyzeComments(comments: CommentRow[]) {
  const totalCounts = new Map<string, number>();
  const uniqueAuthors = new Map<string, Set<string>>();
  let mentionsCount = 0;

  for (const comment of comments) {
    const text = String(comment?.text ?? "");
    const mentions = text.match(MENTION_PATTERN) ?? [];
    if (!mentions.length) continue;

    const author = normalizeAuthor(comment?.username, `comment:${comment?.id ?? "unknown"}`);

    for (const rawMention of mentions) {
      const mention = normalizeMention(rawMention);
      mentionsCount += 1;
      totalCounts.set(mention, (totalCounts.get(mention) ?? 0) + 1);
      if (!uniqueAuthors.has(mention)) uniqueAuthors.set(mention, new Set());
      uniqueAuthors.get(mention)?.add(author);
    }
  }

  const rankingTotal: MentionTotal[] = sortRanking(
    [...totalCounts.entries()].map(([mention, count]) => ({ mention, count })),
  );

  const rankingUniqueAuthors: MentionUnique[] = sortRanking(
    [...uniqueAuthors.entries()].map(([mention, authors]) => ({
      mention,
      count: authors.size,
      authors: [...authors].sort((a, b) => a.localeCompare(b)),
    })),
  );

  return {
    comments_count: comments.length,
    mentions_count: mentionsCount,
    unique_mentions_count: totalCounts.size,
    ranking_total: rankingTotal,
    ranking_unique_authors: rankingUniqueAuthors,
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
  const accessToken = String(payload.access_token || Deno.env.get("IG_ACCESS_TOKEN") || "").trim();
  const mediaId = String(payload.media_id || "").trim();
  const mediaPermalink = String(payload.media_permalink || "").trim() || null;

  if (!accessToken) return json({ error: "Falta access_token o secreto IG_ACCESS_TOKEN." }, 400);
  if (!mediaId) return json({ error: "Falta media_id." }, 400);

  try {
    const commentsResult = await fetchAllComments(mediaId, accessToken);
    const analysis = analyzeComments(commentsResult.comments);

    const { data: saved, error: saveError } = await auth.adminClient
      .from("ig_mention_analyses")
      .insert({
        media_id: mediaId,
        media_permalink: mediaPermalink,
        comments_count: analysis.comments_count,
        mentions_count: analysis.mentions_count,
        unique_mentions_count: analysis.unique_mentions_count,
        ranking_total: analysis.ranking_total,
        ranking_unique_authors: analysis.ranking_unique_authors,
        created_by: auth.user.id,
      })
      .select("id")
      .maybeSingle();

    return json({
      ok: true,
      ...analysis,
      pages_fetched: commentsResult.pages,
      comments_page_limit: COMMENTS_PAGE_LIMIT,
      analysis_truncated: commentsResult.truncated,
      analysis_warning: commentsResult.warning,
      saved_analysis_id: saveError ? null : saved?.id ?? null,
      save_warning: saveError ? `El analisis se genero, pero no se pudo guardar en Supabase: ${saveError.message}` : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const noComments = /comments/i.test(message) && /unsupported|get|permission/i.test(message);
    return json({
      ok: false,
      error: noComments ? "La publicacion no tiene comentarios disponibles o Meta no permite leerlos con este token." : message,
    }, 502);
  }
});
