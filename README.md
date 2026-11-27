# BeePath

A career compass for Binus students. Pick a target tech role, follow a Duolingo-style skill path, and at each skill see free learning resources plus a short, ranked list of certificates from the campus-approved archive (3,500+ entries, most of them unrelated to any given career). Students rate certificates they completed, and those anonymous ratings re-rank them for everyone. Built for STACK 2026, Case 1 (Smarter Campus and Learning).

Stack: Next.js 16 (App Router, React, TypeScript) on Vercel, Turso (libSQL) for certificates, mappings and ratings, Gemini for the one-time offline tagging, and Playwright for the archive scraper.

## Status

| Piece | State |
| --- | --- |
| Five roles: Frontend, Backend, Data Analyst, UI/UX, Cybersecurity | Working. **Frontend was drafted earlier; the other four are drafts written by Claude** (`"draft": true` in `data/roles.json`, and `npm run validate` warns about them). The team must review, correct and own every skill tree before the originality declaration. |
| Skill path, panel, progress, filters, archive, My progress, CV draft, LinkedIn link | Working, ported from the static prototype. |
| Shared ratings | Working: anonymous, stored in the database, and they change the ranking for every student (`POST /api/ratings`). |
| Free resource links | All 78 checked on 2026-11-28 (`npm run links`). 5 sites refuse scripts, so open those once by hand. |
| Archive scraper | Working against the live site, including sign-in, session reuse, re-entry after expiry, resume and network outages. See [scraper/README.md](scraper/README.md). |
| Real archive data | Scraped into `raw/` (git-ignored). Not in the repo. |
| Gemini tagging | Built and tested against a fake Gemini API. **Not yet run against the real API.** Start with `--limit 40` and check the quality. |
| Turso | The code and schema are the same as local libSQL and tested locally. **A remote Turso database has not been tried yet.** |
| Sample data | 89 self-authored entries with fictional providers, clearly labelled in the UI. Prices and durations are illustrative. |

## Run it

```bash
npm install
npm run dev            # http://localhost:3000, seeds the sample data into .data/beepath.db on first run
```

No accounts or keys are needed for local development: the database is a SQLite file in `.data/` (git-ignored).

```bash
npm test               # data validation, unit + database tests, scraper unit tests, tagging CLI test
npm run test:scraper   # scraper end to end against a local mock of the Binus site (about 2 min)
npm run e2e            # browser test of the whole student flow (builds first if needed)
npm run typecheck
npm run links          # check every learning-resource link
```

## From the Binus archive to the app

The abstract's pipeline, one command per step. Every step is re-runnable and keeps earlier work.

```bash
# 1. Scrape the archive with your own student login (about 30 min for the list, about 3 h for detail pages)
npm run scrape                       # a Chrome window opens: sign in to BinusMaya, open Certification
                                     #   -> raw/binus-archive/archive.json

# 2. Normalise it into a BeePath dataset (drops anything personal, keyword baseline mapping)
npm run import -- raw/binus-archive/archive.json --out data/binus --field-map scripts/field_map.binus.json

# 3. Tag it once with Gemini: category, "is this relevant to a tech career at all", skill mapping
cp .env.example .env                 # add GEMINI_API_KEY
npm run tag -- --dataset binus --dry-run    # see the exact prompt, costs nothing
npm run tag -- --dataset binus --limit 40   # judge quality on 40 first
npm run tag -- --dataset binus              # the rest (cached, resumable)

# 4. Hand-check: data/binus/llm-review.csv (random 10% + every borderline mapping).
#    Fix a wrong mapping in data/binus/mappings.json and set "method": "manual"; re-tagging never overrides it.

# 5. Validate, load into the database, and serve it
npm run validate
npm run db:seed -- --dataset binus
BEEPATH_DATASET=binus npm run dev    # PowerShell: $env:BEEPATH_DATASET='binus'; npm run dev
```

What each step guarantees:
- **Scraper** ([scraper/README.md](scraper/README.md)): read-only, one page at a time. It never stores your password, name or student ID, and never touches the upload form.
- **Importer** (`scripts/import_scraped.py`):
  - keeps only certificate fields and blanks out anything that looks like an email or ID number
  - removes duplicates (the archive lists some certificates twice under two codes)
  - gives stable ids, so ratings and manual fixes survive a re-import
  - parses Indonesian durations ("36 Jam" → 36 h; "2 Hari" and "1 Bulan" stay as text)
- **Tagger** (`scripts/tag-gemini.mjs`):
  - runs offline and once; students never trigger it
  - the response schema pins the model to the fixed lists in `data/categories.json` and `data/roles.json`
  - answers are validated, and anything invalid is retried
  - it marks unrelated entries `careerRelevant: false` (hidden from paths and, by default, from the archive)
  - hand-made `manual` mappings always win

Keep `data/binus/`, `raw/` and `.auth/` out of git (already ignored), and describe the data source honestly in the proposal.

## Deploy (Vercel + Turso)

1. Create a database: `turso db create beepath`, then `turso db show beepath --url` and `turso db tokens create beepath`.
2. Seed it from your machine with those two values in `.env` (or the environment): `npm run db:seed -- --dataset sample` (and/or `binus`).
3. Import the repo into Vercel. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and optionally `BEEPATH_DATASET=binus` in the project's environment variables. The build command is the default `next build`.

Without `TURSO_DATABASE_URL`, the app refuses to start on Vercel instead of silently writing to a temporary disk. Re-seeding replaces certificates and mappings but keeps students' ratings.

## How it fits together

```
app/                    Next.js pages: / (roles), /role/[id]?skill=..., /archive, /me, /api/ratings, /api/certificates
components/             RolePath (path + skill panel + rating), ArchiveFilters, MyProgress, shared certificate parts
lib/                    ranking.ts, cv.ts (pure, unit tested), repo.ts (all SQL), schema.mjs + seed.mjs (shared with scripts),
                        store.ts (browser: progress, completed certificates, this device's ratings)
data/                   roles.json + categories.json (team-owned fixed lists), sample/ (placeholder dataset), seed_ratings.json
scraper/                the archive scraper (Playwright)
scripts/                import_scraped.py, tag-gemini.mjs, db-seed.mjs, validate_data.py, check_links.mjs, draft_roles.py
tests/                  app/ (Vitest), e2e.mjs (Playwright), scraper + tagging (node:test)
```

- **In the database** (`lib/schema.mjs`): certificates, mappings, ratings. Several datasets can sit side by side.
- **In the browser** (no login): progress, completed certificates and the CV draft.
- **Ratings:** stored in both places. A random per-browser id lets a student change their own rating without counting twice. It is never linked to a person.

### Data format (`data/<dataset>/`)

- `certificates.json`: `id, title, code, issuer, institution, category, description, outcomes, creditEarning, providerType, url, price{amount,currency}, hours, durationText, level, careerRelevant, source, sample`. Fields a dataset doesn't have are null or absent. The real archive has no prices, provider links or categories, so the UI hides those filters.
- `mappings.json`: `certificateId, skillId, relevance (0-1), method (manual | keyword | llm)`.
- `meta.json`: what the dataset is. It drives the banner and the "Sample data" pill.
- `../seed_ratings.json`: only ratings real testers gave (`certificateId, skillId, stars 1-5, relevant`).

### How ranking works (`lib/ranking.ts`)

Score = 0.7 × relevance + 0.3 × stars.
- **Relevance** starts at the mapping value and moves toward the share of raters who said "relevant".
- **Stars** are averaged with a prior, so one 5-star rating can't outrank ten solid ones.
- **No ratings:** the order follows the mapping alone.

The weights live in `lib/config.ts`.

## Collecting evidence from your user test

Ratings now land in the database. Query them with `turso db shell beepath "SELECT * FROM ratings"`, or open `.data/beepath.db` locally. Each tester can also still use **Export my ratings (JSON)** in the footer.

## Known limitations

- The four new skill trees and their keywords are drafts. Frontend's resources were link-checked, but its tree still needs the same team review.
- `POST /api/ratings` has input validation and a same-origin check but no rate limit, so anyone determined could spam ratings with fresh browser ids. That's fine for a prototype trial; add a rate limit (for example Vercel's firewall) before a wide launch.
- The archive's "Category" search is broken on the Binus site itself, so categories come only from the Gemini pass.
- Not built: accounts, syncing progress across devices, the interview-prep checklist.
