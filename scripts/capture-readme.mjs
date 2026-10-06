// Capture README screenshots from the running DSH Web instance, without installing,
// upgrading, toggling, deleting, or restarting anything.
// Usage: npm run capture:readme [-- --url http://127.0.0.1:3080 --out docs/images]
// Screenshot privacy: clip to the dsh-m panel, omit transient version chips, and
// replace the installed-page absolute profile path with an explicit redaction.
// Images document the installed UI, which may be older than the repository HEAD.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (key, fallback) => {
  const i = argv.indexOf(key);
  return i < 0 ? fallback : argv[i + 1];
};
const url = arg('--url', 'http://127.0.0.1:3080');
const out = resolve(arg('--out', 'docs/images'));
const viewport = { width: 1600, height: 1000 };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
mkdirSync(out, { recursive: true });

async function settle(page) {
  await page.locator('.dshm-panel').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => {
    for (const chip of document.querySelectorAll('.dshm-dshchip')) chip.style.display = 'none';
    for (const hint of document.querySelectorAll('.dshm-hint')) {
      if (/^profile\s*[:：]/i.test(hint.textContent.trim())) hint.textContent = 'profile: web（本机路径已隐藏）';
    }
  });
}
function clipOf(box, pad = 0) {
  return { x: Math.max(0, Math.floor(box.x - pad)), y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.min(viewport.width, Math.ceil(box.x + box.width + pad)) - Math.max(0, Math.floor(box.x - pad)),
    height: Math.min(viewport.height, Math.ceil(box.y + box.height + pad)) - Math.max(0, Math.floor(box.y - pad)) };
}
async function shot(page, name, clip) {
  await settle(page);
  const visibleText = await page.locator('.dshm-panel').innerText();
  if (/profile\s*[:：]\s*\//i.test(visibleText)) throw new Error('privacy gate: unredacted absolute profile path');
  const bounds = clip ?? clipOf(await page.locator('.dshm-panel').boundingBox(), 8);
  const png = await page.screenshot({ clip: bounds, animations: 'disabled' });
  const webp = await page.evaluate(async ({ dataUrl }) => {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = dataUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.83);
  }, { dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  const data = Buffer.from(webp.split(',')[1], 'base64');
  writeFileSync(join(out, name), data);
  console.log(`${name}: ${Math.round(data.length / 1024)} KiB`);
}
const tab = (page, label) => page.locator('.dshm-panel button').filter({ hasText: label }).first();
try {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '插件市场', exact: true }).first().click();
  await settle(page);
  await page.locator('.dshm-cards > *').first().waitFor({ timeout: 20_000 });
  const panel = await page.locator('.dshm-panel').boundingBox();

  // Community categories: expanding category chips is local view state only.
  const more = page.locator('button').filter({ hasText: /^\+\d+$/ }).first();
  if (await more.count()) await more.click();
  await shot(page, 'community-catalog.webp', clipOf({ x: panel.x + 9, y: panel.y + 54, width: panel.width - 18, height: 215 }));

  await tab(page, /^精选\s*\d+/).click();
  await page.getByText('DSH Skins', { exact: true }).first().waitFor({ timeout: 20_000 });
  await shot(page, 'marketplace.webp');
  await shot(page, 'curated-registry.webp', clipOf({ x: panel.x + 9, y: panel.y + 54, width: panel.width - 18, height: 135 }));

  await page.locator('input[placeholder*="搜索名称"]').fill('皮肤');
  await page.locator('.dsvm-searchmeta').waitFor({ timeout: 20_000 });
  await page.getByText('dsh-skin-lab', { exact: true }).first().waitFor({ timeout: 20_000 });
  await shot(page, 'search-results.webp');

  await page.locator('input[placeholder*="搜索名称"]').fill('dsh-tui');
  await page.getByText('DSH TUI', { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.getByText('DSH TUI', { exact: true }).first().click();
  await page.locator('.dsvm-modalbox').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.dsvm-modalbox button').filter({ hasText: /^安装$/ }).waitFor({ timeout: 15_000 });
  await shot(page, 'plugin-detail.webp', clipOf(await page.locator('.dsvm-modalbox').boundingBox(), 16));
  await page.locator('.dsvm-modalbox button[title="关闭"]').first().click();

  await tab(page, /^已装\s*\d+/).click();
  await page.locator('.dshm-panel').getByText('@iasiv5/dsh-skins', { exact: true }).waitFor({ timeout: 15_000 });
  await shot(page, 'installed.webp');
  await tab(page, /^设置$/).click();
  await page.getByText('社区清单（from awesome-dsh-plugin）').waitFor({ timeout: 15_000 });
  await shot(page, 'settings.webp');
  await context.close();
} finally {
  await browser.close();
}
