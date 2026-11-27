// Reading the certificate archive: list pages (WebForms postback paging) and detail pages.
//
// The dashboard is ASP.NET WebForms with an UpdatePanel. Paging is a __doPostBack()
// call that swaps the panel in place, so there are no page URLs to visit directly.
// We click the pager like a person would and wait for "Showing X to Y of N entries"
// to change. Detail pages do have their own URL (/Student/CertificateInfo?ID=<guid>),
// and fill themselves with one more postback right after loading.
import { PATHS, isSignedOutUrl, isBrowserErrorUrl, isNetworkError, asNetworkError, detailUrl, SessionExpiredError, NetworkError } from './site.mjs';
import {
  emptyToNull, idFromHref, isTruncated, normalizeText, pageOf, parseShowing, postBackTarget, splitCodeTitle,
} from './text.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// How long a page load (loadMs) or a list postback (listMs) may take before we treat it as stuck.
// List postbacks get longer: the archive's list query has been seen taking ~30 s at busy hours, and
// giving up on one costs a reload plus a long walk back through the pager. Tests shorten both.
export const timeouts = { loadMs: 90_000, listMs: 120_000 };

// The page's own requests (postbacks, the page itself) that failed because the network is down.
// A postback that dies this way would otherwise only show up as a timeout much later.
const networkFailures = new WeakMap(); // page -> { at, error }

export function trackNetworkFailures(page) {
  page.on('requestfailed', (req) => {
    const error = req.failure()?.errorText ?? '';
    if (['document', 'xhr', 'fetch'].includes(req.resourceType()) && isNetworkError(error)) {
      networkFailures.set(page, { at: Date.now(), error: error.match(/ERR_[A-Z_]+/)?.[0] ?? error });
    }
  });
}

export function assertSignedIn(page, origin, where, since = 0) {
  if (isBrowserErrorUrl(page.url())) throw new NetworkError(where);
  const failed = networkFailures.get(page);
  if (failed && failed.at >= since) throw new NetworkError(`${failed.error} during ${where}`);
  if (isSignedOutUrl(page.url(), origin)) throw new SessionExpiredError(where);
}

/** page.goto that reports "offline" and "signed out" separately from other failures. */
async function load(page, url, origin, where, timeout) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    const net = asNetworkError(err, where);
    if (net) throw net;
    assertSignedIn(page, origin, where);
    throw err;
  }
}

const isNavigationNoise = (err) => /Execution context was destroyed|navigat|Target (page, context or browser )?(has been )?closed|frame was detached/i.test(String(err?.message));

/* ---------- functions that run inside the page ---------- */

function readListStateInPage() {
  const text = document.body ? document.body.innerText : '';
  const m = text.match(/Showing\s+[\d.,]+\s+to\s+[\d.,]+\s+of\s+[\d.,]+\s+entries/i);
  const links = [...document.querySelectorAll('a[href*="__doPostBack"]')]
    .map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
  const items = document.querySelectorAll('a[id*="rptData_CertName_"]').length;
  return { showing: m ? m[0] : null, links, items };
}

function extractListItemsInPage() {
  const text = (el) => {
    if (!el) return null;
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return c.textContent;
  };
  return [...document.querySelectorAll('a[id*="rptData_CertName_"]')].map((a) => {
    const m = a.id.match(/^(.*)CertName_(\d+)$/);
    const get = (name) => (m ? text(document.getElementById(`${m[1]}${name}_${m[2]}`)) : null);
    return {
      href: a.getAttribute('href'),
      name: text(a),
      credit: get('txtAvailableCreditEarning'),
      description: get('CertDescription'),
      outcomes: get('CertOutcomes'),
      administrator: get('CertAdministrator'),
      institution: get('CertInstitution'),
      duration: get('DurationOfLearning'),
    };
  });
}

function extractDetailInPage() {
  const text = (el) => {
    if (!el) return null;
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return c.textContent;
  };
  const byId = (id) => text(document.getElementById(id));
  const creditOptions = [...document.querySelectorAll('input[id*="rptMappingData_hdnMapId_"]')].map((input) => {
    const m = input.id.match(/^(.*)hdnMapId_(\d+)$/);
    const get = (name) => (m ? text(document.getElementById(`${m[1]}${name}_${m[2]}`)) : null);
    const row = input.closest('tr');
    return {
      mapId: input.value || null,
      info: get('lblCertificateInfo'),
      certificates: get('lblCertList'),
      courseInfo: get('lblCourseInfo'),
      courses: get('lblCourseInfoList'),
      note: row && row.children[1] ? text(row.children[1]) : null,
    };
  });
  return {
    name: byId('MainContent_CertName'),
    description: byId('MainContent_CertDescription'),
    outcomes: byId('MainContent_CertOutcomes'),
    administrator: byId('MainContent_CertAdministrator'),
    institution: byId('MainContent_CertInstitution'),
    duration: byId('MainContent_DurationOfLearning'),
    creditOptions,
  };
}

/* ---------- normalising what came out of the page ---------- */

export function normalizeListItem(raw, position, scrapedAt = new Date().toISOString()) {
  const { code, title } = splitCodeTitle(raw.name);
  const description = normalizeText(raw.description);
  const outcomes = emptyToNull(raw.outcomes);
  return {
    archiveId: idFromHref(raw.href),
    code,
    title,
    creditEarning: normalizeText(raw.credit),
    description,
    descriptionTruncated: isTruncated(description),
    learningOutcomes: outcomes,
    learningOutcomesTruncated: isTruncated(outcomes),
    administrator: emptyToNull(raw.administrator),
    institution: emptyToNull(raw.institution),
    duration: emptyToNull(raw.duration),
    archivePosition: position,
    scrapedAt,
  };
}

export function normalizeDetail(raw, archiveId, scrapedAt = new Date().toISOString()) {
  const { code, title } = splitCodeTitle(raw.name);
  const creditOptions = (raw.creditOptions ?? []).map((o) => {
    const out = {
      mapId: normalizeText(o.mapId),
      info: normalizeText(o.info),
      certificates: normalizeText(o.certificates),
      courseInfo: normalizeText(o.courseInfo),
      courses: normalizeText(o.courses),
      note: normalizeText(o.note),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null));
  });
  return {
    archiveId,
    code,
    title,
    description: normalizeText(raw.description),
    learningOutcomes: emptyToNull(raw.outcomes),
    administrator: emptyToNull(raw.administrator),
    institution: emptyToNull(raw.institution),
    duration: emptyToNull(raw.duration),
    creditOptions,
    scrapedAt,
  };
}

/** Sorts the pager's __doPostBack links into numbered pages, Next and Previous. */
export function readPager(links) {
  const pager = { numbers: [], next: null, prev: null };
  for (const link of links ?? []) {
    const target = postBackTarget(link.href);
    if (!target) continue;
    if (/PageButtonNext$/i.test(target)) pager.next = { target };
    else if (/PageButtonPrev(ious)?$/i.test(target)) pager.prev = { target };
    else if (/PageButton$/i.test(target) && /^\d+$/.test(link.text)) pager.numbers.push({ page: Number(link.text), target });
  }
  return pager;
}

/** Chooses the link that gets from page `current` closest to `target` in one click. */
export function pickPagerStep(pager, current, target) {
  if (target > current) {
    const ahead = pager.numbers.filter((l) => l.page > current && l.page <= target);
    return ahead.length ? ahead.reduce((a, b) => (b.page > a.page ? b : a)) : pager.next;
  }
  if (target < current) {
    const behind = pager.numbers.filter((l) => l.page < current && l.page >= target);
    return behind.length ? behind.reduce((a, b) => (b.page < a.page ? b : a)) : pager.prev;
  }
  return null;
}

/* ---------- browser steps ---------- */

/**
 * Polls until the list shows a "Showing" range that starts somewhere other than `prevFrom`
 * (null = any range). Throws SessionExpiredError if we get bounced to /UnAuthorize.
 */
export async function waitForList(page, origin, prevFrom, where, timeoutMs = timeouts.listMs, since = Date.now() - 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertSignedIn(page, origin, where, since);
    let state = null;
    try {
      state = await page.evaluate(readListStateInPage);
    } catch (err) {
      if (!isNavigationNoise(err)) throw err;
    }
    const showing = state && parseShowing(state.showing);
    if (showing && (showing.total === 0 || (showing.from !== prevFrom && state.items > 0))) {
      return { showing, pager: readPager(state.links) };
    }
    await sleep(250);
  }
  assertSignedIn(page, origin, where);
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for the certificate list (${where}).`);
}

/** Fresh dashboard load; the list arrives by postback and always starts on page 1. */
export async function openDashboard(page, origin) {
  await load(page, origin + PATHS.dashboard, origin, 'dashboard', timeouts.loadMs);
  return waitForList(page, origin, null, 'dashboard');
}

export async function clickPostBack(page, target) {
  const link = page.locator(`a[href*="'${target}'"]`).first();
  try {
    await link.click({ timeout: 10_000 });
  } catch (err) {
    if (isNavigationNoise(err)) return;
    // Hidden or covered link: run the same postback the link would.
    await page.evaluate((t) => window.__doPostBack(t, ''), target);
  }
}

/** Moves the list to page `target`, jumping through the pager window as far as it allows per click. */
export async function goToListPage(page, origin, target, pageSize, state, log = () => {}) {
  let current = pageOf(state.showing, pageSize);
  let hops = 0;
  while (current !== target) {
    const step = pickPagerStep(state.pager, current, target);
    if (!step) throw new Error(`No pager link leads from page ${current} toward page ${target}.`);
    await clickPostBack(page, step.target);
    state = await waitForList(page, origin, state.showing.from, `moving to page ${target}`);
    const next = pageOf(state.showing, pageSize);
    if (next === current) throw new Error(`Pager did not move (stuck on page ${current}).`);
    current = next;
    hops += 1;
    if (hops % 10 === 0) log(`    ...skipping ahead, now on page ${current} of the way to ${target}`);
    if (hops > 5000) throw new Error('Gave up moving through the pager.');
  }
  return state;
}

export async function readListItems(page, showing) {
  const raw = await page.evaluate(extractListItemsInPage);
  const scrapedAt = new Date().toISOString();
  return raw.map((r, i) => normalizeListItem(r, showing.from - 1 + i, scrapedAt));
}

export async function scrapeDetail(page, origin, archiveId, timeoutMs = timeouts.loadMs) {
  const where = `detail ${archiveId}`;
  const since = Date.now();
  await load(page, detailUrl(origin, archiveId), origin, where, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertSignedIn(page, origin, where, since);
    let ready = false;
    try {
      ready = await page.evaluate(() => {
        const el = document.getElementById('MainContent_CertName');
        return Boolean(el && el.textContent.trim());
      });
    } catch (err) {
      if (!isNavigationNoise(err)) throw err;
    }
    if (ready) {
      const raw = await page.evaluate(extractDetailInPage);
      return normalizeDetail(raw, archiveId);
    }
    await sleep(200);
  }
  assertSignedIn(page, origin, where);
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${where}.`);
}
