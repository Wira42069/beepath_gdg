import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchiveFilters } from '@/components/ArchiveFilters';
import { toQuery, type ArchiveFilterValues } from '@/lib/archiveQuery';
import { CertDetails, CertFacts, CertMeta, CompleteActions } from '@/components/CertParts';
import { CONFIG } from '@/lib/config';
import { current } from '@/lib/data';
import { safeUrl } from '@/lib/format';
import { matchLabel } from '@/lib/ranking';
import { getCategories, getSkillsForCerts, searchArchive } from '@/lib/repo';
import { availableRoles, skillById } from '@/lib/roles';

export const metadata: Metadata = { title: 'Archive · BeePath' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { db, dataset, info } = await current();
  const skill = skillById.has(one(sp.skill)) ? one(sp.skill) : '';
  const values: ArchiveFilterValues = {
    q: one(sp.q).slice(0, 100),
    skill,
    cat: one(sp.cat).slice(0, 80),
    free: one(sp.free) === '1',
    hours: [5, 10, 20].includes(Number(one(sp.hours))) ? Number(one(sp.hours)) : 0,
    all: one(sp.all) === '1',
  };
  const limit = Math.min(5000, Math.max(CONFIG.ARCHIVE_PAGE, Number(one(sp.limit)) || CONFIG.ARCHIVE_PAGE));

  const [result, categories] = await Promise.all([
    searchArchive(db, dataset, {
      q: values.q, skill: values.skill || undefined, category: values.cat || undefined,
      freeOnly: values.free, maxHours: values.hours, showUnrelated: values.all, limit,
    }, CONFIG.RANK),
    getCategories(db, dataset),
  ]);
  const matched = await getSkillsForCerts(db, dataset, result.rows.map((r) => r.cert.id));
  const skillGroups = availableRoles().map((r) => ({ role: r.name, skills: r.skills.map((s) => ({ id: s.id, name: s.name })) }));

  return (
    <div className="wrap">
      <div className="role-head">
        <Link className="back" href="/">← All roles</Link>
        <h1>Certificate archive</h1>
        <p className="tagline">Search all {info.certificates} entries. Pick a skill to filter by career relevance and rank by fit.</p>
      </div>
      <ArchiveFilters
        values={values}
        skillGroups={skillGroups}
        categories={categories}
        hasPrices={info.hasPrices}
        hasHours={info.hasHours}
        unrelatedHidden={result.unrelatedHidden}
      />
      <p className="arch-count" id="arch-count" aria-live="polite">
        Showing {result.rows.length} of {result.total} matching entries{values.skill ? ', best fit first' : ''}.
      </p>
      {!result.rows.length ? (
        <p className="empty">Nothing matches these filters. Clear a filter to see more.</p>
      ) : (
        <ul className="certs plain" id="arch-list">
          {result.rows.map(({ cert: c, relevance }) => {
            const skills = (matched[c.id] ?? []).map((m) => skillById.get(m.skillId)).filter((s) => s && s.roleId && availableRoles().some((r) => r.id === s.roleId));
            const url = safeUrl(c.url);
            return (
              <li className="cert plain" key={c.id}>
                <div>
                  <h4>{c.title}</h4>
                  <CertMeta c={c}>
                    {c.category && <span className="badge">{c.category}</span>}
                    {relevance != null && <span className="badge match">{matchLabel(relevance)}</span>}
                  </CertMeta>
                  {c.description && <p className="cdesc">{c.description.length > 260 ? `${c.description.slice(0, 260).trimEnd()}…` : c.description}</p>}
                  <CertFacts c={c} />
                  {c.description && c.description.length > 260 && <CertDetails c={c} />}
                  <p className="rating-line">
                    {skills.length ? `Matched to: ${skills.map((s) => s!.name).join(', ')}` : 'Not matched to a skill in the available roles'}
                  </p>
                  <div className="cert-actions">
                    {url && <a className="btn ghost" href={url} target="_blank" rel="noopener noreferrer">View certificate ↗</a>}
                    <CompleteActions cert={c} skillId={values.skill || skills[0]?.id || null} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {result.total > result.rows.length && (
        <p className="more">
          <Link className="btn ghost" scroll={false} href={`/archive${toQuery(values, { limit: String(limit + CONFIG.ARCHIVE_PAGE) })}`}>
            Show {Math.min(CONFIG.ARCHIVE_PAGE, result.total - result.rows.length)} more
          </Link>
        </p>
      )}
    </div>
  );
}
