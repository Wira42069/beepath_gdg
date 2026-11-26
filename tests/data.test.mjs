import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const data = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const j = (p) => JSON.parse(fs.readFileSync(path.join(data, p), 'utf8'));

test('every skill of every available role has at least one certificate in the sample dataset', () => {
  const roles = j('roles.json'), maps = j('sample/mappings.json');
  const covered = new Set(maps.map((m) => m.skillId));
  for (const role of roles.filter((r) => r.status === 'available')) {
    for (const s of role.skills) assert.ok(covered.has(s.id), `no certificate for skill ${s.id}`);
  }
});

test('sample dataset is flagged as sample everywhere', () => {
  const meta = j('sample/meta.json'), certs = j('sample/certificates.json');
  assert.equal(meta.dataSource, 'sample');
  assert.ok(certs.every((c) => c.sample === true && c.source === 'sample'));
});

test('seed ratings contain only real, well-formed entries (starts empty)', () => {
  const seed = j('seed_ratings.json');
  assert.ok(Array.isArray(seed));
  for (const r of seed) {
    assert.ok(r.certificateId && r.skillId);
    assert.ok(r.stars >= 1 && r.stars <= 5);
    assert.equal(typeof r.relevant, 'boolean');
  }
});
