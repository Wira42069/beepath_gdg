// Browser smoke test of the core flow. Needs Playwright and a Chrome binary.
//   npm run e2e            (set CHROME_PATH if Chrome isn't at /usr/bin/google-chrome)
//   SHOTS=/some/dir npm run e2e   also saves screenshots
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { createServer } from '../scripts/serve.mjs';

let pw;
try { pw = createRequire(import.meta.url)('playwright'); }
catch { pw = createRequire('/opt/npm-tools/package.json')('playwright'); }

const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };

const server = createServer();
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base);
  await page.getByRole('heading', { name: /What role do you want/ }).waitFor();
  assert.match(await page.locator('#banner').innerText(), /sample data/i);
  assert.equal(await page.locator('.role-card.soon').count(), 4);
  await shot(page, '1-home');

  await page.getByRole('link', { name: /Frontend Developer/ }).click();
  await page.locator('.node').first().waitFor();
  assert.equal(await page.locator('.node').count(), 12);
  assert.match(await page.locator('.progress').innerText(), /covered 0 of 12/);

  await page.getByRole('link', { name: /CSS and layout/ }).click();
  await page.locator('.cert').first().waitFor();
  assert.equal(await page.locator('.cert').count(), 3, 'top 3 shown by default');
  await page.getByRole('button', { name: /Show \d+ more/ }).click();
  assert.ok((await page.locator('.cert').count()) > 3);

  await page.getByLabel('Free only').check();
  const paid = await page.locator('.cert .facts li:first-child', { hasText: 'Rp' }).count();
  assert.equal(paid, 0, 'free filter hides paid certificates');
  await page.getByLabel('Free only').uncheck();

  await page.getByRole('button', { name: 'Done' }).click();
  assert.match(await page.locator('.progress').innerText(), /covered 1 of 12/);
  await page.reload();
  assert.match(await page.locator('.progress').innerText(), /covered 1 of 12/, 'progress survives reload');

  await page.getByRole('button', { name: /rate it/ }).first().click();
  await page.getByRole('button', { name: '4 stars' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('button', { name: 'Save rating' }).click();
  assert.match(await page.locator('.cert').first().innerText(), /Your rating/);
  assert.match(await page.locator('.cert').first().innerText(), /1 rating/);
  await shot(page, '2-role-desktop');

  // complete a certificate -> LinkedIn button, tracker, skill profile, CV draft
  await page.getByRole('button', { name: 'Mark as completed' }).first().click();
  await page.locator('.cert .badge.done').first().waitFor();
  assert.match(await page.locator('.cert').first().innerText(), /Add to LinkedIn/);
  await page.getByRole('link', { name: 'My progress' }).click();
  await page.getByRole('heading', { name: 'My progress' }).waitFor();
  assert.equal(await page.locator('.tcert').count(), 1);
  assert.match(await page.locator('.tcert').innerText(), /In BeePath only/);
  assert.match(await page.locator('.card', { hasText: 'Frontend Developer' }).first().innerText(), /1 of 12 skills done/);
  assert.match(await page.locator('.chips li', { hasText: 'CSS and layout' }).first().innerText(), /certificate completed/);
  const li = await page.getByRole('link', { name: /Add to LinkedIn/ }).getAttribute('href');
  assert.match(li, /^https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME&name=/);
  await page.getByLabel('I have submitted it to Binus').check();
  assert.match(await page.locator('.tcert').innerText(), /In BeePath and Binus/);
  const cv = await page.locator('#cv-text').inputValue();
  assert.match(cv, /CERTIFICATIONS\n- /);
  assert.match(cv, /SKILLS\nFrontend Developer: CSS and layout/);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.reload();
  await page.locator('.tcert').first().waitFor();
  assert.equal(await page.locator('.tcert').count(), 1, 'completed certificates survive reload');
  await shot(page, '5-my-progress');

  // archive: whole list, filter by skill, search, free only
  await page.getByRole('link', { name: 'Archive' }).click();
  await page.getByRole('heading', { name: 'Certificate archive' }).waitFor();
  assert.match(await page.locator('#arch-count').innerText(), /Showing 46 of 46/);
  await page.getByLabel('Search certificates').fill('css');
  const n1 = await page.locator('#arch-list .cert').count();
  assert.ok(n1 > 0 && n1 < 46, 'search narrows the list');
  await page.getByLabel('Search certificates').fill('');
  await page.getByLabel('Filter by skill').selectOption({ label: 'CSS and layout' });
  assert.match(await page.locator('#arch-count').innerText(), /best fit first/);
  assert.ok((await page.locator('#arch-list .badge.match').count()) > 0, 'skill filter shows match labels');
  await page.getByLabel('Free only').check();
  assert.equal(await page.locator('#arch-list .facts li:first-child', { hasText: 'Rp' }).count(), 0);
  await shot(page, '6-archive');

  // mobile bottom sheet
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(e.message));
  await mp.goto(`${base}/#/role/frontend`);
  await mp.locator('.node').first().waitFor();
  assert.equal(await mp.locator('.panel.open').count(), 0, 'no sheet before a skill is picked');
  await shot(mp, '3-role-mobile');
  await mp.getByRole('link', { name: /JavaScript fundamentals/ }).click();
  await mp.locator('.panel.open .cert').first().waitFor();
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no horizontal scroll on mobile');
  await shot(mp, '4-sheet-mobile');

  for (const route of ['#/archive', '#/me']) {
    await mp.goto(`${base}/${route}`);
    await mp.locator('h1').waitFor();
    assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `no horizontal scroll on ${route}`);
  }
  await shot(mp, '7-me-mobile');

  // unknown / coming-soon role
  await page.goto(`${base}/#/role/backend`);
  await page.getByText("isn't available yet").waitFor();

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log('e2e passed');
} finally {
  await browser.close();
  server.close();
}
