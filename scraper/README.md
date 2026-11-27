# Certificate archive scraper

Reads the Binus student certification archive (`studentcertification.apps.binus.ac.id`, about 3,500 entries) with **your own student login**, once, for the BeePath prototype. Output goes to `raw/binus-archive/`, which git ignores.

```bash
npm install                 # once: installs Playwright (uses your installed Chrome)
npm run scrape              # sign in if needed, then scrape everything; re-run to resume
```

The first run opens a Chrome window. Sign in to BinusMaya yourself (password and MFA), then open the Certification app from BinusMaya the way you normally do. The scraper notices the dashboard, saves the session, hides the browser and starts. It never sees or stores your password.

## How long, and what it does to the site

| Step | Pages | Time |
| --- | --- | --- |
| List (`--phase list`) | ~354 list pages, 10 entries each | ~25-30 min |
| Details (`--phase details`) | one per certificate, ~3,500 | ~3 h |

It loads one page at a time with a ~1 s pause plus jitter (`--delay`). After a slow response it waits about half as long as that response took (up to 30 s), so a busy server gets fewer requests. It skips images and fonts, and is read-only: it only clicks the pager and opens detail pages. It never clicks "Upload Certificate" or submits a form.

Try a small run first:

```bash
npm run scrape -- --phase list --max-pages 2 --out raw/trial
npm run scrape -- --phase details --max-details 5 --out raw/trial
```

## Sign-in, re-entry and resuming

- **Saved session.** `.auth/session.json` holds the certification session cookie, and `.auth/browser-profile-chrome/` holds a browser profile, so BinusMaya usually remembers you. The next run reuses both (`Reusing the saved session.`). `.auth/` is git-ignored. **Never commit or share it: it is a logged-in session for your account.**
- **When the certification session expires** (mid-run or between runs), the site bounces to `/UnAuthorize`. The scraper notices, opens a Chrome window at BinusMaya and beeps. Usually you are still signed in there, so you only click into Certification again, and the scrape continues where it stopped. It waits up to `--login-timeout` minutes (default 10).
- **Why it can't re-enter by itself.** The certification app only accepts a one-time token that BinusMaya creates when you open it from its menu.
- **Resuming.** Each record is written to disk the moment it is read. Ctrl+C (once) stops after the current page. A crash, a closed laptop or a failed sign-in loses at most one page. Run the same command again and it continues. Detail pages that keep failing are listed in `failures.jsonl` and retried on the next run.
- `npm run scrape -- --check` tells you whether the saved session still works, without scraping. `npm run scrape -- --login` only signs in.
- `npm run scrape -- --relist` walks the list again from page 1 to pick up entries added since. It only fetches details for new ones.
- **Network drops or the PC sleeps:** the scraper notices that the site can't be reached, as opposed to you being signed out, waits up to an hour for the network to come back, and continues. It doesn't open a sign-in window or count those pages as failures. A sleeping PC still pauses the scrape, so keep it awake for the long run.
- **Slow server:** the archive's list page has been seen taking around 30 s per page at some hours and around 5 s at others. Run with `--debug` to see per-page timings.

## Output (`raw/binus-archive/`)

| File | What |
| --- | --- |
| `archive.json` | The result: one object per certificate, in archive order. Rewritten at the end of every run. |
| `summary.json` | Counts: site total, scraped, with details, failures, still truncated. |
| `list.jsonl`, `details.jsonl`, `failures.jsonl`, `progress.json` | Checkpoints. Delete the folder to start over. |

An `archive.json` record:

```json
{
  "archiveId": "63eefe03-…",           // the archive's own id (from the detail link)
  "code": "CERT006132",                // what students search for in the Binus app
  "title": "Introduction to Software Testing",
  "creditEarning": "Non Credit Earning Only",
  "description": "…full text from the detail page…",
  "descriptionTruncated": false,       // true = only the list's cut-off text ("… ...") was captured
  "learningOutcomes": "…",             // "Not Defined" on the site becomes null
  "administrator": "TestGrid University",  // who runs the programme (Coursera, Dicoding, …)
  "institution": "TestGrid",              // whose credential it is (AWS, Google, …)
  "duration": "1 Hours",               // free text as on the site: "36 Jam", "2 Hari", "90-110 hours"
  "creditOptions": [{ "mapId": "noncredit", "info": "Submit your certification as a Non Credit Earning…" }],
  "archivePosition": 0,
  "detailScraped": true
}
```

Only certificate fields are kept. The page header (your name and student ID) and the thumbnail links (signed URLs that expire within an hour) are never stored. The archive has **no price, provider URL or category**. Its "Category" search option is broken on the site itself.

## Next step

```bash
npm run import -- raw/binus-archive/archive.json --out data/binus --field-map scripts/field_map.binus.json
npm run tag -- --dataset binus --limit 40
```

Then follow the main README ("From the Binus archive to the app").

## Options

Run `npm run scrape -- --help` for the full list. The most useful ones are `--headed` (watch it work), `--browser msedge|chromium` (if Chrome isn't installed) and `--delay <ms>`.

## Tests

```bash
node --test tests/scraper-unit.test.mjs   # parsing, pager logic, checkpoint store (also part of npm test)
npm run test:scraper                      # full runs against a local mock of the site (needs Playwright's Chromium)
```

The mock (`tests/scraper/mock-site.mjs`) copies the real site's markup, postback paging, token handoff and session expiry. It is a fake, so it can't catch the real site changing. If a real run suddenly reads 0 entries or times out on every page, compare the selectors in `scraper/lib/archive.mjs` with the live page.
