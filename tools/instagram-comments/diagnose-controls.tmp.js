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
  return [
    path.join(localAppData, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].map(existingFile).find(Boolean) || '';
}
(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = findFallbackBrowser();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...(executablePath ? { executablePath } : {}),
    headless: false,
    viewport: { width: 1440, height: 1000 },
    locale: 'es-MX',
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.instagram.com/p/DN6kyPCAQvi/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const snapshot = await page.evaluate(() => {
    const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const pick = (selector) => [...document.querySelectorAll(selector)].map((node) => ({
      tag: node.tagName,
      role: node.getAttribute('role'),
      aria: node.getAttribute('aria-label'),
      href: node.getAttribute('href'),
      text: clean(node.innerText || node.textContent).slice(0, 240),
      visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    })).filter((item) => item.visible && (item.text || item.aria || item.href));
    return {
      url: location.href,
      title: document.title,
      bodyText: clean(document.body.innerText).slice(0, 10000),
      counts: {
        buttons: document.querySelectorAll('button').length,
        links: document.querySelectorAll('a').length,
        roleButtons: document.querySelectorAll('[role="button"]').length,
        times: document.querySelectorAll('time').length,
      },
      buttons: pick('button').slice(0, 200),
      roleButtons: pick('[role="button"]').slice(0, 200),
      links: pick('a').slice(0, 200),
    };
  });
  await fs.writeFile(path.join(OUTPUT_DIR, 'instagram-dom-controls.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'instagram-dom-controls.png'), fullPage: true });
  await context.close();
  console.log(JSON.stringify({ counts: snapshot.counts, file: 'tools/instagram-comments/output/instagram-dom-controls.json' }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
