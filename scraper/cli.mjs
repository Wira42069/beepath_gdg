#!/usr/bin/env node
// Command line entry for the certificate archive scraper. See scraper/README.md.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { runScraper, RUN_DEFAULTS } from './run.mjs';
import { LoginAbortedError } from './lib/site.mjs';

const HELP = `Scrape the Binus student certification archive with your own student login.

Usage:
  npm run scrape                     sign in if needed, then scrape everything (resumes automatically)
  npm run scrape -- --login          only sign in and save the session
  npm run scrape -- --check          only check whether the saved session still works
  npm run scrape -- [options]

Options:
  --phase <all|list|details>   what to scrape (default: all = list pages, then each detail page)
  --out <dir>                  output folder (default: ${RUN_DEFAULTS.out})
  --auth-dir <dir>             browser profile + saved session (default: ${RUN_DEFAULTS.authDir}). Keep it private.
  --relist                     walk the list again from page 1 to pick up new or changed entries
  --headed                     show the browser while scraping (default: hidden after sign-in)
  --browser <name>             chrome | msedge | chromium (default: ${RUN_DEFAULTS.browser})
  --delay <ms>                 pause between page loads, plus up to 50% jitter (default: ${RUN_DEFAULTS.delayMs})
  --max-pages <n>              stop after n list pages this run (try it out first)
  --max-details <n>            stop after n detail pages this run
  --retries <n>                tries per page before moving on (default: ${RUN_DEFAULTS.retries})
  --login-timeout <minutes>    how long to wait for you to sign in (default: ${RUN_DEFAULTS.loginTimeoutMs / 60000})
  -h, --help                   show this help

Testing only:
  --origin <url>               certification app origin (default: ${RUN_DEFAULTS.origin})
  --login-url <url>            where sign-in starts (default: ${RUN_DEFAULTS.loginUrl})
  --debug                      print step timings

Ctrl+C stops after the current page and keeps everything saved so far.`;

function fail(message) {
  console.error(`Error: ${message}\nRun with --help for usage.`);
  process.exit(1);
}

function positiveInt(name, value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a whole number (got "${value}")`);
  return n;
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      phase: { type: 'string' },
      out: { type: 'string' },
      'auth-dir': { type: 'string' },
      relist: { type: 'boolean' },
      headed: { type: 'boolean' },
      browser: { type: 'string' },
      delay: { type: 'string' },
      'max-pages': { type: 'string' },
      'max-details': { type: 'string' },
      retries: { type: 'string' },
      'login-timeout': { type: 'string' },
      login: { type: 'boolean' },
      check: { type: 'boolean' },
      origin: { type: 'string' },
      'login-url': { type: 'string' },
      debug: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  }));
} catch (err) {
  fail(err.message);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (args.phase && !['all', 'list', 'details'].includes(args.phase)) fail('--phase must be all, list or details');
if (args.browser && !['chrome', 'msedge', 'chromium'].includes(args.browser)) fail('--browser must be chrome, msedge or chromium');
if (args.login && args.check) fail('use either --login or --check, not both');

const controller = new AbortController();
let interrupts = 0;
process.on('SIGINT', () => {
  interrupts += 1;
  if (interrupts > 1) {
    console.log('\nStopping now.');
    process.exit(130);
  }
  console.log('\nStopping after the current page (Ctrl+C again to quit immediately)...');
  controller.abort();
});

const options = {
  phase: args.phase,
  out: args.out,
  authDir: args['auth-dir'],
  relist: args.relist,
  headed: args.headed,
  browser: args.browser,
  delayMs: positiveInt('delay', args.delay),
  maxPages: positiveInt('max-pages', args['max-pages']) || undefined,
  maxDetails: positiveInt('max-details', args['max-details']) || undefined,
  retries: positiveInt('retries', args.retries),
  loginTimeoutMs: args['login-timeout'] ? positiveInt('login-timeout', args['login-timeout']) * 60_000 : undefined,
  loginOnly: args.login,
  check: args.check,
  origin: args.origin,
  loginUrl: args['login-url'],
  debug: args.debug,
  signal: controller.signal,
};
for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];

try {
  const result = await runScraper(options);
  if (args.check) process.exit(result.session === 'signed-in' ? 0 : 3);
  if (args.login) {
    console.log('Signed in and saved. Run `npm run scrape` to start scraping.');
    process.exit(0);
  }
  const s = result.summary;
  const rel = path.relative(process.cwd(), result.out) || '.';
  console.log('');
  console.log(`Done for now. ${s.certificates} certificates in ${rel}/archive.json`);
  console.log(`  list pages: ${s.listPagesDone}/${s.listPagesTotal ?? '?'}${s.listComplete ? ' (complete)' : ''}`);
  console.log(`  detail pages: ${s.withDetails}/${s.certificates}${s.detailFailures ? `, ${s.detailFailures} failed (retried next run)` : ''}`);
  if (s.listComplete && s.missingFromList) console.log(`  ${s.missingFromList} entries the site reports were not seen. If the list is complete, run again with --relist.`);
  if (result.stats.reentries) console.log(`  re-entered the site ${result.stats.reentries} time(s) after the session expired`);
  const finished = s.listComplete && s.withDetails + s.detailFailures >= s.certificates;
  if (!finished) {
    console.log('Run the same command again to continue where it stopped.');
  } else {
    console.log('');
    console.log('Next: turn it into a BeePath dataset');
    console.log(`  python scripts/import_scraped.py ${rel}/archive.json --out data/binus --field-map scripts/field_map.binus.json`);
  }
  process.exit(controller.signal.aborted ? 130 : 0);
} catch (err) {
  if (err instanceof LoginAbortedError) {
    console.error(`\nSign-in did not finish: ${err.message}`);
    console.error('Everything scraped so far is saved. Run the command again to continue.');
    process.exit(2);
  }
  console.error(`\nScrape stopped: ${err.stack || err.message}`);
  console.error('Everything scraped so far is saved. Run the command again to continue.');
  process.exit(1);
}
