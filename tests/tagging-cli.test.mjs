// Runs scripts/tag-gemini.mjs end to end against a local fake of the Gemini API, so the request
// the real SDK sends, response parsing, the cache, retries and the output files are all exercised
// without an API key.   node --test tests/tagging-cli.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

function fakeGemini({ failFirst = false } = {}) {
  const requests = [];
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls += 1;
      const json = JSON.parse(body);
      requests.push({ url: req.url, json });
      if (failFirst && calls === 1) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }));
        return;
      }
      const prompt = json.contents[0].parts[0].text;
      const items = JSON.parse(prompt.slice(prompt.indexOf('[')));
      const results = items
        .filter((_, i) => !(calls === (failFirst ? 2 : 1) && i === 1)) // drop one answer to exercise the retry of missing ids
        .map((c) => (/sql/i.test(c.title)
          ? { id: c.id, category: 'Databases', careerRelevant: true, level: 'Beginner', skills: [{ skillId: 'da-sql', relevance: 0.92 }, { skillId: 'be-sql', relevance: 0.66 }], reason: 'SQL course.' }
          : { id: c.id, category: 'Engineering & Construction', careerRelevant: false, level: 'Unknown', skills: [], reason: 'Not a tech skill.' }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ results }) }] }, finishReason: 'STOP' }] }));
    });
  });
  return { server, requests, get calls() { return calls; } };
}

test('tag-gemini: tags, caches, keeps manual mappings, writes the review sheet', { timeout: 120_000 }, async () => {
  const name = `tagtest-${process.pid}`;
  const dir = path.join(root, 'data', name);
  fs.mkdirSync(dir, { recursive: true });
  const certs = [
    { id: 'b-1', title: 'SQL for Beginners', code: 'CERT000001', issuer: 'Dicoding', category: null, providerType: 'third_party', url: null, price: null, hours: 10, level: null, source: 'binus_archive', sample: false },
    { id: 'b-2', title: 'Teknisi K3 Listrik', code: 'CERT000002', issuer: 'BNSP', category: null, providerType: 'third_party', url: null, price: null, hours: null, durationText: '7 Hari', level: null, source: 'binus_archive', sample: false },
    { id: 'b-3', title: 'Advanced SQL Queries', code: 'CERT000003', issuer: 'X', category: null, providerType: 'third_party', url: null, price: null, hours: null, level: null, source: 'binus_archive', sample: false },
  ];
  fs.writeFileSync(path.join(dir, 'certificates.json'), JSON.stringify(certs));
  fs.writeFileSync(path.join(dir, 'mappings.json'), JSON.stringify([
    { certificateId: 'b-2', skillId: 'fe-css', relevance: 0.5, method: 'keyword' },
    { certificateId: 'b-3', skillId: 'be-sql', relevance: 0.85, method: 'manual' },
  ]));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ dataSource: 'binus_archive', label: 'test' }));

  const fake = fakeGemini({ failFirst: true });
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${fake.server.address().port}` };
  const cli = (...args) => run(process.execPath, [path.join(root, 'scripts', 'tag-gemini.mjs'), '--dataset', name, '--rpm', '6000', ...args], { cwd: root, env });
  try {
    const first = await cli();
    assert.match(first.stdout, /429/, 'a rate-limit error is retried');
    assert.match(first.stdout, /Tagged 3\/3 certificates \(2 career-relevant\)/);

    // What the SDK actually sent
    const req = fake.requests.at(-1);
    assert.match(req.url, /models\/gemini-3\.8-flash:generateContent/);
    const cfg = req.json.generationConfig;
    assert.equal(cfg.responseMimeType, 'application/json');
    assert.ok(cfg.responseJsonSchema.properties.results, 'schema sent as responseJsonSchema');
    assert.equal(cfg.temperature, 0);
    assert.match(JSON.stringify(req.json.systemInstruction), /Allowed skills/);

    const outCerts = JSON.parse(fs.readFileSync(path.join(dir, 'certificates.json'), 'utf8'));
    assert.deepEqual(outCerts.map((c) => [c.id, c.careerRelevant, c.category, c.level]), [
      ['b-1', true, 'Databases', 'Beginner'],
      ['b-2', false, 'Engineering & Construction', null],
      ['b-3', true, 'Databases', 'Beginner'],
    ]);
    const maps = JSON.parse(fs.readFileSync(path.join(dir, 'mappings.json'), 'utf8'));
    assert.deepEqual(maps, [
      { certificateId: 'b-3', skillId: 'be-sql', relevance: 0.85, method: 'manual' },
      { certificateId: 'b-1', skillId: 'da-sql', relevance: 0.92, method: 'llm' },
      { certificateId: 'b-1', skillId: 'be-sql', relevance: 0.66, method: 'llm' },
      { certificateId: 'b-3', skillId: 'da-sql', relevance: 0.92, method: 'llm' },
    ]);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.tagging.tagged, 3);
    const csv = fs.readFileSync(path.join(dir, 'llm-review.csv'), 'utf8');
    assert.match(csv.split('\n')[0], /^why,certificateId,code,title/);
    assert.equal(csv.trim().split('\n').length, 4, 'all 3 rows are in the (small) sample');

    // Second run: everything cached, no API calls.
    const before = fake.calls;
    const second = await cli();
    assert.equal(fake.calls, before);
    assert.match(second.stdout, /Tagged 3\/3/);
  } finally {
    fake.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
