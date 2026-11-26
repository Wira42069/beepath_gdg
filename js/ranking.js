// Pure ranking logic. No DOM, so it can be unit tested in Node.
//
// A rating belongs to a (certificate, skill) pair: stars rate the certificate in that
// context, and "was it relevant?" says whether it fit that skill.
// The team's fixed mapping relevance is the starting point; ratings adjust it gradually.

export const DEFAULT_RANK = { wRelevance: 0.7, wRating: 0.3, priorMean: 3.5, priorWeight: 3 };

export const pairKey = (certId, skillId) => `${certId}|${skillId}`;

/** Merge seed ratings (from test users) with this device's own ratings. */
export function aggregateRatings(seed = [], mine = {}) {
  const map = new Map();
  const add = (certId, skillId, stars, relevant) => {
    const k = pairKey(certId, skillId);
    const a = map.get(k) || { n: 0, sum: 0, relYes: 0, relN: 0 };
    if (Number.isFinite(stars) && stars >= 1 && stars <= 5) { a.n += 1; a.sum += stars; }
    if (typeof relevant === 'boolean') { a.relN += 1; if (relevant) a.relYes += 1; }
    map.set(k, a);
  };
  for (const r of seed) add(r.certificateId, r.skillId, r.stars, r.relevant);
  for (const [k, r] of Object.entries(mine)) {
    const [certId, skillId] = k.split('|');
    add(certId, skillId, r.stars, r.relevant);
  }
  return map;
}

export function ratingSummary(agg) {
  if (!agg || agg.n === 0) return { n: 0, avg: null, relevantPct: null };
  return {
    n: agg.n,
    avg: agg.sum / agg.n,
    relevantPct: agg.relN ? Math.round((100 * agg.relYes) / agg.relN) : null,
  };
}

/** Average stars pulled toward a prior so one lucky 5-star can't beat ten solid 4.8s. */
export function bayesianAverage(sum, n, { priorMean, priorWeight }) {
  return (priorMean * priorWeight + sum) / (priorWeight + n);
}

export function scoreEntry(relevance, agg, cfg = DEFAULT_RANK) {
  const n = agg?.n ?? 0, sum = agg?.sum ?? 0, yes = agg?.relYes ?? 0, relN = agg?.relN ?? 0;
  const relAdj = (relevance * cfg.priorWeight + yes) / (cfg.priorWeight + relN);
  const stars = bayesianAverage(sum, n, cfg);
  return cfg.wRelevance * relAdj + cfg.wRating * ((stars - 1) / 4);
}

/**
 * entries: [{ cert, skillId, relevance }]
 * filters: { freeOnly?: boolean, maxHours?: number }  (unknown price/hours never pass an active filter)
 */
export function rankCertificates(entries, aggMap, filters = {}, cfg = DEFAULT_RANK) {
  return entries
    .filter(({ cert }) => {
      if (filters.freeOnly && !(cert.price && cert.price.amount === 0)) return false;
      if (filters.maxHours && !(typeof cert.hours === 'number' && cert.hours <= filters.maxHours)) return false;
      return true;
    })
    .map((e) => {
      const agg = aggMap.get(pairKey(e.cert.id, e.skillId)) || null;
      return { ...e, agg, score: scoreEntry(e.relevance, agg, cfg) };
    })
    .sort((a, b) => b.score - a.score || b.relevance - a.relevance || a.cert.title.localeCompare(b.cert.title));
}

export function matchLabel(relevance) {
  if (relevance >= 0.85) return 'Strong match';
  if (relevance >= 0.65) return 'Good match';
  return 'Partial match';
}
