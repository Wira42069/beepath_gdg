// Unit tests for the scraper's pure parts (no browser). Run: node --test tests/scraper-unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyToNull, formatDuration, idFromHref, isTruncated, normalizeText, pageOf, parseShowing, postBackTarget, redactUrl, splitCodeTitle,
} from '../scraper/lib/text.mjs';
import { isAuthedUrl, isSignedOutUrl, isNetworkError, asNetworkError, NetworkError } from '../scraper/lib/site.mjs';
import { normalizeDetail, normalizeListItem, pickPagerStep, readPager } from '../scraper/lib/archive.mjs';
import { Store } from '../scraper/lib/store.mjs';

test('splitCodeTitle separates the archive code from the name', () => {
  assert.deepEqual(splitCodeTitle('CERT006132 - Introduction to Software Testing'), { code: 'CERT006132', title: 'Introduction to Software Testing' });
  assert.deepEqual(splitCodeTitle('  CERT001572 -  Belajar Membangun Arsitektur Microservices '), { code: 'CERT001572', title: 'Belajar Membangun Arsitektur Microservices' });
  assert.deepEqual(splitCodeTitle('CERT005794 - HackerRank Skills Certification Test: Java Basics'), { code: 'CERT005794', title: 'HackerRank Skills Certification Test: Java Basics' });
  assert.deepEqual(splitCodeTitle('No code here'), { code: null, title: 'No code here' });
});

test('normalizeText keeps line breaks but collapses spacing', () => {
  assert.equal(normalizeText('  a   b \n\n\n  c  d  \n'), 'a b\n\nc d');
  assert.equal(normalizeText('   '), null);
  assert.equal(normalizeText(null), null);
});

test('emptyToNull treats the archive placeholders as missing', () => {
  assert.equal(emptyToNull('Not Defined'), null);
  assert.equal(emptyToNull(' not defined '), null);
  assert.equal(emptyToNull('12 Hours'), '12 Hours');
});

test('isTruncated spots the list view cut-off', () => {
  assert.equal(isTruncated('Peserta akan ...'), true);
  assert.equal(isTruncated('tools,  ...'), true);
  assert.equal(isTruncated('Ends normally.'), false);
  assert.equal(isTruncated(null), false);
});

test('parseShowing and pageOf read the pager summary', () => {
  const s = parseShowing('Showing 11 to 20 of 3,539 entries');
  assert.deepEqual(s, { from: 11, to: 20, total: 3539 });
  assert.equal(pageOf(s, 10), 2);
  assert.equal(pageOf(parseShowing('Showing 3531 to 3539 of 3539 entries'), 10), 354);
  assert.equal(parseShowing('nothing here'), null);
});

test('idFromHref and postBackTarget', () => {
  assert.equal(idFromHref('/Student/CertificateInfo?ID=63EEFE03-0c4c-4531-b658-52509e2d4e9a'), '63eefe03-0c4c-4531-b658-52509e2d4e9a');
  assert.equal(idFromHref('/Student/Dashboard'), null);
  assert.equal(postBackTarget("javascript:__doPostBack('ctl00$MainContent$PageButtonNext','')"), 'ctl00$MainContent$PageButtonNext');
});

test('redactUrl hides the one-time BinusMaya token', () => {
  const out = redactUrl('https://studentcertification.apps.binus.ac.id/Student/Dashboard?Token=abc.def-123&Page=Dashboard');
  assert.ok(!out.includes('abc.def-123'));
  assert.match(out, /Token=REDACTED/);
  assert.match(out, /Page=Dashboard/);
});

test('signed-in / signed-out URL checks', () => {
  const origin = 'https://studentcertification.apps.binus.ac.id';
  assert.equal(isAuthedUrl(`${origin}/Student/Dashboard?Token=x`, origin), true);
  assert.equal(isAuthedUrl(`${origin}/UnAuthorize`, origin), false);
  assert.equal(isAuthedUrl(`${origin}/?Token=x&Page=Dashboard`, origin), false);
  assert.equal(isAuthedUrl('https://binusmaya.binus.ac.id/home', origin), false);
  assert.equal(isSignedOutUrl(`${origin}/UnAuthorize`, origin), true);
  assert.equal(isSignedOutUrl('https://login.microsoftonline.com/x', origin), true);
  assert.equal(isSignedOutUrl(`${origin}/Student/CertificateInfo?ID=1`, origin), false);
  assert.equal(isSignedOutUrl('about:blank', origin), false);
  assert.equal(isSignedOutUrl('chrome-error://chromewebdata/', origin), false, 'offline is not signed out');
});

test('network errors are told apart from other failures', () => {
  assert.equal(isNetworkError(new Error('page.goto: net::ERR_NETWORK_IO_SUSPENDED at https://x')), true);
  assert.equal(isNetworkError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x')), true);
  assert.equal(isNetworkError(new Error('net::ERR_CONNECTION_REFUSED')), true);
  assert.equal(isNetworkError(new NetworkError('x')), true);
  assert.equal(isNetworkError(new Error('Timed out after 45s waiting for detail 1')), false);
  assert.equal(isNetworkError(new Error('net::ERR_ABORTED')), false, 'aborted navigations are ours, not the network');
  assert.equal(asNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED at x'), 'w').message, 'Network unavailable (ERR_INTERNET_DISCONNECTED)');
  assert.equal(asNetworkError(new Error('boom'), 'w'), null);
});

test('readPager and pickPagerStep jump as far as the pager window allows', () => {
  const link = (text, target) => ({ text, href: `javascript:__doPostBack('${target}','')` });
  const pager = readPager([
    link('Previous', 'ctl00$MainContent$PageButtonPrevious'),
    link('4', 'ctl00$MainContent$rptPageButton$ctl00$PageButton'),
    link('5', 'ctl00$MainContent$rptPageButton$ctl01$PageButton'),
    link('7', 'ctl00$MainContent$rptPageButton$ctl03$PageButton'),
    link('8', 'ctl00$MainContent$rptPageButton$ctl04$PageButton'),
    link('Next', 'ctl00$MainContent$PageButtonNext'),
    { text: 'not a pager', href: '/Student/Dashboard' },
  ]);
  assert.deepEqual(pager.numbers.map((n) => n.page), [4, 5, 7, 8]);
  assert.equal(pickPagerStep(pager, 6, 100).page, 8);
  assert.equal(pickPagerStep(pager, 6, 7).page, 7);
  assert.equal(pickPagerStep(pager, 6, 1).page, 4);
  assert.equal(pickPagerStep(pager, 6, 5).page, 5);
  assert.equal(pickPagerStep({ numbers: [], next: { target: 'n' }, prev: null }, 1, 3).target, 'n');
  assert.equal(pickPagerStep(pager, 6, 6), null);
});

test('normalizeListItem and normalizeDetail shape the records', () => {
  const item = normalizeListItem({
    href: '/Student/CertificateInfo?ID=ABC', name: 'CERT000001 - Thing', credit: ' Non Credit Earning Only ',
    description: 'Long text cut here ...', outcomes: 'Not Defined', administrator: 'Coursera', institution: 'Not Defined', duration: '3 hours',
  }, 20, 'T');
  assert.deepEqual(item, {
    archiveId: 'abc', code: 'CERT000001', title: 'Thing', creditEarning: 'Non Credit Earning Only',
    description: 'Long text cut here ...', descriptionTruncated: true, learningOutcomes: null, learningOutcomesTruncated: false,
    administrator: 'Coursera', institution: null, duration: '3 hours', archivePosition: 20, scrapedAt: 'T',
  });
  const detail = normalizeDetail({
    name: 'CERT000001 - Thing', description: 'Full text.', outcomes: 'One\n• two', administrator: 'Coursera', institution: 'X', duration: '3 hours',
    creditOptions: [{ mapId: 'noncredit', info: 'Submit as Non Credit ', certificates: '', courseInfo: null, courses: '  ', note: '\n' }],
  }, 'abc', 'T');
  assert.equal(detail.learningOutcomes, 'One\n• two');
  assert.deepEqual(detail.creditOptions, [{ mapId: 'noncredit', info: 'Submit as Non Credit' }]);
});

test('Store checkpoints, resumes and merges', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beepath-store-'));
  try {
    const s1 = new Store(dir).load();
    s1.setListMeta({ pageSize: 2, total: 3, totalPages: 2 });
    s1.addListPage([
      { archiveId: 'a', code: 'C1', title: 'A', description: 'short ...', descriptionTruncated: true, learningOutcomes: null, archivePosition: 0 },
      { archiveId: 'b', code: 'C2', title: 'B', description: 'b', descriptionTruncated: false, learningOutcomes: 'o', archivePosition: 1 },
    ], 1);
    s1.addDetail({ archiveId: 'a', code: 'C1', title: 'A', description: 'full text', learningOutcomes: 'x', creditOptions: [], scrapedAt: 'T' });
    s1.addFailure('b', new Error('boom\nstack'));
    // A crash mid-write leaves half a line at the end; loading must survive it.
    fs.appendFileSync(path.join(dir, 'details.jsonl'), '{"archiveId":"b","cod');

    const s2 = new Store(dir).load();
    assert.equal(s2.progress.list.lastPage, 1);
    assert.equal(s2.progress.list.complete, false);
    assert.deepEqual(s2.pendingDetailIds(), ['b']);
    assert.equal(s2.failures.get('b').error, 'Error: boom');

    s2.addListPage([{ archiveId: 'c', code: 'C3', title: 'C', description: 'c', archivePosition: 2 }], 2);
    s2.completeList();
    const summary = s2.writeArchive();
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'archive.json'), 'utf8'));
    assert.deepEqual(rows.map((r) => r.archiveId), ['a', 'b', 'c']);
    assert.equal(rows[0].description, 'full text');
    assert.equal(rows[0].descriptionTruncated, false);
    assert.equal(rows[0].detailScraped, true);
    assert.equal(rows[1].detailScraped, false);
    assert.equal(summary.certificates, 3);
    assert.equal(summary.missingFromList, 0);
    assert.equal(summary.detailFailures, 1);

    s2.restartList();
    assert.equal(s2.progress.list.lastPage, 0);
    assert.equal(s2.progress.list.pageSize, 2);
    assert.equal(s2.list.size, 3, 'relisting keeps what was already saved');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('formatDuration', () => {
  assert.equal(formatDuration(5_000), '5s');
  assert.equal(formatDuration(125_000), '2m05s');
  assert.equal(formatDuration(3_900_000), '1h05m');
});
