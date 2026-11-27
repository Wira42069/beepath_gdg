#!/usr/bin/env node
// Offline, one-time LLM tagging of the imported archive with Gemini (structured JSON output).
// For each certificate it picks one category from data/categories.json, decides whether it is
// relevant to a tech career at all, and maps it to up to 3 skills from data/roles.json.
// Students never trigger this; the results are reviewed and stored as fixed data.
//
//   npm run tag -- --dataset binus --dry-run       # print the prompt, call nothing (free)
//   npm run tag -- --dataset binus --limit 40      # tag 40 certificates to judge the quality first
//   npm run tag -- --dataset binus                 # tag the rest (resumes; cached ones are skipped)
//   npm run tag -- --dataset binus --apply-only    # re-apply cached tags after re-running the importer
//
// Needs GEMINI_API_KEY (in the environment or a git-ignored .env file; get one at aistudio.google.com).
// Writes, in data/<dataset>/: certificates.json (category, careerRelevant, level), mappings.json
// (method "llm"; "manual" rows are never touched), meta.json, llm-tags.jsonl (cache) and
// llm-review.csv (the sample to hand-check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as T from './tagging/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const { values: args } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'binus' },
    model: { type: 'string', default: process.env.GEMINI_MODEL || 'gemini-3.8-flash' },
    batch: { type: 'string', default: '20' },
    limit: { type: 'string' },
    rpm: { type: 'string', default: '10' },
    retag: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'apply-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const dir = path.join(root, 'data', args.dataset);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n', 'utf8');
if (!fs.existsSync(path.join(dir, 'certificates.json'))) {
  console.error(`No ${path.relative(root, dir)}/certificates.json. Run the importer first (see README).`);
  process.exit(1);
}

const certs = readJson(path.join(dir, 'certificates.json'));
const mappings = readJson(path.join(dir, 'mappings.json'));
const meta = readJson(path.join(dir, 'meta.json'));
const roles = readJson(path.join(root, 'data', 'roles.json'));
const categories = readJson(path.join(root, 'data', 'categories.json'));
const skills = T.allowedSkills(roles);
const skillIds = skills.map((s) => s.id);
const cachePath = path.join(dir, 'llm-tags.jsonl');

const cache = new Map();
if (fs.existsSync(cachePath)) {
  for (const line of fs.readFileSync(cachePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); cache.set(e.id, e); } catch { /* half-written last line */ }
  }
}
const hashOf = new Map(certs.map((c) => [c.id, T.inputHash(c, skillIds, categories)]));
const fresh = (c) => cache.get(c.id)?.hash === hashOf.get(c.id);

let todo = args['apply-only'] ? [] : certs.filter((c) => args.retag || !fresh(c));
if (args.limit) todo = todo.slice(0, Number(args.limit));
const batches = T.chunk(todo, Math.max(1, Number(args.batch)));

if (args['dry-run']) {
  console.log('=== system prompt ===\n' + T.systemPrompt(skills, categories));
  console.log('\n=== first batch ===\n' + (batches[0] ? T.userPrompt(batches[0]) : '(nothing to tag)'));
  console.log(`\n${todo.length} certificates to tag in ${batches.length} requests with ${args.model}. ${certs.length - todo.length} already cached.`);
  process.exit(0);
}

async function tagAll() {
  if (!todo.length) return;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set. Put it in .env (GEMINI_API_KEY=...) or the environment.');
    process.exit(1);
  }
  const { GoogleGenAI } = await import('@google/genai');
  // GEMINI_BASE_URL is only for tests (a local fake API); normally the SDK's default endpoint is used.
  const ai = new GoogleGenAI({ apiKey, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  const system = T.systemPrompt(skills, categories);
  const schema = T.responseSchema(skillIds, categories);
  const gap = 60_000 / Math.max(1, Number(args.rpm));
  let last = 0;

  async function ask(batch) {
    for (let attempt = 1; ; attempt++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        const res = await ai.models.generateContent({
          model: args.model,
          contents: T.userPrompt(batch),
          config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0 },
        });
        return JSON.parse(res.text ?? '{}');
      } catch (err) {
        const status = err?.status ?? err?.code;
        const retryable = status === 429 || (typeof status === 'number' && status >= 500) || err instanceof SyntaxError || /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND/i.test(String(err?.message));
        if (!retryable || attempt >= 6) throw err;
        const backoff = Math.min(120_000, 5000 * 2 ** (attempt - 1));
        console.log(`  ! ${status ?? err.name}: ${String(err.message).split('\n')[0].slice(0, 120)}. Retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  const out = fs.createWriteStream(cachePath, { flags: 'a' });
  let done = 0, failed = 0;
  const started = Date.now();
  for (const [i, batch] of batches.entries()) {
    let pending = batch;
    for (let round = 0; round < 2 && pending.length; round++) {
      const { tags, missing, problems } = T.validateResults(await ask(pending), pending, skillIds, categories);
      for (const [id, tag] of tags) {
        out.write(JSON.stringify({ id, hash: hashOf.get(id), model: args.model, promptVersion: T.PROMPT_VERSION, taggedAt: new Date().toISOString(), ...tag }) + '\n');
        cache.set(id, { id, hash: hashOf.get(id), ...tag });
        done += 1;
      }
      if (problems.length) console.log(`  ! ${problems.length} invalid answers: ${problems.slice(0, 3).join('; ')}`);
      pending = pending.filter((c) => missing.includes(c.id));
    }
    failed += pending.length;
    const perBatch = (Date.now() - started) / (i + 1);
    console.log(`[tag] ${done}/${todo.length} tagged${failed ? `, ${failed} skipped (re-run to retry)` : ''} - about ${Math.round((perBatch * (batches.length - i - 1)) / 60000)} min left`);
  }
  await new Promise((r) => out.end(r));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

await tagAll();

const tagsById = new Map(certs.filter(fresh).map((c) => [c.id, cache.get(c.id)]));
const { certs: outCerts, mappings: outMaps } = T.applyTags(certs, mappings, tagsById);
writeJson(path.join(dir, 'certificates.json'), outCerts);
writeJson(path.join(dir, 'mappings.json'), outMaps);

const relevant = [...tagsById.values()].filter((t) => t.careerRelevant).length;
const mapped = new Set(outMaps.map((m) => m.certificateId)).size;
meta.notice = `Categories, relevance and skill mappings were suggested by ${args.model} (offline, prompt v${T.PROMPT_VERSION}) and must be spot-checked by the team (llm-review.csv) before being presented as curated.`;
meta.tagging = { model: args.model, promptVersion: T.PROMPT_VERSION, tagged: tagsById.size, careerRelevant: relevant, at: new Date().toISOString() };
meta.counts = { ...(meta.counts ?? {}), certificates: outCerts.length, mapped, mappings: outMaps.length };
writeJson(path.join(dir, 'meta.json'), meta);

// Human spot-check: a fixed random sample of everything tagged, plus every borderline mapping.
const byId = new Map(outCerts.map((c) => [c.id, c]));
const sample = new Set(T.reviewSample([...tagsById.keys()]));
const borderline = [...tagsById].filter(([, t]) => t.careerRelevant && t.skills.some((s) => s.relevance < 0.7)).map(([id]) => id);
const rows = [...new Set([...sample, ...borderline])].map((id) => {
  const c = byId.get(id), t = tagsById.get(id);
  return [sample.has(id) ? 'random sample' : 'borderline', id, c.code ?? '', c.title, c.issuer ?? '', t.careerRelevant, t.category,
    t.skills.map((s) => `${s.skillId}:${s.relevance}`).join(' '), t.reason, '', ''];
});
const header = ['why', 'certificateId', 'code', 'title', 'issuer', 'careerRelevant', 'category', 'skills', 'reason', 'verdict (ok / wrong)', 'notes'];
fs.writeFileSync(path.join(dir, 'llm-review.csv'), [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'utf8');

console.log(`\nTagged ${tagsById.size}/${certs.length} certificates (${relevant} career-relevant), ${mapped} mapped to skills (${outMaps.length} mappings).`);
if (tagsById.size < certs.length) console.log(`${certs.length - tagsById.size} not tagged yet: run the same command again.`);
console.log(`Review ${path.relative(root, path.join(dir, 'llm-review.csv'))} (${rows.length} rows). Fix a wrong mapping in mappings.json and set its method to "manual" so re-tagging keeps it.`);
console.log(`Then: npm run validate && npm run db:seed -- --dataset ${args.dataset}`);
