// One place to change how the app behaves.
export const CONFIG = {
  // Which certificate dataset to load from data/<name>/.
  //   "sample" -> self-authored, clearly flagged placeholder data (default, safe to demo)
  //   "binus"  -> output of scripts/import_scraped.py (only use with permission)
  // You can also try a dataset locally without editing this file: open /?dataset=binus
  CERT_DATASET: 'sample',
  DATA_ROOT: 'data',

  // Certificates shown per skill before "Show more".
  TOP_N: 3,

  // Ranking weights (see js/ranking.js).
  RANK: {
    wRelevance: 0.7,   // how well the certificate matches the skill (team mapping, adjusted by ratings)
    wRating: 0.3,      // average star rating, shrunk toward the prior when there are few ratings
    priorMean: 3.5,    // assumed average stars before any ratings exist
    priorWeight: 3,    // how many "virtual ratings" the prior is worth
  },
};
