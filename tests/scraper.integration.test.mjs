// End-to-end scraper tests against a local mock of the certification site (tests/scraper/mock-site.mjs).
// Needs Playwright's Chromium:  npm run test:scraper
// Covers: first sign-in through a BinusMaya-style popup, session reuse across browser restarts,
// re-entry when the session expires mid-list and mid-details (both redirect and "silent" styles),
// resuming after a stop, --relist, and giving up cleanly when nobody signs in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockSite, makeItems } from './scraper/mock-site.mjs';
import { runScraper } from '../scraper/run.mjs';
import { LoginAbortedError } from '../scraper/lib/site.mjs';

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beepath-scrape-'));
  return { root, out: path.join(root, 'out'), authDir: path.join(root, 'auth') };
}

async function withSite(siteOpts, fn) {
  const site = await createMockSite(siteOpts).start();
  const dirs = tempDirs();
  const logs = [];
  const run = (extra = {}) => runScraper({
    origin: site.origin,
    loginUrl: site.loginUrl,
    out: dirs.out,
    authDir: dirs.authDir,
    browser: 'chromium',
    delayMs: 0,
    loginHeadless: true, // the mock "BinusMaya" signs in by itself
    loginTimeoutMs: 15_000,
    loadTimeoutMs: 8_000,
    listTimeoutMs: 8_000,
    log: (m) => logs.push(m),
    ...extra,
  });
  try {
    await fn({ site, dirs, logs, run });
  } catch (err) {
    console.error(logs.join('\n'));
    throw err;
  } finally {
    await site.close();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
}

const readArchive = (dirs) => JSON.parse(fs.readFileSync(path.join(dirs.out, 'archive.json'), 'utf8'));

function assertCompleteArchive(rows, items) {
  assert.equal(rows.length, items.length, 'every certificate once');
  assert.equal(new Set(rows.map((r) => r.archiveId)).size, items.length, 'no duplicates');
  rows.forEach((r, i) => {
    const it = items[i];
    assert.equal(r.archiveId, it.id);
    assert.equal(r.code, it.code);
    assert.equal(r.archivePosition, i);
    assert.equal(r.detailScraped, true, `${it.code} has details`);
    assert.equal(r.description, it.description, `${it.code} has the full description`);
    assert.equal(r.descriptionTruncated, false);
  });
}

test('first run signs in, scrapes list + details, survives expiry, and output is clean', { timeout: 180_000 }, async () => {
  const items = makeItems(23);
  await withSite({ items, pageSize: 5, windowSize: 3, expireAfter: 9 }, async ({ site, dirs, logs, run }) => {
    const result = await run();
    const rows = readArchive(dirs);
    assertCompleteArchive(rows, items);

    assert.ok(site.stats.logins >= 3, `expected several re-entries, got ${site.stats.logins} logins`);
    assert.ok(result.stats.reentries >= 2);
    assert.equal(result.summary.listComplete, true);
    assert.equal(result.summary.missingFromList, 0);

    // Field handling
    const amp = rows[1];
    assert.equal(amp.title, 'Mock Certificate 2 & Ampersand <Test>');
    assert.equal(amp.learningOutcomes, 'Line one\n• bullet two\n• bullet three');
    assert.equal(rows[0].learningOutcomes, null, '"Not Defined" becomes null');
    assert.equal(rows[0].institution, null);
    const credit = rows[2];
    assert.equal(credit.creditEarning, 'Credit Earning Available');
    assert.equal(credit.creditOptions.length, 2);
    assert.equal(credit.creditOptions[1].courses, 'COMP0001 - Mock Course One\nCOMP0002 - Mock Course Two');
    assert.equal(credit.creditOptions[1].note, '4 SKS');
    assert.equal(result.summary.creditEarningOptions, 1);

    // Nothing personal or secret leaks into output or logs
    const outText = fs.readdirSync(dirs.out).map((f) => fs.readFileSync(path.join(dirs.out, f), 'utf8')).join('\n');
    assert.ok(!/TEST STUDENT|2501234567/.test(outText), 'student name/ID never saved');
    assert.ok(!/one-time-secret/.test(outText + logs.join('\n')), 'login token never saved or printed');
    assert.ok(fs.existsSync(path.join(dirs.authDir, 'session.json')));

    // A second run has nothing left to do and must not duplicate anything.
    const again = await run();
    assert.equal(again.stats.listPages, 0);
    assert.equal(again.stats.details, 0);
    assertCompleteArchive(readArchive(dirs), items);
  });
});

test('saved session is reused after the browser restarts (no new sign-in)', { timeout: 60_000 }, async () => {
  await withSite({ items: makeItems(4) }, async ({ site, run }) => {
    const first = await run({ loginOnly: true });
    assert.equal(first.session, 'signed-in');
    assert.equal(site.stats.logins, 1);

    // New browser process: only session.json carries the (session-only) cookie over.
    const check = await run({ check: true });
    assert.equal(check.session, 'signed-in');
    const second = await run({ loginOnly: true });
    assert.equal(second.session, 'reused');
    assert.equal(site.stats.logins, 1, 'no second sign-in');

    site.expireAll();
    const expired = await run({ check: true });
    assert.equal(expired.session, 'signed-out');
  });
});

test('stops early, resumes at the right page, and --relist walks again without duplicates', { timeout: 120_000 }, async () => {
  const items = makeItems(32);
  await withSite({ items, pageSize: 4, windowSize: 3 }, async ({ dirs, logs, run }) => {
    const r1 = await run({ phase: 'list', maxPages: 3 });
    assert.equal(r1.summary.listPagesDone, 3);
    assert.equal(r1.summary.certificates, 12);
    assert.equal(r1.summary.listComplete, false);

    const r2 = await run({ phase: 'list' });
    assert.ok(logs.some((l) => /Resuming the list at page 4 of 8/.test(l)));
    assert.equal(r2.stats.listPages, 5);
    assert.equal(r2.summary.listComplete, true);
    assert.equal(r2.summary.certificates, 32);

    const r3 = await run({ phase: 'details', maxDetails: 5 });
    assert.equal(r3.summary.withDetails, 5);
    const r4 = await run();
    assertCompleteArchive(readArchive(dirs), items);
    assert.equal(r4.stats.details, 27);

    const r5 = await run({ relist: true, phase: 'list' });
    assert.equal(r5.stats.listPages, 8);
    assertCompleteArchive(readArchive(dirs), items);
  });
});

test('"silent" expiry (postback just stops working) is detected and recovered', { timeout: 120_000 }, async () => {
  const items = makeItems(12);
  await withSite({ items, pageSize: 4, expireAfter: 7, expiryStyle: 'silent' }, async ({ site, dirs, run }) => {
    await run({ loadTimeoutMs: 2_000, listTimeoutMs: 2_000 });
    assertCompleteArchive(readArchive(dirs), items);
    assert.ok(site.stats.logins >= 2);
  });
});

test('a network outage mid-run is waited out, not treated as a sign-out or a failed page', { timeout: 120_000 }, async () => {
  const items = makeItems(10);
  await withSite({ items, pageSize: 5 }, async ({ site, dirs, logs, run }) => {
    let outage = null;
    const timer = setInterval(() => {
      if (!outage && site.stats.detailPosts >= 3) outage = site.goOffline(3_000);
    }, 50);
    try {
      const result = await run({ offlinePollMs: 300 });
      assert.equal(site.stats.outages, 1, 'the outage happened during the run');
      assert.ok(result.stats.offlineWaits >= 1, 'the scraper noticed it was offline');
      assert.equal(result.stats.failures, 0, 'no page was given up on');
      assert.equal(site.stats.logins, 1, 'no new sign-in because of the outage');
      assert.ok(logs.some((l) => /Waiting for the network/.test(l)));
      assertCompleteArchive(readArchive(dirs), items);
    } finally {
      clearInterval(timer);
      await outage;
    }
  });
});

test('gives up cleanly when nobody signs in, keeping what was saved', { timeout: 60_000 }, async () => {
  await withSite({ items: makeItems(3) }, async ({ site, run }) => {
    await assert.rejects(
      run({ loginUrl: `${site.loginUrl}?mode=never`, loginTimeoutMs: 1_500 }),
      (err) => err instanceof LoginAbortedError && /Gave up waiting/.test(err.message),
    );
  });
});
