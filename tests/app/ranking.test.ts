import { describe, expect, test } from 'vitest';
import { aggregateRatings, bayesianAverage, DEFAULT_RANK, pairKey, rankCertificates, ratingSummary } from '@/lib/ranking';
import type { Certificate, SkillEntry } from '@/lib/types';

const cert = (id: string, over: Partial<Certificate> = {}): Certificate => ({
  id, title: id, code: null, issuer: null, institution: null, category: null, description: null, outcomes: null,
  creditEarning: null, providerType: 'third_party', url: null, price: { amount: 0, currency: 'IDR' }, hours: 5,
  durationText: null, level: null, sample: true, careerRelevant: null, ...over,
});
const entry = (id: string, relevance: number, over?: Partial<Certificate>): SkillEntry => ({ cert: cert(id, over), skillId: 's1', relevance, method: 'manual' });

describe('ranking', () => {
  test('without ratings, order follows the team mapping relevance', () => {
    const r = rankCertificates([entry('a', 0.6), entry('b', 0.9), entry('c', 0.75)], new Map());
    expect(r.map((x) => x.cert.id)).toEqual(['b', 'c', 'a']);
  });

  test('many good ratings can lift a slightly lower-relevance certificate', () => {
    const ratings = Array.from({ length: 10 }, () => ({ certificateId: 'b', skillId: 's1', stars: 5, relevant: true }));
    const r = rankCertificates([entry('a', 0.85), entry('b', 0.8)], aggregateRatings(ratings));
    expect(r[0].cert.id).toBe('b');
  });

  test('aggregates work as a plain object too (what the server sends)', () => {
    const ratings = Array.from({ length: 10 }, () => ({ certificateId: 'b', skillId: 's1', stars: 5, relevant: true }));
    const r = rankCertificates([entry('a', 0.85), entry('b', 0.8)], Object.fromEntries(aggregateRatings(ratings)));
    expect(r[0].cert.id).toBe('b');
  });

  test('a single 5-star rating does not beat ten solid ratings', () => {
    expect(bayesianAverage(48, 10, DEFAULT_RANK)).toBeGreaterThan(bayesianAverage(5, 1, DEFAULT_RANK));
  });

  test('freeOnly drops paid and unknown-price entries', () => {
    const r = rankCertificates(
      [entry('free', 0.5), entry('paid', 0.9, { price: { amount: 100000, currency: 'IDR' } }), entry('unknown', 0.9, { price: null })],
      new Map(), { freeOnly: true });
    expect(r.map((x) => x.cert.id)).toEqual(['free']);
  });

  test('maxHours drops longer and unknown-duration entries', () => {
    const r = rankCertificates(
      [entry('short', 0.5, { hours: 4 }), entry('long', 0.9, { hours: 30 }), entry('unknown', 0.9, { hours: null })],
      new Map(), { maxHours: 10 });
    expect(r.map((x) => x.cert.id)).toEqual(['short']);
  });

  test('aggregateRatings keeps pairs apart and summarises them', () => {
    const agg = aggregateRatings([
      { certificateId: 'a', skillId: 's1', stars: 4, relevant: true },
      { certificateId: 'a', skillId: 's1', stars: 2, relevant: false },
      { certificateId: 'a', skillId: 's2', stars: 5, relevant: true },
    ]);
    const s = ratingSummary(agg.get(pairKey('a', 's1')));
    expect(s).toEqual({ n: 2, avg: 3, relevantPct: 50 });
    expect(agg.get(pairKey('a', 's2'))!.n).toBe(1);
  });

  test('invalid star values are ignored instead of corrupting the average', () => {
    const agg = aggregateRatings([{ certificateId: 'a', skillId: 's1', stars: 99, relevant: true }]);
    expect(agg.get(pairKey('a', 's1'))!.n).toBe(0);
  });
});
