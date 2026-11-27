// Pure ranking logic. No DOM, no database, so it can be unit tested.
//
// A rating belongs to a (certificate, skill) pair: stars rate the certificate in that
// context, and "was it relevant?" says whether it fit that skill.
// The team's fixed mapping relevance is the starting point; ratings adjust it gradually.
import type { RatingAgg, SkillEntry } from './types';

export type RankConfig = { wRelevance: number; wRating: number; priorMean: number; priorWeight: number };
export const DEFAULT_RANK: RankConfig = { wRelevance: 0.7, wRating: 0.3, priorMean: 3.5, priorWeight: 3 };

export const pairKey = (certId: string, skillId: string) => `${certId}|${skillId}`;

export type RatingInput = { certificateId: string; skillId: string; stars: number; relevant: boolean };

export const emptyAgg = (): RatingAgg => ({ n: 0, sum: 0, relYes: 0, relN: 0 });

/** Adds one rating to an aggregate, ignoring values outside 1-5 stars. */
export function addRating(a: RatingAgg, stars: unknown, relevant: unknown): RatingAgg {
  const out = { ...a };
  if (typeof stars === 'number' && Number.isFinite(stars) && stars >= 1 && stars <= 5) {
    out.n += 1;
    out.sum += stars;
  }
  if (typeof relevant === 'boolean') {
    out.relN += 1;
    if (relevant) out.relYes += 1;
  }
  return out;
}

/** Builds per-pair aggregates from individual ratings. */
export function aggregateRatings(ratings: RatingInput[] = []): Map<string, RatingAgg> {
  const map = new Map<string, RatingAgg>();
  for (const r of ratings) {
    const k = pairKey(r.certificateId, r.skillId);
    map.set(k, addRating(map.get(k) ?? emptyAgg(), r.stars, r.relevant));
  }
  return map;
}

export function ratingSummary(agg: RatingAgg | null | undefined) {
  if (!agg || agg.n === 0) return { n: 0, avg: null as number | null, relevantPct: null as number | null };
  return {
    n: agg.n,
    avg: agg.sum / agg.n,
    relevantPct: agg.relN ? Math.round((100 * agg.relYes) / agg.relN) : null,
  };
}

/** Average stars pulled toward a prior so one lucky 5-star can't beat ten solid 4.8s. */
export function bayesianAverage(sum: number, n: number, { priorMean, priorWeight }: RankConfig) {
  return (priorMean * priorWeight + sum) / (priorWeight + n);
}

export function scoreEntry(relevance: number, agg: RatingAgg | null | undefined, cfg: RankConfig = DEFAULT_RANK) {
  const n = agg?.n ?? 0, sum = agg?.sum ?? 0, yes = agg?.relYes ?? 0, relN = agg?.relN ?? 0;
  const relAdj = (relevance * cfg.priorWeight + yes) / (cfg.priorWeight + relN);
  const stars = bayesianAverage(sum, n, cfg);
  return cfg.wRelevance * relAdj + cfg.wRating * ((stars - 1) / 4);
}

export type RankFilters = { freeOnly?: boolean; maxHours?: number };
export type RankedEntry = SkillEntry & { agg: RatingAgg | null; score: number };

/** Unknown price/hours never pass an active filter. */
export function rankCertificates(
  entries: SkillEntry[],
  aggs: Map<string, RatingAgg> | Record<string, RatingAgg>,
  filters: RankFilters = {},
  cfg: RankConfig = DEFAULT_RANK,
): RankedEntry[] {
  const get = (k: string) => (aggs instanceof Map ? aggs.get(k) : aggs[k]) ?? null;
  return entries
    .filter(({ cert }) => {
      if (filters.freeOnly && !(cert.price && cert.price.amount === 0)) return false;
      if (filters.maxHours && !(typeof cert.hours === 'number' && cert.hours <= filters.maxHours)) return false;
      return true;
    })
    .map((e) => {
      const agg = get(pairKey(e.cert.id, e.skillId));
      return { ...e, agg, score: scoreEntry(e.relevance, agg, cfg) };
    })
    .sort((a, b) => b.score - a.score || b.relevance - a.relevance || a.cert.title.localeCompare(b.cert.title));
}

export function matchLabel(relevance: number) {
  if (relevance >= 0.85) return 'Strong match';
  if (relevance >= 0.65) return 'Good match';
  return 'Partial match';
}
