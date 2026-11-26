// Data-source adapter. The UI only talks to loadData(); where the data comes from is decided here.
//
//   data/roles.json              team-authored skill trees (shared by every dataset)
//   data/seed_ratings.json       real ratings collected from test users (starts empty)
//   data/<dataset>/meta.json         what this dataset is (sample vs real) -> drives the UI banner
//   data/<dataset>/certificates.json certificates (normalized fields only)
//   data/<dataset>/mappings.json     certificate -> skill mapping, with relevance 0..1 and method

import { CONFIG } from './config.js';

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json();
}

export function datasetName() {
  const q = new URLSearchParams(location.search).get('dataset');
  return q && /^[a-z0-9_-]+$/i.test(q) ? q : CONFIG.CERT_DATASET;
}

export async function loadData() {
  const dataset = datasetName();
  const dir = `${CONFIG.DATA_ROOT}/${dataset}`;
  const [roles, seedRatings, meta, certs, mappings] = await Promise.all([
    getJSON(`${CONFIG.DATA_ROOT}/roles.json`),
    getJSON(`${CONFIG.DATA_ROOT}/seed_ratings.json`),
    getJSON(`${dir}/meta.json`),
    getJSON(`${dir}/certificates.json`),
    getJSON(`${dir}/mappings.json`),
  ]);

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const skillById = new Map();
  for (const r of roles) for (const s of r.skills || []) skillById.set(s.id, { ...s, roleId: r.id });
  const certById = new Map(certs.map((c) => [c.id, c]));

  // skillId -> [{ cert, skillId, relevance, method }]
  const skillCerts = new Map();
  const mappedCertIds = new Set();
  for (const m of mappings) {
    const cert = certById.get(m.certificateId);
    if (!cert || !skillById.has(m.skillId)) continue; // ignore dangling rows; validate_data.py reports them
    if (!skillCerts.has(m.skillId)) skillCerts.set(m.skillId, []);
    skillCerts.get(m.skillId).push({ cert, skillId: m.skillId, relevance: m.relevance, method: m.method });
    mappedCertIds.add(cert.id);
  }

  return { dataset, meta, roles, roleById, skillById, certs, certById, skillCerts, mappedCertIds, seedRatings };
}
