const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.profile');
const OUTPUT_DIR = path.join(ROOT, 'output');
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
  await page.waitForTimeout(4000);
  const before = await page.locator('time').count();
  const countButton = page.getByRole('button', { name: /3,5 mil|3.5K|3,525|3525/i });
  const matches = await countButton.count().catch(() => 0);
  if (matches) await countButton.nth(0).click({ timeout: 5000 }).catch((error) => console.log('click failed', error.message));
  await page.waitForTimeout(5000);
  const after = await page.locator('time').count();
  const data = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 5000),
    buttons: [...document.querySelectorAll('[role="button"],button')].map((n) => (n.innerText || n.textContent || n.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 120),
    times: document.querySelectorAll('time').length,
  }));
  await fs.writeFile(path.join(OUTPUT_DIR, 'instagram-after-count-click.json'), JSON.stringify({ before, matches, after, data }, null, 2), 'utf8');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'instagram-after-count-click.png'), fullPage: true });
  await context.close();
  console.log(JSON.stringify({ before, matches, after, file: 'tools/instagram-comments/output/instagram-after-count-click.json' }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
