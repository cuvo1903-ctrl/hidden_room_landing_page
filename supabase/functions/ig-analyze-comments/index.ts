import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_API_VERSION = "v24.0";
const MENTION_PATTERN = /[@\uFF20][a-zA-Z0-9._]+/g;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const COMMENTS_PAGE_LIMIT = 100;
const MAX_PAGES = 500;
const API_MODES = new Set(["instagram_login", "facebook_graph"]);

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

type MetaMediaInfo = {
  id?: string;
  permalink?: string;
  comments_count?: number;
  media_type?: string;
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
    return "Permisos insuficientes en Meta. Verifica instagram_basic, pages_show_list, pages_read_engagement e instagram_business_manage_comments.";
  }
  if (code === 100) {
    return "Parametro invalido para Meta. Verifica que el media_id venga de publicaciones cargadas por esta misma cuenta.";
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

function graphBase(mode: string) {
  return mode === "facebook_graph" ? "https://graph.facebook.com" : "https://graph.instagram.com";
}

function normalizeCommentText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(ZERO_WIDTH_PATTERN, "");
}

function maskCommentSample(value: string) {
  return value
    .replace(MENTION_PATTERN, (mention) => mention.slice(0, 1) + "***")
    .slice(0, 160);
}

function normalizeMention(value: string) {
  return value.trim().replace(/^\uFF20/, "@").toLowerCase();
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

async function fetchMetaMediaInfo(mediaId: string, accessToken: string, mode: string) {
  const url = new URL(graphBase(mode) + "/" + META_API_VERSION + "/" + encodeURIComponent(mediaId));
  url.searchParams.set("fields", "id,permalink,comments_count,media_type");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await readResponseBody(response);
  if (!response.ok) {
    console.error("[ig-analyze-comments] Meta media validation error", {
      mode,
      endpoint: url.origin + url.pathname,
      media_id: mediaId,
      status: response.status,
      meta_error: data?.error ?? data,
    });
    throw new Error(friendlyMetaError(response.status, data, mode));
  }

  const media = data as MetaMediaInfo;
  console.info("[ig-analyze-comments] Media validado", {
    mode,
    media_id: media.id ?? mediaId,
    media_permalink: media.permalink ?? null,
    comments_count: media.comments_count ?? null,
    media_type: media.media_type ?? null,
  });
  return media;
}

async function fetchAllComments(mediaId: string, accessToken: string, mediaInfo: MetaMediaInfo, mode: string) {
  const firstUrl = new URL(graphBase(mode) + "/" + META_API_VERSION + "/" + encodeURIComponent(mediaId) + "/comments");
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
      warning = "Se analizaron " + comments.length + " comentarios en " + MAX_PAGES + " paginas. La publicacion tiene mas paginas disponibles; exporta con cautela porque el ranking puede ser parcial.";
      break;
    }

    seenUrls.add(nextUrl);
    page += 1;

    const response = await fetch(nextUrl);
    const data = await readResponseBody(response);
    if (!response.ok) {
      const safeEndpoint = (() => {
        try {
          const parsed = new URL(nextUrl || "");
          return parsed.origin + parsed.pathname;
        } catch {
          return graphBase(mode) + "/comments";
        }
      })();
      console.error("[ig-analyze-comments] Meta comments error", {
        mode,
        endpoint: safeEndpoint,
        media_id: mediaId,
        media_permalink: mediaInfo.permalink ?? null,
        comments_count: mediaInfo.comments_count ?? null,
        status: response.status,
        meta_error: data?.error ?? data,
      });
      throw new Error(friendlyMetaError(response.status, data, mode));
    }

    if (Array.isArray(data?.data)) comments.push(...data.data);
    nextUrl = typeof data?.paging?.next === "string" ? data.paging.next : null;
  }

  console.info("[ig-analyze-comments] Comentarios recibidos", {
    mode,
    media_id: mediaId,
    media_permalink: mediaInfo.permalink ?? null,
    comments_count: mediaInfo.comments_count ?? null,
    comments_received: comments.length,
    pages_fetched: page,
  });

  return { comments, pages: page, repliesCount: 0, truncated, warning };
}

function analyzeComments(comments: CommentRow[]) {
  const totalCounts = new Map<string, number>();
  const uniqueAuthors = new Map<string, Set<string>>();
  let mentionsCount = 0;
  let commentsWithMentionsCount = 0;
  let commentsWithoutTextCount = 0;
  const sampleTexts: string[] = [];
  const sampleTextsWithAt: string[] = [];

  for (const comment of comments) {
    const text = normalizeCommentText(comment?.text);
    if (!text) {
      commentsWithoutTextCount += 1;
      continue;
    }
    if (sampleTexts.length < 5) sampleTexts.push(maskCommentSample(text));

    const mentions = text.match(MENTION_PATTERN) || [];
    if (!mentions.length) continue;

    commentsWithMentionsCount += 1;
    if (sampleTextsWithAt.length < 5) sampleTextsWithAt.push(maskCommentSample(text));
    const author = normalizeAuthor(comment?.username, comment?.id || "autor_desconocido");

    for (const rawMention of mentions) {
      const mention = normalizeMention(rawMention);
      mentionsCount += 1;
      totalCounts.set(mention, (totalCounts.get(mention) || 0) + 1);
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
    comments_with_mentions_count: commentsWithMentionsCount,
    comments_without_text_count: commentsWithoutTextCount,
    mention_debug: {
      sample_texts: sampleTexts,
      sample_texts_with_at: sampleTextsWithAt,
    },
    ranking_total: rankingTotal,
    ranking_unique_authors: rankingUniqueAuthors,
  };
}

function buildAnalysisWarning(mode: string, mediaInfo: MetaMediaInfo, commentsResult: { warning: string | null }, analysis: { comments_count: number; mentions_count: number }) {
  if (commentsResult.warning) return commentsResult.warning;
  const reportedCount = mediaInfo.comments_count ?? 0;
  if (reportedCount > 0 && analysis.comments_count === 0) {
    return mode === "instagram_login"
      ? "Meta reporta comentarios, pero Instagram Login no los entrego. Usa el modo Facebook Graph con un token con instagram_business_manage_comments y verifica que la publicacion pertenezca a la cuenta conectada."
      : "Meta reporta comentarios, pero la API no los entrego. Regenera token con instagram_business_manage_comments y verifica que la publicacion pertenezca a la cuenta conectada.";
  }
  if (reportedCount === 0) {
    return "Meta reporta 0 comentarios disponibles para esta publicacion.";
  }
  if (analysis.mentions_count === 0) {
    return "Meta devolvio comentarios, pero ninguno contiene @usuario en el campo text. Revisa las muestras enmascaradas para confirmar el formato recibido.";
  }
  return null;
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
  const mediaId = String(payload.media_id || "").trim();
  const mediaPermalink = String(payload.media_permalink || "").trim() || null;

  if (!accessToken) return json({ error: "Falta access_token o secreto " + envTokenName + "." }, 400);
  if (!mediaId) return json({ error: "Falta media_id." }, 400);

  try {
    const mediaInfo = await fetchMetaMediaInfo(mediaId, accessToken, apiMode);
    const commentsResult = await fetchAllComments(mediaId, accessToken, mediaInfo, apiMode);
    const analysis = analyzeComments(commentsResult.comments);

    const { data: saved, error: saveError } = await auth.adminClient
      .from("ig_mention_analyses")
      .insert({
        media_id: mediaId,
        media_permalink: mediaInfo.permalink || mediaPermalink,
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
      api_mode: apiMode,
      ...analysis,
      media: mediaInfo,
      meta_comments_count: mediaInfo.comments_count ?? null,
      media_permalink: mediaInfo.permalink ?? mediaPermalink,
      pages_fetched: commentsResult.pages,
      replies_count: commentsResult.repliesCount,
      comments_page_limit: COMMENTS_PAGE_LIMIT,
      analysis_truncated: commentsResult.truncated,
      analysis_warning: buildAnalysisWarning(apiMode, mediaInfo, commentsResult, analysis),
      saved_analysis_id: saveError ? null : saved?.id ?? null,
      save_warning: saveError ? "El analisis se genero, pero no se pudo guardar en Supabase: " + saveError.message : null,
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
