'use client';
// The skill path for one role, and the detail panel for the selected skill.
// Progress and this device's ratings live in localStorage; rating aggregates come from the server
// and are updated in place when this student rates.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG } from '@/lib/config';
import { safeUrl, starsText } from '@/lib/format';
import { matchLabel, pairKey, rankCertificates, ratingSummary, type RankedEntry } from '@/lib/ranking';
import { anonId, setMyRating, setStatus, statusOf, useMyRatings, useProgress, type MyRating, type Status } from '@/lib/store';
import type { RatingAgg, Role, Skill, SkillEntry } from '@/lib/types';
import { CertDetails, CertFacts, CertMeta, CompleteActions } from './CertParts';
import { useToast } from './Toast';

const STEP = 148, TOP = 58, W = 360, AMP = [0, 62, 92, 62, 0, -62, -92, -62];
const pos = (i: number) => ({ x: W / 2 + AMP[i % AMP.length], y: TOP + i * STEP });
const STATUS_LABEL: Record<Status, string> = { todo: 'not started', doing: 'in progress', done: 'done' };

type Props = {
  role: Role;
  entries: SkillEntry[];
  aggs: Record<string, RatingAgg>;
  hasPrices: boolean;
  hasHours: boolean;
};

function skillHref(roleId: string, skillId?: string | null) {
  return `/role/${encodeURIComponent(roleId)}${skillId ? `?skill=${encodeURIComponent(skillId)}` : ''}`;
}

export function RolePath({ role, entries, aggs: initialAggs, hasPrices, hasHours }: Props) {
  const params = useSearchParams();
  const selectedId = params.get('skill');
  const selected = role.skills.find((s) => s.id === selectedId) ?? null;
  const progress = useProgress();
  const [aggs, setAggs] = useState(initialAggs);

  const bySkill = useMemo(() => {
    const m = new Map<string, SkillEntry[]>();
    for (const e of entries) (m.get(e.skillId) ?? m.set(e.skillId, []).get(e.skillId)!).push(e);
    return m;
  }, [entries]);

  // Skill selection is a query parameter, changed without a server round trip.
  const select = useCallback((skillId: string | null) => {
    window.history.pushState(null, '', skillHref(role.id, skillId));
  }, [role.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && selectedId) select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select]);

  const skills = role.skills;
  const statuses = skills.map((s) => statusOf(progress, role.id, s.id));
  const done = statuses.filter((s) => s === 'done').length;
  const doing = statuses.filter((s) => s === 'doing').length;
  const nextIdx = statuses.findIndex((s) => s !== 'done');
  const height = TOP * 2 + (skills.length - 1) * STEP;

  const trail = skills.slice(0, -1).map((_, i) => {
    const a = pos(i), b = pos(i + 1);
    const d = `M${a.x} ${a.y} C${a.x} ${a.y + STEP * 0.55}, ${b.x} ${b.y - STEP * 0.55}, ${b.x} ${b.y}`;
    return <path key={i} className={`trail${statuses[i] === 'done' ? ' done' : ''}`} d={d} />;
  });

  return (
    <div className="wrap">
      <div className="role-head">
        <Link className="back" href="/">← All roles</Link>
        <h1>{role.name}</h1>
        <p className="tagline">{role.tagline}</p>
        <div className="progress">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={skills.length} aria-valuenow={done} aria-label="Skills covered">
            <span style={{ width: `${(done / skills.length) * 100}%` }} />
          </div>
          <p><strong>You&apos;ve covered {done} of {skills.length} skills</strong>{doing ? ` · ${doing} in progress` : ''}</p>
          {nextIdx >= 0 ? (
            <p className="next">
              <a className="btn ghost" href={skillHref(role.id, skills[nextIdx].id)} onClick={(e) => { e.preventDefault(); select(skills[nextIdx].id); }}>
                Next up: {skills[nextIdx].name}
              </a>
            </p>
          ) : (
            <p className="next">Every skill on this path is marked done.</p>
          )}
        </div>
      </div>
      <div className="role-layout">
        <div className="path" style={{ height }}>
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">{trail}</svg>
          {skills.map((s, i) => {
            const p = pos(i), st = statuses[i];
            const n = bySkill.get(s.id)?.length ?? 0;
            const cls = ['node', st, i === nextIdx ? 'next' : '', s.id === selectedId ? 'selected' : ''].filter(Boolean).join(' ');
            return (
              <a
                key={s.id}
                className={cls}
                href={skillHref(role.id, s.id)}
                onClick={(e) => { e.preventDefault(); select(s.id); }}
                style={{ left: `${(p.x / W) * 100}%`, top: p.y - 44 }}
                aria-label={`${s.name}, ${n} certificates, ${STATUS_LABEL[st]}`}
                aria-current={s.id === selectedId ? 'true' : undefined}
              >
                <span className="hex"><span>{st === 'done' ? '✓' : i + 1}</span></span>
                <span className="label">{s.name}</span>
              </a>
            );
          })}
        </div>
        <a
          className={`backdrop${selected ? ' open' : ''}`}
          href={skillHref(role.id)}
          onClick={(e) => { e.preventDefault(); select(null); }}
          aria-label="Close skill details"
        />
        <aside className={`panel${selected ? ' open' : ''}`} aria-label="Skill details">
          {selected ? (
            <SkillPanel
              key={selected.id}
              role={role}
              skill={selected}
              status={statusOf(progress, role.id, selected.id)}
              entries={bySkill.get(selected.id) ?? []}
              aggs={aggs}
              onAgg={(k, agg) => setAggs((a) => ({ ...a, [k]: agg }))}
              onClose={() => select(null)}
              hasPrices={hasPrices}
              hasHours={hasHours}
            />
          ) : (
            <p className="placeholder">Select a skill on the path to see free learning resources and the certificates ranked for it.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

type PanelProps = {
  role: Role;
  skill: Skill;
  status: Status;
  entries: SkillEntry[];
  aggs: Record<string, RatingAgg>;
  onAgg: (key: string, agg: RatingAgg) => void;
  onClose: () => void;
  hasPrices: boolean;
  hasHours: boolean;
};

function SkillPanel({ role, skill, status, entries, aggs, onAgg, onClose, hasPrices, hasHours }: PanelProps) {
  const toast = useToast();
  const mine = useMyRatings();
  const [freeOnly, setFreeOnly] = useState(false);
  const [maxHours, setMaxHours] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [rating, setRating] = useState<{ key: string; stars: number; relevant: boolean | null } | null>(null);

  useEffect(() => {
    document.getElementById('panel-title')?.focus({ preventScroll: true });
  }, []);

  const prereq = (skill.prerequisites ?? []).map((id) => role.skills.find((s) => s.id === id)?.name).filter(Boolean);
  const resources = (skill.resources ?? []).map((r) => ({ ...r, url: safeUrl(r.url) })).filter((r) => r.url);
  const ranked = rankCertificates(entries, aggs, { freeOnly, maxHours }, CONFIG.RANK);
  const shown = showAll ? ranked : ranked.slice(0, CONFIG.TOP_N);

  async function saveRating(certId: string, stars: number, relevant: boolean) {
    setMyRating(certId, skill.id, { stars, relevant, synced: false });
    setRating(null);
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ certificateId: certId, skillId: skill.id, stars, relevant, clientId: anonId() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onAgg(pairKey(certId, skill.id), body.agg);
      setMyRating(certId, skill.id, { stars, relevant, synced: true });
      toast('Rating saved. It now counts toward the ranking for everyone.');
    } catch {
      toast('Saved on this device only: the server could not be reached.');
    }
  }

  return (
    <div className="panel-body">
      <a className="btn ghost close" href={skillHref(role.id)} onClick={(e) => { e.preventDefault(); onClose(); }}>Close</a>
      <h2 id="panel-title" tabIndex={-1}>{skill.name}</h2>
      <p className="desc">{skill.description}</p>
      {prereq.length > 0 && <p className="recap">Works best after: {prereq.join(', ')}</p>}
      <div className="seg" role="group" aria-label="Your progress on this skill">
        {(['todo', 'doing', 'done'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={status === v}
            onClick={() => {
              setStatus(role.id, skill.id, v);
              toast({ todo: 'Marked as not started', doing: 'Marked as in progress', done: 'Marked as done' }[v]);
            }}
          >
            {{ todo: 'Not started', doing: 'In progress', done: 'Done' }[v]}
          </button>
        ))}
      </div>

      <h3>Free ways to learn it</h3>
      {resources.length ? (
        <ul className="resources">
          {resources.map((r) => (
            <li key={r.url}>
              <a href={r.url!} target="_blank" rel="noopener noreferrer">{r.title}<small>{r.type || 'link'} ↗</small></a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No free resources listed for this skill yet.</p>
      )}

      <h3>Certificates for this skill</h3>
      {(hasPrices || hasHours) && (
        <div className="filters">
          {hasPrices && (
            <label><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free only</label>
          )}
          {hasHours && (
            <label>Time{' '}
              <select aria-label="Maximum time" value={maxHours} onChange={(e) => setMaxHours(Number(e.target.value))}>
                {[[0, 'Any'], [5, 'Up to 5 h'], [10, 'Up to 10 h'], [20, 'Up to 20 h']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {!entries.length ? (
        <p className="empty">No certificates are matched to this skill yet.</p>
      ) : !ranked.length ? (
        <p className="empty">No certificates match these filters. Clear a filter to see all of them.</p>
      ) : (
        <>
          <ol className="certs">
            {shown.map((e, i) => (
              <CertCard
                key={e.cert.id}
                entry={e}
                rank={i + 1}
                my={mine[pairKey(e.cert.id, skill.id)]}
                rating={rating?.key === pairKey(e.cert.id, skill.id) ? rating : null}
                onRate={(r) => setRating(r)}
                onSave={saveRating}
              />
            ))}
          </ol>
          {ranked.length > CONFIG.TOP_N && (
            <p className="more">
              <button type="button" className="btn ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show ${ranked.length - CONFIG.TOP_N} more`}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

type RatingDraft = { key: string; stars: number; relevant: boolean | null };

function CertCard({ entry, rank, my, rating, onRate, onSave }: {
  entry: RankedEntry;
  rank: number;
  my: MyRating | undefined;
  rating: RatingDraft | null;
  onRate: (r: RatingDraft | null) => void;
  onSave: (certId: string, stars: number, relevant: boolean) => void;
}) {
  const c = entry.cert;
  const key = pairKey(c.id, entry.skillId);
  const sum = ratingSummary(entry.agg);
  const url = safeUrl(c.url);
  return (
    <li className="cert">
      <span className="rank" aria-label={`Rank ${rank}`}>{rank}</span>
      <div>
        <h4>{c.title}</h4>
        <CertMeta c={c}><span className="badge match">{matchLabel(entry.relevance)}</span></CertMeta>
        <CertFacts c={c} />
        <CertDetails c={c} />
        <p className="rating-line">
          {sum.n && sum.avg != null ? (
            <>
              <span aria-label={`${sum.avg.toFixed(1)} out of 5`}>{starsText(sum.avg)}</span> {sum.avg.toFixed(1)}
              {sum.relevantPct != null ? ` · ${sum.relevantPct}% found it relevant` : ''} · {sum.n} rating{sum.n > 1 ? 's' : ''}
            </>
          ) : 'Not rated yet'}
        </p>
        {my && (
          <p className="rating-line"><strong>Your rating:</strong> {starsText(my.stars)} · {my.relevant ? 'relevant' : 'not relevant'}</p>
        )}
        <div className="cert-actions">
          {url && <a className="btn ghost" href={url} target="_blank" rel="noopener noreferrer">View certificate ↗</a>}
          {!rating && (
            <button type="button" className="btn ghost" onClick={() => onRate({ key, stars: my?.stars ?? 0, relevant: my ? my.relevant : null })}>
              {my ? 'Change my rating' : 'I completed this: rate it'}
            </button>
          )}
          <CompleteActions cert={c} skillId={entry.skillId} />
        </div>
        {rating && <RateForm draft={rating} onChange={onRate} onSave={(s, r) => onSave(c.id, s, r)} />}
      </div>
    </li>
  );
}

function RateForm({ draft, onChange, onSave }: { draft: RatingDraft; onChange: (r: RatingDraft | null) => void; onSave: (stars: number, relevant: boolean) => void }) {
  const ready = draft.stars > 0 && typeof draft.relevant === 'boolean';
  return (
    <div className="rate-form">
      <div>
        <strong>How was it overall?</strong>
        <div className="stars" role="group" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={draft.stars === n} className={n <= draft.stars ? 'on' : ''} onClick={() => onChange({ ...draft, stars: n })}>★</button>
          ))}
        </div>
      </div>
      <div>
        <strong>Was it relevant to this skill?</strong>
        <div className="row">
          {([['Yes', true], ['No', false]] as const).map(([label, v]) => (
            <button key={label} type="button" className="btn ghost" aria-pressed={draft.relevant === v} style={draft.relevant === v ? { borderColor: 'var(--ink)' } : undefined} onClick={() => onChange({ ...draft, relevant: v })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={!ready} onClick={() => ready && onSave(draft.stars, draft.relevant as boolean)}>Save rating</button>
        <button type="button" className="btn ghost" onClick={() => onChange(null)}>Cancel</button>
      </div>
      <p className="fine">Anonymous. Your rating helps rank this certificate for other students.</p>
    </div>
  );
}
