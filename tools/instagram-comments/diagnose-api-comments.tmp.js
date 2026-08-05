const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.profile');
const OUTPUT_DIR = path.join(ROOT, 'output');
const MEDIA_ID = '3709439024881011682';
function existingFile(filePath) { return filePath && fsSync.existsSync(filePath) ? filePath : ''; }
function findFallbackBrowser() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  return [path.join(localAppData, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'), path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')].map(existingFile).find(Boolean) || '';
}
(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = findFallbackBrowser();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { ...(executablePath ? { executablePath } : {}), headless: false, viewport: { width: 1440, height: 1000 }, locale: 'es-MX' });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.instagram.com/p/DN6kyPCAQvi/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(async (mediaId) => {
    const res = await fetch(`/api/v1/media/${mediaId}/comments/?can_support_threading=true`, {
      credentials: 'include',
      headers: { 'x-ig-app-id': '936619743392459', 'x-requested-with': 'XMLHttpRequest' },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, text: text.slice(0, 1000), json };
  }, MEDIA_ID);
  await fs.writeFile(path.join(OUTPUT_DIR, 'instagram-api-comments-first.json'), JSON.stringify(data, null, 2), 'utf8');
  await context.close();
  const comments = data.json?.comments || data.json?.preview_comments || [];
  console.log(JSON.stringify({ status: data.status, ok: data.ok, commentCount: comments.length, keys: data.json ? Object.keys(data.json) : [] }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
