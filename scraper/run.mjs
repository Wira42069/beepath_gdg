// Orchestrates a scrape: sign in (or reuse the saved session), walk the list pages,
// read each detail page, write archive.json. Every step is resumable, and a signed-out
// response at any point triggers re-entry and then carries on where it stopped.
import path from 'node:path';
import { Session } from './lib/session.mjs';
import { Store } from './lib/store.mjs';
import dns from 'node:dns/promises';
import { DEFAULTS, SessionExpiredError, LoginAbortedError, isNetworkError } from './lib/site.mjs';
import { goToListPage, openDashboard, readListItems, clickPostBack, waitForList, scrapeDetail, timeouts } from './lib/archive.mjs';
import { formatDuration, pageOf } from './lib/text.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const RUN_DEFAULTS = {
  origin: DEFAULTS.origin,
  loginUrl: DEFAULTS.loginUrl,
  out: 'raw/binus-archive',
  authDir: '.auth',
  phase: 'all', // all | list | details
  browser: 'chrome',
  headed: false,
  delayMs: 1000,
  retries: 3,
  maxPages: Infinity,
  maxDetails: Infinity,
  loginTimeoutMs: 10 * 60_000,
  maxReentriesWithoutProgress: 3,
  offlineWaitMs: 60 * 60_000, // how long to wait for the network to come back before giving up
  offlinePollMs: 15_000,
  loginOnly: false,
  check: false,
  relist: false,
  loginHeadless: false,
  loadTimeoutMs: 90_000,
  listTimeoutMs: 120_000,
};

export async function runScraper(options = {}) {
  const opts = { ...RUN_DEFAULTS, ...options };
  const log = opts.log ?? ((m) => console.log(m));
  const debug = opts.debug ? (m) => log(`  [debug] ${m}`) : () => {};
  const signal = opts.signal;
  const stopping = () => Boolean(signal?.aborted);
  // Politeness: the base delay plus jitter, and after a slow response, about half as long as it
  // took (up to 30 s). A struggling server gets fewer requests; a fast one isn't held back.
  let lastStepMs = 0;
  const pause = () => {
    const base = Math.max(opts.delayMs, Math.min(30_000, lastStepMs / 2));
    return sleep(base + Math.random() * base * 0.5);
  };

  timeouts.loadMs = opts.loadTimeoutMs;
  timeouts.listMs = opts.listTimeoutMs;
  const store = new Store(opts.out, log).load();
  const session = new Session({ ...opts, log });
  const stats = { listPages: 0, details: 0, failures: 0, reentries: 0, offlineWaits: 0 };

  /**
   * Runs `task` until it finishes. Signed out -> re-enter and run it again (the task resumes
   * from the store). Other errors -> back off and retry. Gives up only when retries happen
   * without any new record being saved in between.
   */
  /** Offline, asleep or DNS down: wait (without using up retries) until the site's host resolves again. */
  async function waitForNetwork(reason) {
    const host = new URL(session.origin).hostname;
    const deadline = Date.now() + opts.offlineWaitMs;
    log(`! ${reason}. Waiting for the network to come back (is this computer going to sleep?)...`);
    stats.offlineWaits += 1;
    while (Date.now() < deadline && !stopping()) {
      await sleep(opts.offlinePollMs);
      try {
        await dns.lookup(host);
        log('  Network is back, continuing.');
        return;
      } catch {
        // still offline
      }
    }
    if (!stopping()) throw new Error(`The network was down for over ${Math.round(opts.offlineWaitMs / 60000)} minutes.`);
  }

  async function resilient(name, task) {
    let errorsWithoutProgress = 0;
    let reentriesWithoutProgress = 0;
    let offlineSince = null;
    let lastTick = store.tick;
    for (;;) {
      const tick = store.tick;
      try {
        return await task();
      } catch (err) {
        if (stopping()) return undefined;
        if (err instanceof LoginAbortedError) throw err;
        if (isNetworkError(err)) {
          // DNS can resolve while the site still refuses connections, so cap the total time spent
          // offline without saving anything, not just one wait.
          if (offlineSince == null || store.tick !== lastTick) offlineSince = Date.now();
          lastTick = store.tick;
          if (Date.now() - offlineSince > opts.offlineWaitMs) {
            throw new Error(`Could not reach the site for over ${Math.round(opts.offlineWaitMs / 60000)} minutes (${err.message}).`);
          }
          await waitForNetwork(err.message);
          continue;
        }
        offlineSince = null;
        const progressed = store.tick !== tick;
        if (err instanceof SessionExpiredError) {
          reentriesWithoutProgress = progressed ? 1 : reentriesWithoutProgress + 1;
          if (reentriesWithoutProgress > opts.maxReentriesWithoutProgress) {
            throw new Error(`Signed out ${reentriesWithoutProgress} times in a row without saving anything. Stopping so we don't hammer the site.`);
          }
          log(`! ${err.message}. Getting back in...`);
          try {
            const how = await session.recover();
            if (how === 'signed-in') stats.reentries += 1;
          } catch (recoverErr) {
            if (!isNetworkError(recoverErr)) throw recoverErr;
            await waitForNetwork(recoverErr.message);
          }
          continue;
        }
        errorsWithoutProgress = progressed ? 1 : errorsWithoutProgress + 1;
        if (errorsWithoutProgress > opts.retries) throw err;
        const wait = Math.min(60_000, 2000 * 2 ** (errorsWithoutProgress - 1));
        log(`! ${name}: ${String(err.message).split('\n')[0]} (retry ${errorsWithoutProgress}/${opts.retries} in ${Math.round(wait / 1000)}s)`);
        await sleep(wait);
        // Some sign-outs don't redirect; they just break the page. Check before retrying.
        try {
          if (!(await session.checkSignedIn())) {
            await session.recover();
            stats.reentries += 1;
          }
        } catch (checkErr) {
          if (!isNetworkError(checkErr)) throw checkErr;
          await waitForNetwork(checkErr.message);
        }
      }
    }
  }

  const pageTimes = []; // recent page finish times, for the ETA
  async function scrapeList() {
    const p = store.progress.list;
    let state = await openDashboard(session.page, session.origin);
    if (state.showing.total === 0) {
      log('The archive list is empty.');
      store.completeList();
      return;
    }
    // Page size is read on page 1 (a fresh dashboard load always starts there) and kept for resumes.
    if (!p.pageSize) {
      if (state.showing.from !== 1) throw new Error('Expected the dashboard to open on page 1.');
      p.pageSize = state.showing.to - state.showing.from + 1;
    }
    const totalPages = Math.ceil(state.showing.total / p.pageSize);
    if (p.total != null && p.total !== state.showing.total) {
      log(`  Note: the archive now lists ${state.showing.total} entries (was ${p.total}).`);
    }
    store.setListMeta({ pageSize: p.pageSize, total: state.showing.total, totalPages });

    let target = p.lastPage + 1;
    if (target > totalPages) {
      store.completeList();
      return;
    }
    if (pageOf(state.showing, p.pageSize) !== target) {
      log(`  Resuming the list at page ${target} of ${totalPages}.`);
      state = await goToListPage(session.page, session.origin, target, p.pageSize, state, log);
    }

    for (;;) {
      const current = pageOf(state.showing, p.pageSize);
      const items = await readListItems(session.page, state.showing);
      const expected = state.showing.to - state.showing.from + 1;
      if (items.length !== expected || items.some((i) => !i.archiveId)) {
        throw new Error(`Page ${current} showed ${items.length} readable entries, expected ${expected}.`);
      }
      store.addListPage(items, current);
      stats.listPages += 1;
      const now = Date.now();
      pageTimes.push(now);
      if (pageTimes.length > 11) pageTimes.shift();
      const perPage = pageTimes.length > 1 ? (now - pageTimes[0]) / (pageTimes.length - 1) : null;
      const eta = perPage ? ` - ${Math.round(perPage / 1000)}s/page, about ${formatDuration(perPage * (totalPages - current))} left` : '';
      log(`[list] page ${current}/${totalPages} - ${store.list.size} certificates saved${eta}`);
      if (stats.listPages % 10 === 0) await session.saveState();

      if (current >= totalPages) {
        store.completeList();
        return;
      }
      if (stopping() || stats.listPages >= opts.maxPages) return;
      const t0 = Date.now();
      await pause();
      if (!state.pager.next) throw new Error(`No "Next" link on page ${current}.`);
      const t1 = Date.now();
      await clickPostBack(session.page, state.pager.next.target);
      const t2 = Date.now();
      state = await waitForList(session.page, session.origin, state.showing.from, `page ${current + 1}`);
      lastStepMs = Date.now() - t1;
      debug(`page ${current + 1}: pause ${t1 - t0}ms, click ${t2 - t1}ms, postback ${Date.now() - t2}ms`);
      if (pageOf(state.showing, p.pageSize) !== current + 1) {
        state = await goToListPage(session.page, session.origin, current + 1, p.pageSize, state, log);
      }
    }
  }

  const failedThisRun = new Set();
  async function scrapeDetails() {
    const pending = store.pendingDetailIds().filter((id) => !failedThisRun.has(id));
    const total = store.list.size;
    if (!pending.length) return;
    if (stats.details === 0) log(`[details] ${pending.length} detail pages to read (${store.details.size}/${total} already done).`);
    const started = Date.now();
    let doneThisPass = 0;
    for (const id of pending) {
      if (stopping() || stats.details >= opts.maxDetails) return;
      for (let attempt = 1; ; attempt++) {
        try {
          const t0 = Date.now();
          const detail = await scrapeDetail(session.page, session.origin, id);
          lastStepMs = Date.now() - t0;
          debug(`${detail.code ?? id}: ${lastStepMs}ms`);
          store.addDetail(detail);
          stats.details += 1;
          doneThisPass += 1;
          break;
        } catch (err) {
          if (err instanceof SessionExpiredError || isNetworkError(err)) throw err;
          const code = store.list.get(id)?.code ?? id;
          if (attempt >= opts.retries) {
            store.addFailure(id, err.message);
            failedThisRun.add(id);
            stats.failures += 1;
            log(`! [details] gave up on ${code} after ${attempt} tries: ${String(err.message).split('\n')[0]}`);
            break;
          }
          log(`! [details] ${code} try ${attempt} failed (${String(err.message).split('\n')[0]}), retrying`);
          await sleep(2000 * attempt);
          // checkSignedIn throws NetworkError when offline, which the outer loop waits out.
          if (!(await session.checkSignedIn())) throw new SessionExpiredError(`detail ${id}`);
        }
      }
      const done = store.details.size;
      if (doneThisPass % 10 === 0 || done === total) {
        const perItem = (Date.now() - started) / doneThisPass;
        const left = total - done - store.failures.size;
        log(`[details] ${done}/${total} (${((done / total) * 100).toFixed(1)}%) - ${(perItem / 1000).toFixed(1)}s each - about ${formatDuration(perItem * left)} left`);
      }
      if (doneThisPass % 25 === 0) await session.saveState();
      await pause();
    }
  }

  const result = { stats, session: null, summary: null, out: path.resolve(opts.out) };
  try {
    if (opts.check) {
      const ok = await session.checkSignedIn();
      log(ok ? 'Saved session works: the certification dashboard opens.' : 'Not signed in: the saved session is missing or has expired. Run with --login.');
      result.session = ok ? 'signed-in' : 'signed-out';
      return result;
    }

    result.session = await session.ensureSignedIn();
    if (result.session === 'reused') log('Reusing the saved session.');
    if (opts.loginOnly) return result;

    if (opts.relist) {
      log('Walking the list again from page 1 (--relist).');
      store.restartList();
    }
    if ((opts.phase === 'all' || opts.phase === 'list') && !store.progress.list.complete) {
      await resilient('list', scrapeList);
    }
    const listDone = store.progress.list.complete;
    if ((opts.phase === 'all' && listDone) || opts.phase === 'details') {
      await resilient('details', scrapeDetails);
    } else if (opts.phase === 'all' && !listDone && !stopping()) {
      log('List not finished yet (stopped early), so detail pages wait for the next run.');
    }
    await session.saveState();
  } finally {
    if (store.list) {
      result.summary = store.writeArchive();
    }
    await session.close();
  }
  result.stats.reentries = stats.reentries;
  result.logins = session.logins;
  return result;
}
