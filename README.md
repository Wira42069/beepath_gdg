# BeePath MVP (v0.1)

A web app where a student picks a target tech role, follows a skill path, and sees a short, ranked list of certificates at each skill. Built for STACK 2026, Case 1.

**Status:** one role fully built (Frontend, 12 skills). Four other roles show as "Coming soon". Runs on **sample data**, which is clearly labelled in the UI.

## Run it

```bash
npm start          # http://localhost:5173  (no install needed, no dependencies)
npm test           # data validation + unit tests
npm run e2e        # browser smoke test (needs Playwright + Chrome)
```

Deploy: it is a static site, so Vercel (or any static host) serves the repo root as-is. There is no build step.

## What is real and what is a placeholder

| Piece | State |
| --- | --- |
| Role picker, skill path, node detail, progress, filters, ratings, ranking | Working |
| Skill tree for Frontend | **Draft written by Claude. The team must review, correct and own it** before the originality declaration. Skill names and order are generic and not copied from any roadmap site. |
| Free resource links (MDN, web.dev, javascript.info, react.dev, etc.) | Written from memory, **not link-checked**. Click each one once before recording. |
| Certificates | **Sample data**: 46 self-authored entries with fictional providers. Prices and durations are illustrative. 8 are deliberately unrelated, to mirror an uncurated archive. |
| Ratings | Stored in the browser only. `data/seed_ratings.json` is empty: add only ratings that real test users gave. |
| Backend (Turso), LLM tagging, accounts | Not built. Describe as planned. |

## Swapping in the real archive data

The app never reads Binus data unless you tell it to. Sample and real data live in separate folders and share the same format.

1. Get a raw export (JSON or CSV) of certificate rows. Only do this if you have permission or are comfortable with the risk. Keep the file in `raw/` (git-ignored).
2. Convert it:
   ```bash
   python3 scripts/import_scraped.py raw/archive.json --out data/binus --field-map scripts/field_map.example.json
   ```
   Edit `field_map.example.json` so the right-hand names match your export's column names.
3. Review `data/binus/review.csv` (lowest confidence first). The mapping is only a keyword guess. Refine it with your offline LLM tagging, then hand-check a sample.
4. `npm run validate` and fix any errors.
5. Try it: open `http://localhost:5173/?dataset=binus`. To make it the default, set `CERT_DATASET: 'binus'` in `js/config.js`.

What the importer does for you: keeps only certificate fields (names, IDs and any other personal data are dropped), skips rows that look like they contain an email or ID number, removes duplicates, creates stable ids so ratings stay attached, and makes sure only http(s) links survive. The UI banner switches from "Sample data" to the dataset label automatically.

**Before you demo or record with real data:** keep `data/binus/` and the raw file out of git, and describe the data source honestly in the proposal.

## Data format (data/)

- `roles.json`: roles and their ordered skills (team-written). Shared by all datasets.
- `<dataset>/certificates.json`: `id, title, issuer, category, providerType, url, price{amount,currency}, hours, level, source, sample`
- `<dataset>/mappings.json`: `certificateId, skillId, relevance (0 to 1), method (manual | keyword | llm)`. The fixed mapping is separate from ratings.
- `<dataset>/meta.json`: what the dataset is. Drives the banner and badges.
- `seed_ratings.json`: `certificateId, skillId, stars (1-5), relevant (true/false)`

## How ranking works (js/ranking.js)

Score = 0.7 × relevance + 0.3 × stars. Relevance starts at the team's mapping value and moves toward the share of raters who said "relevant" as ratings come in. Stars are averaged with a prior, so one 5-star rating cannot outrank ten solid ones. With no ratings, order follows the mapping alone. Weights live in `js/config.js`.

## Collecting evidence from your 5-8 person test

Each tester can use **Export my ratings (JSON)** in the footer. Combine real exports into `data/seed_ratings.json` if you want them to affect the ranking in the demo, and say so in the proposal.

## Porting to Next.js later

Nothing here blocks it. `ranking.js`, `store.js` and the data files move over unchanged. Replace the `fetch` calls in `data.js` with database queries, and the render functions in `app.js` with components.


## Added after the first MVP (for the demo video)

Routes: `#/archive` (whole archive) and `#/me` (My progress), linked from the top bar.

- **Mark as completed** on every certificate card (role panel and archive). Stored in the browser only.
- **Add to LinkedIn** opens LinkedIn's prefilled "add certification" form (name, issuer, month, link). The student confirms on LinkedIn; BeePath never touches their account. Test this link once with a real LinkedIn login before filming.
- **My progress**
  - Skill profile: skills done / in progress / not covered, each done skill labelled "certificate completed" or "self-reported". No scores.
  - Certificate tracker: completion month, a self-reported "submitted to Binus" tick, provider link, copy details, remove. BeePath cannot see the campus system.
  - CV draft: plain text (certifications newest first, skills per role), editable, copy or download .txt.
- **Archive page**: search, filter by skill (ranks by fit), category, free only, max hours. Shows `description` when the dataset has one (the importer already supports it).

Not built yet: shared ratings across users (needs a backend), roles other than Frontend, interview prep checklist, real archive data.
Tests: `npm test` (unit + data), `CHROME_PATH=... npm run e2e` (browser flow, including the new pages).
