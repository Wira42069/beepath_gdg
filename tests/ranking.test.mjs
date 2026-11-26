import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRatings, rankCertificates, bayesianAverage, ratingSummary, DEFAULT_RANK, pairKey } from '../js/ranking.js';

const cert = (id, over = {}) => ({ id, title: id, price: { amount: 0, currency: 'IDR' }, hours: 5, ...over });
const entry = (id, relevance, over) => ({ cert: cert(id, over), skillId: 's1', relevance });

test('without ratings, order follows the team mapping relevance', () => {
  const r = rankCertificates([entry('a', 0.6), entry('b', 0.9), entry('c', 0.75)], new Map());
  assert.deepEqual(r.map((x) => x.cert.id), ['b', 'c', 'a']);
});

test('many good ratings can lift a slightly lower-relevance certificate', () => {
  const seed = Array.from({ length: 10 }, () => ({ certificateId: 'b', skillId: 's1', stars: 5, relevant: true }));
  const r = rankCertificates([entry('a', 0.85), entry('b', 0.8)], aggregateRatings(seed));
  assert.equal(r[0].cert.id, 'b');
});

test('a single 5-star rating does not beat ten solid ratings', () => {
  const one = bayesianAverage(5, 1, DEFAULT_RANK);
  const ten = bayesianAverage(48, 10, DEFAULT_RANK);
  assert.ok(ten > one);
});

test('freeOnly drops paid and unknown-price entries', () => {
  const r = rankCertificates(
    [entry('free', 0.5), entry('paid', 0.9, { price: { amount: 100000, currency: 'IDR' } }), entry('unknown', 0.9, { price: null })],
    new Map(), { freeOnly: true });
  assert.deepEqual(r.map((x) => x.cert.id), ['free']);
});

test('maxHours drops longer and unknown-duration entries', () => {
  const r = rankCertificates(
    [entry('short', 0.5, { hours: 4 }), entry('long', 0.9, { hours: 30 }), entry('unknown', 0.9, { hours: null })],
    new Map(), { maxHours: 10 });
  assert.deepEqual(r.map((x) => x.cert.id), ['short']);
});

test('aggregateRatings merges seed ratings with this device ratings, per cert and skill', () => {
  const seed = [{ certificateId: 'a', skillId: 's1', stars: 4, relevant: true }];
  const mine = { [pairKey('a', 's1')]: { stars: 2, relevant: false }, [pairKey('a', 's2')]: { stars: 5, relevant: true } };
  const agg = aggregateRatings(seed, mine);
  const s = ratingSummary(agg.get(pairKey('a', 's1')));
  assert.equal(s.n, 2);
  assert.equal(s.avg, 3);
  assert.equal(s.relevantPct, 50);
  assert.equal(agg.get(pairKey('a', 's2')).n, 1);
});

test('invalid star values are ignored instead of corrupting the average', () => {
  const agg = aggregateRatings([{ certificateId: 'a', skillId: 's1', stars: 99, relevant: true }]);
  assert.equal(agg.get(pairKey('a', 's1')).n, 0);
});
