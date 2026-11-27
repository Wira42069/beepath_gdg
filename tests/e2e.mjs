// Browser test of the whole student flow against the production build and a throwaway database.
//   npm run build && npm run e2e          (builds first if there is no build yet)
//   SHOTS=some/dir npm run e2e            also saves screenshots
//   E2E_BROWSER=chrome npm run e2e        use installed Chrome instead of Playwright's Chromium
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { chromium } from 'playwright';
import { seedDataset } from '../lib/seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); };
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.log('No production build yet, running next build...');
  const b = spawnSync(process.execPath, [nextBin, 'build'], { cwd: root, stdio: 'inherit', env });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

// Fresh database seeded with the sample data, so the test never touches .data/beepath.db.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beepath-e2e-'));
const dbUrl = `file:${path.join(tmp, 'e2e.db')}`;
const seedClient = createClient({ url: dbUrl });
await seedDataset(seedClient, { dataset: 'sample', dataDir: path.join(root, 'data') });
seedClient.close();

const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: root,
  env: { ...env, TURSO_DATABASE_URL: dbUrl, BEEPATH_DATASET: 'sample' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; ; i++) {
  try { if ((await fetch(base)).ok) break; } catch { /* not up yet */ }
  if (i > 120) throw new Error(`Server did not start:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 500));
}

const roles = JSON.parse(fs.readFileSync(path.join(root, 'data', 'roles.json'), 'utf8'));
const browser = await chromium.launch(process.env.E2E_BROWSER === 'chrome' ? { channel: 'chrome' } : {});
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page);

  // Home
  await page.goto(base);
  await page.getByRole('heading', { name: /What role do you want/ }).waitFor();
  assert.match(await page.locator('.banner').innerText(), /sample data/i);
  assert.equal(await page.locator('.role-card.soon').count(), roles.filter((r) => r.status !== 'available').length);
  await shot(page, '1-home');

  // Role path and skill panel
  await page.getByRole('link', { name: /Frontend Developer/ }).click();
  await page.locator('.node').first().waitFor();
  assert.equal(await page.locator('.node').count(), 12);
  assert.match(await page.locator('.progress').innerText(), /covered 0 of 12/);

  await page.getByRole('link', { name: /CSS and layout/ }).click();
  await page.locator('.cert').first().waitFor();
  assert.match(page.url(), /\/role\/frontend\?skill=fe-css$/, 'skill is in the URL');
  assert.equal(await page.locator('.cert').count(), 3, 'top 3 shown by default');
  await page.getByRole('button', { name: /Show \d+ more/ }).click();
  assert.ok((await page.locator('.cert').count()) > 3);

  await page.getByLabel('Free only').check();
  assert.equal(await page.locator('.cert .facts li:first-child', { hasText: 'Rp' }).count(), 0, 'free filter hides paid certificates');
  await page.getByLabel('Free only').uncheck();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText(/covered 1 of 12/).waitFor();
  await page.reload();
  await page.getByText(/covered 1 of 12/).waitFor();
  assert.equal(await page.locator('.panel.open h2').innerText(), 'CSS and layout', 'deep link reopens the skill');

  // Rate the top certificate: saved on the server, visible to everyone
  const topTitle = await page.locator('.cert h4').first().innerText();
  await page.getByRole('button', { name: /rate it/ }).first().click();
  await page.getByRole('button', { name: '4 stars' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await page.locator('.cert', { hasText: topTitle }).getByText(/1 rating/).waitFor();
  assert.match(await page.locator('.cert', { hasText: topTitle }).innerText(), /Your rating/);
  await shot(page, '2-role-desktop');

  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const op = await other.newPage();
  watch(op);
  await op.goto(`${base}/role/frontend?skill=fe-css`);
  await op.locator('.cert', { hasText: topTitle }).getByText(/1 rating/).waitFor();
  assert.doesNotMatch(await op.locator('.cert', { hasText: topTitle }).innerText(), /Your rating/, 'another student sees the rating, not as theirs');
  await other.close();

  // API rejects junk
  const bad = await page.request.post(`${base}/api/ratings`, { data: { certificateId: 'x', skillId: 'fe-css', stars: 9, relevant: true, clientId: 'abcdefgh-1' } });
  assert.equal(bad.status(), 400);
  const cross = await page.request.post(`${base}/api/ratings`, { data: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status(), 403);

  // Complete a certificate -> LinkedIn button, tracker, skill profile, CV draft
  await page.getByRole('button', { name: 'Mark as completed' }).first().click();
  await page.locator('.cert .badge.done', { hasText: 'Completed' }).first().waitFor();
  assert.match(await page.locator('.cert').first().innerText(), /Add to LinkedIn/);
  await page.getByRole('link', { name: 'My progress' }).click();
  await page.getByRole('heading', { name: 'My progress' }).waitFor();
  await page.locator('.tcert').first().waitFor();
  assert.equal(await page.locator('.tcert').count(), 1);
  assert.match(await page.locator('.tcert').innerText(), /In BeePath only/);
  assert.match(await page.locator('.card', { hasText: 'Frontend Developer' }).first().innerText(), /1 of 12 skills done/);
  assert.match(await page.locator('.chips li', { hasText: 'CSS and layout' }).first().innerText(), /certificate completed/);
  const li = await page.getByRole('link', { name: /Add to LinkedIn/ }).getAttribute('href');
  assert.match(li, /^https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME&name=/);
  await page.getByLabel('I have submitted it to Binus').check();
  await page.getByText('In BeePath and Binus').waitFor();
  const cv = await page.locator('#cv-text').inputValue();
  assert.match(cv, /CERTIFICATIONS\n- /);
  assert.match(cv, /SKILLS\nFrontend Developer: CSS and layout/);
  await page.reload();
  await page.locator('.tcert').first().waitFor();
  assert.equal(await page.locator('.tcert').count(), 1, 'completed certificates survive reload');
  await shot(page, '5-my-progress');

  // Archive: whole list, search, skill filter, free only (filters live in the URL)
  await page.getByRole('link', { name: 'Archive' }).click();
  await page.getByRole('heading', { name: 'Certificate archive' }).waitFor();
  const sampleCount = JSON.parse(fs.readFileSync(path.join(root, 'data', 'sample', 'certificates.json'), 'utf8')).length;
  assert.match(await page.locator('#arch-count').innerText(), new RegExp(`Showing ${Math.min(50, sampleCount)} of ${sampleCount} `));
  if (sampleCount > 50) {
    await page.getByRole('link', { name: /^Show \d+ more$/ }).click();
    await page.locator('#arch-count', { hasText: new RegExp(`Showing ${Math.min(100, sampleCount)} of ${sampleCount} `) }).waitFor();
  }
  await page.getByLabel('Search certificates').fill('css');
  await page.waitForURL(/q=css/);
  await page.locator('#arch-count', { hasNotText: new RegExp(`of ${sampleCount} `) }).waitFor();
  const n1 = await page.locator('#arch-list .cert').count();
  assert.ok(n1 > 0 && n1 < sampleCount, 'search narrows the list');
  assert.equal(await page.getByLabel('Search certificates').inputValue(), 'css', 'search box keeps its text');
  await page.getByLabel('Search certificates').fill('');
  await page.waitForURL((u) => !u.search.includes('q='));
  await page.getByLabel('Filter by skill').selectOption({ label: 'CSS and layout' });
  await page.waitForURL(/skill=fe-css/);
  await page.locator('#arch-count', { hasText: /best fit first/ }).waitFor();
  assert.ok((await page.locator('#arch-list .badge.match').count()) > 0, 'skill filter shows match labels');
  await page.getByLabel('Free only').check();
  await page.waitForURL(/free=1/);
  await page.locator('#arch-list').waitFor();
  assert.equal(await page.locator('#arch-list .facts li:first-child', { hasText: 'Rp' }).count(), 0);
  await shot(page, '6-archive');

  // Mobile: bottom sheet, no horizontal scroll anywhere
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  watch(mp);
  await mp.goto(`${base}/role/frontend`);
  await mp.locator('.node').first().waitFor();
  assert.equal(await mp.locator('.panel.open').count(), 0, 'no sheet before a skill is picked');
  await shot(mp, '3-role-mobile');
  await mp.getByRole('link', { name: /JavaScript fundamentals/ }).click();
  await mp.locator('.panel.open .cert').first().waitFor();
  assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal scroll on mobile');
  await shot(mp, '4-sheet-mobile');
  await mp.keyboard.press('Escape');
  await mp.locator('.panel.open').waitFor({ state: 'detached' });
  for (const route of ['/archive', '/me', '/']) {
    await mp.goto(`${base}${route}`);
    await mp.locator('h1').first().waitFor();
    assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `no horizontal scroll on ${route}`);
  }
  await shot(mp, '7-home-mobile');

  // Unknown role
  await page.goto(`${base}/role/nope`);
  await page.getByText("isn't available yet").waitFor();

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log('e2e passed');
} catch (err) {
  console.error(serverLog.split('\n').slice(-30).join('\n'));
  throw err;
} finally {
  await browser.close();
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  await exited;
  // Windows can hold the database file a moment after the server exits; a leftover temp dir is harmless.
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ }
}
