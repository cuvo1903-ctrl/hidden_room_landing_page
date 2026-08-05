const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.profile');
const OUTPUT_DIR = path.join(ROOT, 'output');
const MEDIA_ID = '3709439024881011682';
function existingFile(filePath) { return filePath && fsSync.existsSync(filePath) ? filePath : ''; }
function findFallbackBrowser() { const l=process.env.LOCALAPPDATA||'', p=process.env.PROGRAMFILES||'', x=process.env['PROGRAMFILES(X86)']||''; return [path.join(l,'ms-playwright','chromium-1228','chrome-win64','chrome.exe'),path.join(p,'Google','Chrome','Application','chrome.exe'),path.join(x,'Google','Chrome','Application','chrome.exe'),path.join(p,'Microsoft','Edge','Application','msedge.exe')].map(existingFile).find(Boolean)||''; }
(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = findFallbackBrowser();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { ...(executablePath ? { executablePath } : {}), headless: false, viewport: { width: 1440, height: 1000 }, locale: 'es-MX' });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.instagram.com/p/DN6kyPCAQvi/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(async (mediaId) => {
    const pages = [];
    let minId = '';
    for (let i = 0; i < 5; i += 1) {
      const qs = new URLSearchParams({ can_support_threading: 'true' });
      if (minId) qs.set('min_id', minId);
      const res = await fetch(`/api/v1/media/${mediaId}/comments/?${qs}`, { credentials: 'include', headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' } });
      const json = await res.json();
      pages.push({ status: res.status, count: (json.comments || []).length, has_more_comments: json.has_more_comments, next_min_id: json.next_min_id, sample: (json.comments || []).slice(0,2) });
      minId = json.next_min_id;
      if (!json.has_more_comments || !minId) break;
    }
    return pages;
  }, MEDIA_ID);
  await fs.writeFile(path.join(OUTPUT_DIR, 'instagram-api-comments-pages.json'), JSON.stringify(data, null, 2), 'utf8');
  await context.close();
  console.log(JSON.stringify(data.map((p, i) => ({ page: i + 1, status: p.status, count: p.count, more: p.has_more_comments, next: !!p.next_min_id })), null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
