// Database schema (Turso / libSQL, i.e. SQLite). Plain .mjs so the app, the seed script and
// the tests share one copy. Every statement is idempotent; applySchema runs on first use.
//
// Several datasets can live side by side ("sample", "binus"); the app serves the one named by
// BEEPATH_DATASET. Certificates and mappings are fixed data, replaced on every seed. Ratings come
// from students and are never touched by a re-seed (certificate ids are stable across imports).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS datasets (
     name        TEXT PRIMARY KEY,
     meta        TEXT NOT NULL,          -- data/<name>/meta.json as JSON
     seeded_at   TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS certificates (
     dataset         TEXT NOT NULL,
     id              TEXT NOT NULL,
     title           TEXT NOT NULL,
     code            TEXT,
     issuer          TEXT,
     institution     TEXT,
     category        TEXT,
     description     TEXT,
     outcomes        TEXT,
     credit_earning  TEXT,
     provider_type   TEXT NOT NULL DEFAULT 'third_party',
     url             TEXT,
     price_amount    REAL,
     price_currency  TEXT,
     hours           REAL,
     duration_text   TEXT,
     level           TEXT,
     sample          INTEGER NOT NULL DEFAULT 0,
     career_relevant INTEGER,               -- 1/0 from the LLM pass, NULL = not tagged
     PRIMARY KEY (dataset, id)
   )`,
  `CREATE TABLE IF NOT EXISTS mappings (
     dataset        TEXT NOT NULL,
     certificate_id TEXT NOT NULL,
     skill_id       TEXT NOT NULL,
     relevance      REAL NOT NULL CHECK (relevance >= 0 AND relevance <= 1),
     method         TEXT NOT NULL,
     PRIMARY KEY (dataset, certificate_id, skill_id)
   )`,
  `CREATE INDEX IF NOT EXISTS mappings_by_skill ON mappings (dataset, skill_id)`,
  `CREATE TABLE IF NOT EXISTS ratings (
     dataset        TEXT NOT NULL,
     certificate_id TEXT NOT NULL,
     skill_id       TEXT NOT NULL,
     client_id      TEXT NOT NULL,        -- random id from the rater's browser, or "seed:<n>"; never a person
     stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
     relevant       INTEGER NOT NULL CHECK (relevant IN (0, 1)),
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL,
     PRIMARY KEY (dataset, certificate_id, skill_id, client_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ratings_by_pair ON ratings (dataset, skill_id, certificate_id)`,
];

/** @param {import('@libsql/client').Client} client */
export async function applySchema(client) {
  await client.batch(SCHEMA, 'write');
}
