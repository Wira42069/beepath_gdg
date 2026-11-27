// Database queries. Every function takes the client and dataset explicitly so tests can run them
// against an in-memory database; lib/data.ts wraps them for the app.
import type { Client, InValue, Row } from '@libsql/client';
import { pairKey, rankCertificates, emptyAgg, type RankConfig, DEFAULT_RANK } from './ranking';
import type { Certificate, DatasetInfo, DatasetMeta, MappingMethod, RatingAgg, SkillEntry } from './types';

const CERT_COLS = `c.id, c.title, c.code, c.issuer, c.institution, c.category, c.description, c.outcomes,
  c.credit_earning, c.provider_type, c.url, c.price_amount, c.price_currency, c.hours, c.duration_text,
  c.level, c.sample, c.career_relevant`;

const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export function rowToCert(r: Row): Certificate {
  const price = r.price_amount == null ? null : { amount: Number(r.price_amount), currency: str(r.price_currency) || 'IDR' };
  return {
    id: String(r.id),
    title: String(r.title),
    code: str(r.code),
    issuer: str(r.issuer),
    institution: str(r.institution),
    category: str(r.category),
    description: str(r.description),
    outcomes: str(r.outcomes),
    creditEarning: str(r.credit_earning),
    providerType: r.provider_type === 'campus' ? 'campus' : 'third_party',
    url: str(r.url),
    price,
    hours: num(r.hours),
    durationText: str(r.duration_text),
    level: str(r.level),
    sample: Number(r.sample) === 1,
    careerRelevant: r.career_relevant == null ? null : Number(r.career_relevant) === 1,
  };
}

export async function getDatasetInfo(db: Client, dataset: string): Promise<DatasetInfo | null> {
  const metaRow = await db.execute({ sql: 'SELECT meta FROM datasets WHERE name = ?', args: [dataset] });
  if (!metaRow.rows.length) return null;
  const meta = JSON.parse(String(metaRow.rows[0].meta)) as DatasetMeta;
  const c = await db.execute({
    sql: `SELECT COUNT(*) AS n,
            COALESCE(SUM(price_amount IS NOT NULL), 0) AS priced,
            COALESCE(SUM(hours IS NOT NULL), 0) AS timed,
            COALESCE(SUM(career_relevant IS NOT NULL), 0) AS tagged
          FROM certificates WHERE dataset = ?`,
    args: [dataset],
  });
  const row = c.rows[0];
  return {
    name: dataset,
    meta,
    isSample: meta.dataSource === 'sample',
    certificates: Number(row.n),
    hasPrices: Number(row.priced) > 0,
    hasHours: Number(row.timed) > 0,
    hasRelevanceTags: Number(row.tagged) > 0,
  };
}

/** Certificates placed on these skills. Entries the LLM pass marked unrelated are left out. */
export async function getSkillEntries(db: Client, dataset: string, skillIds: string[]): Promise<SkillEntry[]> {
  if (!skillIds.length) return [];
  const r = await db.execute({
    sql: `SELECT m.skill_id, m.relevance, m.method, ${CERT_COLS}
          FROM mappings m JOIN certificates c ON c.dataset = m.dataset AND c.id = m.certificate_id
          WHERE m.dataset = ? AND m.skill_id IN (${placeholders(skillIds.length)})
            AND (c.career_relevant IS NULL OR c.career_relevant = 1)`,
    args: [dataset, ...skillIds],
  });
  return r.rows.map((row) => ({
    cert: rowToCert(row),
    skillId: String(row.skill_id),
    relevance: Number(row.relevance),
    method: String(row.method) as MappingMethod,
  }));
}

/** Rating aggregates per "certId|skillId", from every student's ratings plus seed ratings. */
export async function getRatingAggs(db: Client, dataset: string, skillIds?: string[]): Promise<Record<string, RatingAgg>> {
  const args: InValue[] = [dataset];
  let where = 'dataset = ?';
  if (skillIds) {
    if (!skillIds.length) return {};
    where += ` AND skill_id IN (${placeholders(skillIds.length)})`;
    args.push(...skillIds);
  }
  const r = await db.execute({
    sql: `SELECT certificate_id, skill_id, COUNT(*) AS n, SUM(stars) AS total, SUM(relevant) AS yes
          FROM ratings WHERE ${where} GROUP BY certificate_id, skill_id`,
    args,
  });
  const out: Record<string, RatingAgg> = {};
  for (const row of r.rows) {
    const n = Number(row.n);
    out[pairKey(String(row.certificate_id), String(row.skill_id))] = { n, sum: Number(row.total), relYes: Number(row.yes), relN: n };
  }
  return out;
}

export async function countMapped(db: Client, dataset: string, skillIds: string[]): Promise<number> {
  if (!skillIds.length) return 0;
  const r = await db.execute({
    sql: `SELECT COUNT(DISTINCT m.certificate_id) AS n FROM mappings m
          JOIN certificates c ON c.dataset = m.dataset AND c.id = m.certificate_id
          WHERE m.dataset = ? AND m.skill_id IN (${placeholders(skillIds.length)})
            AND (c.career_relevant IS NULL OR c.career_relevant = 1)`,
    args: [dataset, ...skillIds],
  });
  return Number(r.rows[0].n);
}

export async function getCategories(db: Client, dataset: string): Promise<string[]> {
  const r = await db.execute({
    sql: 'SELECT DISTINCT category FROM certificates WHERE dataset = ? AND category IS NOT NULL ORDER BY category',
    args: [dataset],
  });
  return r.rows.map((row) => String(row.category));
}

export async function getCertificatesByIds(db: Client, dataset: string, ids: string[]): Promise<Certificate[]> {
  if (!ids.length) return [];
  const r = await db.execute({
    sql: `SELECT ${CERT_COLS} FROM certificates c WHERE c.dataset = ? AND c.id IN (${placeholders(ids.length)})`,
    args: [dataset, ...ids],
  });
  return r.rows.map(rowToCert);
}

/** certId -> skills it is placed on (for "Matched to: ..." and the skill profile). */
export async function getSkillsForCerts(db: Client, dataset: string, certIds: string[]): Promise<Record<string, { skillId: string; relevance: number }[]>> {
  if (!certIds.length) return {};
  const r = await db.execute({
    sql: `SELECT certificate_id, skill_id, relevance FROM mappings
          WHERE dataset = ? AND certificate_id IN (${placeholders(certIds.length)}) ORDER BY relevance DESC`,
    args: [dataset, ...certIds],
  });
  const out: Record<string, { skillId: string; relevance: number }[]> = {};
  for (const row of r.rows) {
    const id = String(row.certificate_id);
    (out[id] ??= []).push({ skillId: String(row.skill_id), relevance: Number(row.relevance) });
  }
  return out;
}

export type ArchiveQuery = {
  q?: string;
  skill?: string;
  category?: string;
  freeOnly?: boolean;
  maxHours?: number;
  showUnrelated?: boolean;
  limit: number;
};
export type ArchiveRow = { cert: Certificate; relevance: number | null };
export type ArchiveResult = { rows: ArchiveRow[]; total: number; unrelatedHidden: number };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function textMatches(c: Certificate, q: string) {
  const needle = q.toLowerCase();
  return [c.title, c.code, c.issuer, c.institution, c.category, c.description].some((t) => (t ?? '').toLowerCase().includes(needle));
}

/**
 * The whole archive with filters. With a skill, results are that skill's certificates ranked by
 * fit (mapping + ratings); without one, everything matching, A-Z.
 */
export async function searchArchive(db: Client, dataset: string, query: ArchiveQuery, rank: RankConfig = DEFAULT_RANK): Promise<ArchiveResult> {
  const q = (query.q ?? '').trim();
  const unrelated = query.showUnrelated
    ? 0
    : Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM certificates WHERE dataset = ? AND career_relevant = 0', args: [dataset] })).rows[0].n);

  if (query.skill) {
    const entries = await getSkillEntries(db, dataset, [query.skill]);
    const aggs = await getRatingAggs(db, dataset, [query.skill]);
    const ranked = rankCertificates(entries, aggs, { freeOnly: query.freeOnly, maxHours: query.maxHours }, rank)
      .filter((e) => (!query.category || e.cert.category === query.category) && (!q || textMatches(e.cert, q)));
    return { rows: ranked.slice(0, query.limit).map((e) => ({ cert: e.cert, relevance: e.relevance })), total: ranked.length, unrelatedHidden: unrelated };
  }

  const where = ['c.dataset = ?'];
  const args: InValue[] = [dataset];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(c.title LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.issuer LIKE ? ESCAPE '\\' OR c.institution LIKE ? ESCAPE '\\' OR c.category LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')`);
    args.push(like, like, like, like, like, like);
  }
  if (query.category) { where.push('c.category = ?'); args.push(query.category); }
  if (query.freeOnly) where.push('c.price_amount = 0');
  if (query.maxHours) { where.push('c.hours IS NOT NULL AND c.hours <= ?'); args.push(query.maxHours); }
  if (!query.showUnrelated) where.push('(c.career_relevant IS NULL OR c.career_relevant = 1)');
  const whereSql = where.join(' AND ');

  const total = Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM certificates c WHERE ${whereSql}`, args })).rows[0].n);
  const r = await db.execute({
    sql: `SELECT ${CERT_COLS} FROM certificates c WHERE ${whereSql} ORDER BY c.title COLLATE NOCASE, c.id LIMIT ?`,
    args: [...args, query.limit],
  });
  return { rows: r.rows.map((row) => ({ cert: rowToCert(row), relevance: null })), total, unrelatedHidden: unrelated };
}

export class RatingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type RatingInputFromClient = { certificateId: unknown; skillId: unknown; clientId: unknown; stars: unknown; relevant: unknown };

/**
 * Saves (or replaces) one browser's rating of a certificate for a skill and returns the new
 * aggregate for that pair. Only pairs that exist in the mapping can be rated.
 */
export async function saveRating(db: Client, dataset: string, input: RatingInputFromClient): Promise<RatingAgg> {
  const { certificateId, skillId, clientId, stars, relevant } = input;
  if (typeof certificateId !== 'string' || typeof skillId !== 'string' || !certificateId || !skillId) throw new RatingError('certificateId and skillId are required');
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) throw new RatingError('clientId must be 8-64 letters, digits or dashes');
  if (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5) throw new RatingError('stars must be a whole number from 1 to 5');
  if (typeof relevant !== 'boolean') throw new RatingError('relevant must be true or false');

  const exists = await db.execute({
    sql: 'SELECT 1 FROM mappings WHERE dataset = ? AND certificate_id = ? AND skill_id = ?',
    args: [dataset, certificateId, skillId],
  });
  if (!exists.rows.length) throw new RatingError('That certificate is not listed for that skill', 404);

  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO ratings (dataset, certificate_id, skill_id, client_id, stars, relevant, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (dataset, certificate_id, skill_id, client_id)
          DO UPDATE SET stars = excluded.stars, relevant = excluded.relevant, updated_at = excluded.updated_at`,
    args: [dataset, certificateId, skillId, clientId, stars as number, relevant ? 1 : 0, now, now],
  });
  const aggs = await getRatingAggs(db, dataset, [skillId]);
  return aggs[pairKey(certificateId, skillId)] ?? emptyAgg();
}
