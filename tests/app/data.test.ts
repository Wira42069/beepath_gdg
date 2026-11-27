import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Role } from '@/lib/types';

const data = path.resolve(__dirname, '../../data');
const j = (p: string) => JSON.parse(fs.readFileSync(path.join(data, p), 'utf8'));

test('every skill of every available role has at least one certificate in the sample dataset', () => {
  const roles: Role[] = j('roles.json');
  const covered = new Set(j('sample/mappings.json').map((m: { skillId: string }) => m.skillId));
  const missing = roles.filter((r) => r.status === 'available').flatMap((r) => r.skills.filter((s) => !covered.has(s.id)).map((s) => s.id));
  expect(missing).toEqual([]);
});

test('sample dataset is flagged as sample everywhere', () => {
  expect(j('sample/meta.json').dataSource).toBe('sample');
  expect(j('sample/certificates.json').every((c: { sample: boolean; source: string }) => c.sample === true && c.source === 'sample')).toBe(true);
});

test('seed ratings contain only real, well-formed entries', () => {
  const seed = j('seed_ratings.json');
  expect(Array.isArray(seed)).toBe(true);
  for (const r of seed) {
    expect(r.certificateId && r.skillId).toBeTruthy();
    expect(r.stars >= 1 && r.stars <= 5).toBe(true);
    expect(typeof r.relevant).toBe('boolean');
  }
});
