#!/usr/bin/env node
// Load a dataset (data/<name>/) into the database. Safe to re-run: certificates and mappings
// are replaced, students' ratings are kept.
//
//   npm run db:seed                         # data/sample into the local database (.data/beepath.db)
//   npm run db:seed -- --dataset binus      # real archive data, after scripts/import_scraped.py
//   npm run db:seed -- --if-missing         # only when the dataset is not there yet (used by npm run dev)
//
// Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to seed the Turso database instead of the local file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@libsql/client';
import { seedDataset, isSeeded } from '../lib/seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { dataset: { type: 'string' }, 'if-missing': { type: 'boolean' } },
});
const dataset = values.dataset || process.env.BEEPATH_DATASET || 'sample';

let url = process.env.TURSO_DATABASE_URL;
if (!url) {
  fs.mkdirSync(path.join(root, '.data'), { recursive: true });
  url = `file:${path.join(root, '.data', 'beepath.db')}`;
}
const where = url.startsWith('file:') ? 'local database .data/beepath.db' : `Turso (${new URL(url.replace(/^libsql:/, 'https:')).host})`;
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

try {
  if (values['if-missing'] && (await isSeeded(client, dataset))) {
    process.exit(0);
  }
  const r = await seedDataset(client, { dataset, dataDir: path.join(root, 'data') });
  console.log(`Seeded "${r.dataset}" into the ${where}: ${r.certificates} certificates, ${r.mappings} mappings, ${r.seedRatings} seed ratings.`);
  if (r.skippedMappings) console.log(`  Skipped ${r.skippedMappings} mappings that point at unknown certificates (run scripts/validate_data.py).`);
  if (r.studentRatingsKept) console.log(`  Kept ${r.studentRatingsKept} ratings from students.`);
  if (dataset !== 'sample') console.log(`  Serve it with BEEPATH_DATASET=${dataset}.`);
} catch (err) {
  console.error(`Seeding failed: ${err.message}`);
  process.exit(1);
} finally {
  client.close();
}
