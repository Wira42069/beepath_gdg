// Database queries against an in-memory libSQL database seeded from data/sample.
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { beforeAll, describe, expect, test } from 'vitest';
import { pairKey } from '@/lib/ranking';
import {
  countMapped, getCertificatesByIds, getDatasetInfo, getRatingAggs, getSkillEntries, getSkillsForCerts, RatingError, saveRating, searchArchive,
} from '@/lib/repo';
import { seedDataset } from '@/lib/seed.mjs';

const dataDir = path.resolve(__dirname, '../../data');
let db: Client;
let pair: { certificateId: string; skillId: string };

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await seedDataset(db, { dataset: 'sample', dataDir });
  const entries = await getSkillEntries(db, 'sample', ['fe-css']);
  pair = { certificateId: entries[0].cert.id, skillId: 'fe-css' };
});

const rate = (over: Record<string, unknown> = {}) => saveRating(db, 'sample', { ...pair, clientId: 'client-aaaa-0001', stars: 4, relevant: true, ...over });

describe('dataset and skills', () => {
  test('dataset info reflects the sample data', async () => {
    const info = await getDatasetInfo(db, 'sample');
    expect(info).toMatchObject({ name: 'sample', isSample: true, certificates: 89, hasPrices: true, hasHours: true, hasRelevanceTags: false });
    expect(await getDatasetInfo(db, 'nope')).toBeNull();
  });

  test('skill entries carry the full certificate', async () => {
    const entries = await getSkillEntries(db, 'sample', ['fe-css', 'fe-html']);
    expect(entries.length).toBeGreaterThan(2);
    expect(new Set(entries.map((e) => e.skillId))).toEqual(new Set(['fe-css', 'fe-html']));
    const e = entries[0];
    expect(e.cert.sample).toBe(true);
    expect(e.relevance).toBeGreaterThan(0);
    expect(await getSkillEntries(db, 'sample', [])).toEqual([]);
  });

  test('counts mapped certificates and looks certificates up by id', async () => {
    expect(await countMapped(db, 'sample', ['fe-css'])).toBeGreaterThan(0);
    const [c] = await getCertificatesByIds(db, 'sample', [pair.certificateId]);
    expect(c.id).toBe(pair.certificateId);
    const skills = await getSkillsForCerts(db, 'sample', [pair.certificateId]);
    expect(skills[pair.certificateId].map((s) => s.skillId)).toContain('fe-css');
  });
});

describe('archive search', () => {
  test('lists everything A-Z with a limit and a total', async () => {
    const r = await searchArchive(db, 'sample', { limit: 10 });
    expect(r.total).toBe(89);
    expect(r.rows).toHaveLength(10);
    const titles = r.rows.map((x) => x.cert.title.toLowerCase());
    expect([...titles].sort()).toEqual(titles);
  });

  test('text search, free filter and hours filter narrow the list', async () => {
    const css = await searchArchive(db, 'sample', { q: 'css', limit: 100 });
    expect(css.total).toBeGreaterThan(0);
    expect(css.total).toBeLessThan(89);
    const free = await searchArchive(db, 'sample', { freeOnly: true, limit: 100 });
    expect(free.rows.every((x) => x.cert.price?.amount === 0)).toBe(true);
    const short = await searchArchive(db, 'sample', { maxHours: 5, limit: 100 });
    expect(short.rows.every((x) => (x.cert.hours ?? 99) <= 5)).toBe(true);
  });

  test('LIKE wildcards in the search text are treated literally', async () => {
    expect((await searchArchive(db, 'sample', { q: '%', limit: 100 })).total).toBe(0);
    expect((await searchArchive(db, 'sample', { q: '_', limit: 100 })).total).toBe(0);
  });

  test('with a skill, results are ranked with match levels', async () => {
    const r = await searchArchive(db, 'sample', { skill: 'fe-css', limit: 100 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.rows.every((x) => typeof x.relevance === 'number')).toBe(true);
  });
});

describe('ratings', () => {
  test('a rating is saved, re-rating replaces it, and other browsers add to it', async () => {
    let agg = await rate();
    expect(agg).toEqual({ n: 1, sum: 4, relYes: 1, relN: 1 });
    agg = await rate({ stars: 2, relevant: false });
    expect(agg).toEqual({ n: 1, sum: 2, relYes: 0, relN: 1 });
    agg = await rate({ clientId: 'client-bbbb-0002', stars: 5 });
    expect(agg).toEqual({ n: 2, sum: 7, relYes: 1, relN: 2 });
    const all = await getRatingAggs(db, 'sample', ['fe-css']);
    expect(all[pairKey(pair.certificateId, pair.skillId)]).toEqual(agg);
  });

  test('bad input is rejected', async () => {
    await expect(rate({ stars: 0 })).rejects.toThrow(RatingError);
    await expect(rate({ stars: 4.5 })).rejects.toThrow(/whole number/);
    await expect(rate({ relevant: 'yes' })).rejects.toThrow(/true or false/);
    await expect(rate({ clientId: 'x' })).rejects.toThrow(/clientId/);
    await expect(rate({ clientId: "1'; DROP TABLE ratings;--" })).rejects.toThrow(/clientId/);
    await expect(rate({ skillId: 'fe-not-mapped' })).rejects.toMatchObject({ status: 404 });
  });

  test('re-seeding keeps students\' ratings', async () => {
    await seedDataset(db, { dataset: 'sample', dataDir });
    const all = await getRatingAggs(db, 'sample', ['fe-css']);
    expect(all[pairKey(pair.certificateId, pair.skillId)].n).toBe(2);
  });
});
