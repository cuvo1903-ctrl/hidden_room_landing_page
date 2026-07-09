'use strict';

const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { chromium } = require('playwright');

const HOST = '127.0.0.1';
const PORT = Number(process.env.IG_SCRAPER_PORT || 4317);
const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.profile');
const OUTPUT_DIR = path.join(ROOT, 'output');
let activeJob = false;
let lastResult = { url: '', comments: [], count: 0, updated_at: null };

function existingFile(filePath) {
  return filePath && fsSync.existsSync(filePath) ? filePath : '';
}

function findFallbackBrowser() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  const candidates = [
    process.env.IG_SCRAPER_BROWSER,
    path.join(localAppData, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    path.join(localAppData, 'ms-playwright', 'chromium-1187', 'chrome-win', 'chrome.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.map(existingFile).find(Boolean) || '';
}

function browserLaunchOptions(options = {}) {
  const executablePath = findFallbackBrowser();
  return {
    ...options,
    ...(executablePath ? { executablePath } : {}),
  };
}

function normalizeInstagramUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Ingresa una URL valida de Instagram.');
  }
  if (url.protocol !== 'https:' || !/(^|\.)instagram\.com$/i.test(url.hostname)) {
    throw new Error('Solo se aceptan URLs HTTPS de instagram.com.');
  }
  if (!/^\/(p|reel)\/[^/]+/i.test(url.pathname)) {
    throw new Error('La URL debe corresponder a un post o reel publico.');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function saveComments(comments) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const rows = comments.map((comment) => [
    comment.username,
    comment.comment_text,
    comment.timestamp,
    comment.like_count,
    comment.is_reply,
  ]);
  const csv = [
    ['username', 'comment_text', 'timestamp', 'like_count', 'is_reply'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\n');
  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, 'comments.json'), `${JSON.stringify(comments, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(OUTPUT_DIR, 'comments.csv'), `\uFEFF${csv}\n`, 'utf8'),
  ]);
}

async function clickMoreComments(page) {
  const labels = [
    /ver\s+(?:los|todos|m(?:a|á|Ã¡)s)?\s*[\d.,\s]*(?:mil|k)?\s*comentarios/i,
    /ver comentarios anteriores/i,
    /mostrar m(?:a|á|Ã¡)s comentarios/i,
    /cargar m(?:a|á|Ã¡)s comentarios/i,
    /view\s+(?:all|more)?\s*[\d.,\s]*(?:k)?\s*comments/i,
    /load more comments/i,
    /view previous comments/i,
    /ver respuestas/i,
    /view replies/i,
  ];
  let clicked = 0;
  for (const pattern of labels) {
    const locators = [
      page.getByRole('button', { name: pattern }),
      page.getByRole('link', { name: pattern }),
      page.getByText(pattern),
    ];
    for (const controls of locators) {
      const count = Math.min(await controls.count().catch(() => 0), 40);
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (await control.isVisible().catch(() => false)) {
          await control.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await control.click({ timeout: 2500 }).catch(() => {});
          clicked += 1;
          await page.waitForTimeout(350);
        }
      }
    }
  }
  return clicked;
}
async function loadAllComments(page, maxScrolls) {
  let stableRounds = 0;
  let previousItems = 0;
  for (let round = 0; round < maxScrolls && stableRounds < 35; round += 1) {
    const clicked = await clickMoreComments(page);
    const items = await page.locator('time').count();
    stableRounds = items === previousItems && clicked === 0 ? stableRounds + 1 : 0;
    previousItems = items;
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('article, main, [role="dialog"], section, div')]
        .filter((node) => node.scrollHeight > node.clientHeight + 100)
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
        .slice(0, 8);
      for (const target of candidates) target.scrollTop = target.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1200);
  }
}

async function extractComments(page) {
  return page.evaluate(() => {
    const usernameHref = /^\/[A-Za-z0-9._]+\/?$/;
    const relativeTimeText = /^(ahora|now|\d+\s*(s|seg|segundos?|m|min|minutos?|h|hr|hrs|hora|horas|d|dia|días|sem|semana|semanas|w|wk|wks|week|weeks|mo|mes|meses|y|yr|yrs|año|años))\.?$/i;
    const results = [];
    const seen = new Set();

    function clean(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function escapeRegExp(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function findUsernameNear(time) {
      let probe = time;
      for (let depth = 0; probe && depth < 12; depth += 1) {
        const link = [...probe.querySelectorAll('a[href^="/"]')]
          .find((item) => usernameHref.test(item.getAttribute('href') || '') && clean(item.textContent));
        if (link) return clean(link.textContent);
        probe = probe.parentElement;
      }
      return '';
    }

    function stripNoise(segment, username, timeText) {
      let value = clean(segment);
      value = value.replace(new RegExp(`^${escapeRegExp(username)}\\s+`, 'i'), '');
      value = value.replace(new RegExp(`^${escapeRegExp(timeText)}\\s+`, 'i'), '');
      value = value.replace(/\s*(Responder|Reply)\s*$/i, '');
      value = value.replace(/\s+\d[\d.,]*\s*(Me gusta|likes?)\s*$/i, '');
      value = value.replace(/\s*(Ver traducci[oó]n|See translation)\s*$/i, '');
      return clean(value);
    }

    function likeCount(segment) {
      const match = clean(segment).match(/(\d[\d.,]*)\s*(?:Me gusta|likes?)/i);
      return match ? match[1] : null;
    }

    const articleRoots = [...document.querySelectorAll('article')];
    const roots = articleRoots.length ? articleRoots : [document.body].filter(Boolean);
    for (const root of roots) {
      const fullText = clean(root.innerText);
      if (!fullText) continue;
      const entries = [...root.querySelectorAll('time')]
        .map((time) => ({
          username: findUsernameNear(time),
          timeText: clean(time.textContent),
          timestamp: time.getAttribute('datetime') || clean(time.textContent) || null,
        }))
        .filter((entry) => entry.username && relativeTimeText.test(entry.timeText));

      let cursor = 0;
      const located = entries.map((entry) => {
        const marker = `${entry.username} ${entry.timeText}`;
        let index = fullText.indexOf(marker, cursor);
        if (index < 0) index = fullText.indexOf(marker);
        if (index >= 0) cursor = index + marker.length;
        return { ...entry, marker, index };
      }).filter((entry) => entry.index >= 0)
        .sort((a, b) => a.index - b.index);

      const firstCommentIndex = located.length > 1 ? 1 : 0;
      for (let index = firstCommentIndex; index < located.length; index += 1) {
        const entry = located[index];
        const start = entry.index + entry.marker.length;
        const nextEntry = located[index + 1];
        const nextIndex = nextEntry ? nextEntry.index : fullText.length;
        const tail = fullText.slice(start, nextIndex);
        const replyMatch = tail.match(/\s(Responder|Reply)\b/i);
        const end = replyMatch ? start + replyMatch.index : nextIndex;
        const rawSegment = fullText.slice(start, end);
        const commentText = stripNoise(rawSegment, entry.username, entry.timeText);
        if (!commentText || relativeTimeText.test(commentText)) continue;
        if (/^(Responder|Reply|Me gusta|likes?)$/i.test(commentText)) continue;
        const key = `${entry.username}\u0000${commentText}\u0000${entry.timestamp || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          username: entry.username,
          comment_text: commentText,
          timestamp: entry.timestamp,
          like_count: likeCount(rawSegment),
          is_reply: /^@\w/i.test(commentText),
        });
      }
    }
    return results;
  });
}
async function extractInstagramMediaId(page) {
  const html = await page.content().catch(() => '');
  const patterns = [
    /"media_id"\s*:\s*"(\d+)"/,
    /"media_id"\s*:\s*(\d+)/,
    /"pk"\s*:\s*"(\d{12,})"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

async function fetchCommentsViaInstagramApi(page, mediaId, maxPages) {
  return page.evaluate(async ({ mediaId: id, maxPages: limit }) => {
    const comments = [];
    const seen = new Set();
    let minId = '';
    let expectedCount = null;
    let pagesFetched = 0;
    let stoppedReason = '';

    function normalize(comment, isReply = false) {
      const createdAt = Number(comment?.created_at_utc || comment?.created_at || 0);
      const timestamp = Number.isFinite(createdAt) && createdAt > 0
        ? new Date(createdAt * 1000).toISOString()
        : null;
      const likeCount = comment?.comment_like_count;
      return {
        username: comment?.user?.username || '',
        comment_text: comment?.text || '',
        timestamp,
        like_count: likeCount == null ? null : likeCount,
        is_reply: Boolean(isReply || comment?.parent_comment_id),
      };
    }

    function pushComment(comment, isReply = false) {
      const normalized = normalize(comment, isReply);
      if (!normalized.username || !normalized.comment_text) return;
      const key = comment?.pk
        ? `pk:${comment.pk}`
        : `${normalized.username}\u0000${normalized.comment_text}\u0000${normalized.timestamp || ''}\u0000${normalized.is_reply}`;
      if (seen.has(key)) return;
      seen.add(key);
      comments.push(normalized);
    }

    for (let pageIndex = 0; pageIndex < limit; pageIndex += 1) {
      const params = new URLSearchParams({ can_support_threading: 'true' });
      if (minId) params.set('min_id', minId);
      const response = await fetch(`/api/v1/media/${id}/comments/?${params.toString()}`, {
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      if (!response.ok) {
        stoppedReason = `api-status-${response.status}`;
        break;
      }
      const payload = await response.json();
      pagesFetched += 1;
      if (typeof payload.comment_count === 'number') expectedCount = payload.comment_count;

      const batch = Array.isArray(payload.comments) ? payload.comments : [];
      for (const comment of batch) {
        pushComment(comment, false);
        const replies = Array.isArray(comment.preview_child_comments) ? comment.preview_child_comments : [];
        for (const reply of replies) pushComment(reply, true);
      }

      const next = payload.next_min_id;
      if (!next || !batch.length) {
        stoppedReason = !next ? 'no-next-min-id' : 'empty-page';
        break;
      }
      minId = typeof next === 'string' ? next : JSON.stringify(next);
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 250)));
    }

    return {
      comments,
      expectedCount,
      pagesFetched,
      stoppedReason: stoppedReason || (pagesFetched >= limit ? 'max-pages' : 'complete'),
    };
  }, { mediaId, maxPages });
}

async function saveDiagnostics(page, label) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}.png`), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(OUTPUT_DIR, `${label}.html`), await page.content(), 'utf8').catch(() => {});
}
async function scrape(postUrl, options = {}) {
  const url = normalizeInstagramUrl(postUrl);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, browserLaunchOptions({
    headless: process.env.IG_SCRAPER_HEADLESS === '1',
    viewport: { width: 1440, height: 1000 },
    locale: 'es-MX',
  }));
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    if (/\/accounts\/login/i.test(page.url())) {
      throw new Error('La sesion no esta iniciada. Ejecuta "npm run instagram:login".');
    }
    const maxScrolls = Math.min(Math.max(Number(options.maxScrolls) || 500, 1), 2500);
    const mediaId = await extractInstagramMediaId(page);
    if (mediaId) {
      const apiResult = await fetchCommentsViaInstagramApi(page, mediaId, maxScrolls);
      if (apiResult.comments.length) {
        await saveComments(apiResult.comments);
        lastResult = {
          url,
          comments: apiResult.comments,
          count: apiResult.comments.length,
          expected_count: apiResult.expectedCount,
          pages_fetched: apiResult.pagesFetched,
          stopped_reason: apiResult.stoppedReason,
          source: 'instagram-api',
          updated_at: new Date().toISOString(),
        };
        return lastResult;
      }
    }
    await loadAllComments(page, maxScrolls);
    const comments = await extractComments(page);
    if (!comments.length) await saveDiagnostics(page, 'instagram-empty-result');
    await saveComments(comments);
    lastResult = { url, comments, count: comments.length, source: 'dom-fallback', updated_at: new Date().toISOString() };
    return lastResult;
  } finally {
    await context.close();
  }
}

async function manualLogin() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, browserLaunchOptions({
    headless: false,
    viewport: null,
  }));
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  await prompt.question('Inicia sesion en Chromium y presiona Enter aqui cuando hayas terminado...');
  prompt.close();
  await context.close();
  console.log('Sesion persistente guardada.');
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (origin === 'https://hiddenroom.mx' || origin === 'https://www.hiddenroom.mx') return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return origin;
  return '';
}

function sendJson(req, res, status, payload) {
  const origin = allowedOrigin(req);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new Error('Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function route(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin && !allowedOrigin(req)) {
    return sendJson(req, res, 403, { ok: false, error: 'Origen no permitido.' });
  }
  if (req.method === 'OPTIONS') return sendJson(req, res, 204, {});
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(req, res, 200, { ok: true, busy: activeJob, count: lastResult.count || 0, updated_at: lastResult.updated_at });
  }
  if (req.method === 'GET' && url.pathname === '/api/results') {
    return sendJson(req, res, 200, { ok: true, ...lastResult });
  }
  if (req.method === 'POST' && url.pathname === '/api/scrape') {
    if (activeJob) return sendJson(req, res, 409, { ok: false, error: 'Ya hay un scraping en curso.' });
    activeJob = true;
    try {
      const body = await readJson(req);
      const result = await scrape(body.url, { maxScrolls: body.max_scrolls });
      return sendJson(req, res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(req, res, 400, { ok: false, error: error.message || 'No se pudo completar el scraping.' });
    } finally {
      activeJob = false;
    }
  }
  return sendJson(req, res, 404, { ok: false, error: 'Ruta no encontrada.' });
}

if (process.argv.includes('--login')) {
  manualLogin().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  http.createServer((req, res) => {
    route(req, res).catch((error) => sendJson(req, res, 500, { ok: false, error: error.message }));
  }).listen(PORT, HOST, () => {
    console.log(`Instagram scraper listo en http://${HOST}:${PORT}`);
  });
}












