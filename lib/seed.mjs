// Loads data/<dataset>/ (certificates, mappings, meta) and data/seed_ratings.json into the database.
// Used by scripts/db-seed.mjs and the tests. Students' ratings are kept across re-seeds.
import fs from 'node:fs';
import path from 'node:path';
import { applySchema } from './schema.mjs';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const CHUNK = 200; // statements per batch; keeps each request to a remote Turso database small

async function inChunks(client, statements) {
  for (let i = 0; i < statements.length; i += CHUNK) {
    await client.batch(statements.slice(i, i + CHUNK), 'write');
  }
}

/**
 * @param {import('@libsql/client').Client} client
 * @param {{ dataset: string, dataDir: string }} opts
 */
export async function seedDataset(client, { dataset, dataDir }) {
  if (!/^[a-z0-9_-]+$/i.test(dataset)) throw new Error(`Bad dataset name "${dataset}"`);
  const dir = path.join(dataDir, dataset);
  if (!fs.existsSync(dir)) throw new Error(`No dataset folder ${dir}. For real data, run the scraper and the importer first.`);
  const meta = readJson(path.join(dir, 'meta.json'));
  const certs = readJson(path.join(dir, 'certificates.json'));
  const maps = readJson(path.join(dir, 'mappings.json'));
  const seedFile = path.join(dataDir, 'seed_ratings.json');
  const seedRatings = fs.existsSync(seedFile) ? readJson(seedFile) : [];

  const certIds = new Set(certs.map((c) => c.id));
  const now = new Date().toISOString();
  await applySchema(client);

  const statements = [
    { sql: 'DELETE FROM mappings WHERE dataset = ?', args: [dataset] },
    { sql: 'DELETE FROM certificates WHERE dataset = ?', args: [dataset] },
    { sql: "DELETE FROM ratings WHERE dataset = ? AND client_id LIKE 'seed:%'", args: [dataset] },
    {
      sql: 'INSERT INTO datasets (name, meta, seeded_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET meta = excluded.meta, seeded_at = excluded.seeded_at',
      args: [dataset, JSON.stringify(meta), now],
    },
  ];
  for (const c of certs) {
    statements.push({
      sql: `INSERT INTO certificates (dataset, id, title, code, issuer, institution, category, description, outcomes,
              credit_earning, provider_type, url, price_amount, price_currency, hours, duration_text, level, sample, career_relevant)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        dataset, c.id, c.title, c.code ?? null, c.issuer ?? null, c.institution ?? null, c.category ?? null,
        c.description ?? null, c.outcomes ?? null, c.creditEarning ?? null, c.providerType === 'campus' ? 'campus' : 'third_party',
        c.url ?? null, c.price?.amount ?? null, c.price?.currency ?? null, c.hours ?? null, c.durationText ?? null,
        c.level ?? null, c.sample ? 1 : 0, typeof c.careerRelevant === 'boolean' ? (c.careerRelevant ? 1 : 0) : null,
      ],
    });
  }
  let skippedMaps = 0;
  for (const m of maps) {
    if (!certIds.has(m.certificateId)) { skippedMaps += 1; continue; }
    statements.push({
      sql: 'INSERT OR REPLACE INTO mappings (dataset, certificate_id, skill_id, relevance, method) VALUES (?, ?, ?, ?, ?)',
      args: [dataset, m.certificateId, m.skillId, m.relevance, m.method ?? 'manual'],
    });
  }
  let seeded = 0;
  seedRatings.forEach((r, i) => {
    if (!certIds.has(r.certificateId)) return;
    seeded += 1;
    statements.push({
      sql: `INSERT OR REPLACE INTO ratings (dataset, certificate_id, skill_id, client_id, stars, relevant, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [dataset, r.certificateId, r.skillId, `seed:${i}`, r.stars, r.relevant ? 1 : 0, now, now],
    });
  });
  // Delete + insert happen in chunks, so a failure halfway leaves a partial dataset; re-running fixes it.
  await inChunks(client, statements);
  const kept = await client.execute({ sql: "SELECT COUNT(*) AS n FROM ratings WHERE dataset = ? AND client_id NOT LIKE 'seed:%'", args: [dataset] });
  return { dataset, certificates: certs.length, mappings: maps.length - skippedMaps, skippedMappings: skippedMaps, seedRatings: seeded, studentRatingsKept: Number(kept.rows[0].n) };
}

/** True when the dataset has been seeded already. */
export async function isSeeded(client, dataset) {
  await applySchema(client);
  const r = await client.execute({ sql: 'SELECT 1 FROM datasets WHERE name = ?', args: [dataset] });
  return r.rows.length > 0;
}
