// One place to change how the app behaves.
export const CONFIG = {
  // Certificates shown per skill before "Show more".
  TOP_N: 3,

  // Ranking weights (see lib/ranking.ts).
  RANK: {
    wRelevance: 0.7, // how well the certificate matches the skill (team mapping, adjusted by ratings)
    wRating: 0.3, // average star rating, shrunk toward the prior when there are few ratings
    priorMean: 3.5, // assumed average stars before any ratings exist
    priorWeight: 3, // how many "virtual ratings" the prior is worth
  },

  // Archive page size ("Show more" adds this many).
  ARCHIVE_PAGE: 50,
};

/**
 * Which certificate dataset the app serves: data/<name>/, loaded into the database by
 * `npm run db:seed -- --dataset <name>`. "sample" is self-authored placeholder data (safe to demo).
 */
export function datasetName(): string {
  const name = process.env.BEEPATH_DATASET || 'sample';
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`BEEPATH_DATASET must be a folder name, got "${name}"`);
  return name;
}
