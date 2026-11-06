import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const results = [];
try {
  fs.mkdirSync('verification', { recursive: true });
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4 });
      Object.defineProperty(navigator, 'deviceMemory', { value: 2 });
      localStorage.setItem('locus.theme', 'light');
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.goto(server.resolvedUrls.local[0] + 'tests/polish-preview.html');
    await page.getByRole('heading', { name: 'Find your next stop' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.effects), 'reduced');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `verification/buildings-light-${width}.png` });
    let maxToggleMs = 0;
    for (let n = 0; n < 10; n++) {
      const ms = await page.evaluate(() => {
        const button = document.querySelector('[data-theme-toggle]');
        const before = document.documentElement.dataset.theme;
        const start = performance.now(); button.click();
        if (document.documentElement.dataset.theme === before) throw Error('Theme did not switch synchronously');
        if (button.disabled) throw Error('Theme toggle locked');
        return performance.now() - start;
      });
      maxToggleMs = Math.max(maxToggleMs, ms);
    }
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    assert.equal(await page.locator('[data-theme-toggle] .lucide-moon').count(), 1);
    await page.screenshot({ path: `verification/buildings-dark-${width}.png` });
    await page.getByRole('button', { name: /Hostels/ }).click();
    assert.equal(await page.getByRole('button', { name: /Hostels/ }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /All places/ }).click();
    await page.getByRole('searchbox').fill('tech park');
    const rows = page.getByTestId('building-row');
    assert.ok(await rows.count() >= 1);
    await rows.first().getByRole('button', { name: /^View / }).click();
    assert.equal(await page.evaluate(() => window.lastDirectoryAction.action), 'open');
    await rows.first().getByRole('button', { name: /^Navigate to/ }).click();
    assert.equal(await page.evaluate(() => window.lastDirectoryAction.action), 'navigate');
    await page.getByRole('searchbox').fill('zzunknown');
    await page.getByRole('button', { name: 'Show all places' }).click();
    assert.equal(await page.getByRole('searchbox').inputValue(), '');
    await page.locator('.directory-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const last = rows.last().getByRole('button', { name: /^Navigate to/ });
    await last.scrollIntoViewIfNeeded(); await last.click();
    const bounds = await last.boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
    assert.ok(bounds.y + bounds.height <= nav.y, 'last row must clear bottom tabs');
    assert.deepEqual(errors, []);
    results.push({ width, cpuThrottle: 6, maxToggleMs: Math.round(maxToggleMs), errors, passed: true });
    await page.close();
  }
  fs.writeFileSync('verification/polish-browser.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }
