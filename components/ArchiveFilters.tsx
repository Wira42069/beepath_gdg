'use client';
// Archive filters live in the URL (shareable, back-button friendly); the server does the filtering.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toQuery, type ArchiveFilterValues } from '@/lib/archiveQuery';

type Props = {
  values: ArchiveFilterValues;
  skillGroups: { role: string; skills: { id: string; name: string }[] }[];
  categories: string[];
  hasPrices: boolean;
  hasHours: boolean;
  unrelatedHidden: number;
};

export function ArchiveFilters({ values, skillGroups, categories, hasPrices, hasHours, unrelatedHidden }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(values);
  const [q, setQ] = useState(values.q);
  const first = useRef(true);
  const lastSentQ = useRef(values.q);

  const apply = (next: ArchiveFilterValues) => {
    setV(next);
    lastSentQ.current = next.q;
    startTransition(() => router.replace(`/archive${toQuery(next)}`, { scroll: false }));
  };

  // Back/forward navigation changes the URL under us: follow it, without clobbering text being typed.
  const urlKey = toQuery(values);
  useEffect(() => {
    setV(values);
    if (values.q !== lastSentQ.current) {
      lastSentQ.current = values.q;
      setQ(values.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // Typing: wait for a pause before asking the server.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => apply({ ...v, q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="filters arch-filters">
      <label>Search{' '}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, code, issuer, topic" aria-label="Search certificates" maxLength={100} />
      </label>
      <label>Skill{' '}
        <select aria-label="Filter by skill" value={v.skill} onChange={(e) => apply({ ...v, skill: e.target.value })}>
          <option value="">Any skill</option>
          {skillGroups.map((g) => (
            <optgroup key={g.role} label={g.role}>
              {g.skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {categories.length > 0 && (
        <label>Category{' '}
          <select aria-label="Filter by category" value={v.cat} onChange={(e) => apply({ ...v, cat: e.target.value })}>
            <option value="">Any category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {hasPrices && (
        <label><input type="checkbox" checked={v.free} onChange={(e) => apply({ ...v, free: e.target.checked })} /> Free only</label>
      )}
      {hasHours && (
        <label>Time{' '}
          <select aria-label="Maximum time" value={v.hours} onChange={(e) => apply({ ...v, hours: Number(e.target.value) })}>
            {[[0, 'Any'], [5, 'Up to 5 h'], [10, 'Up to 10 h'], [20, 'Up to 20 h']].map(([val, l]) => <option key={val} value={val}>{l}</option>)}
          </select>
        </label>
      )}
      {(unrelatedHidden > 0 || v.all) && (
        <label><input type="checkbox" checked={v.all} onChange={(e) => apply({ ...v, all: e.target.checked })} /> Include unrelated entries{unrelatedHidden ? ` (${unrelatedHidden})` : ''}</label>
      )}
      {pending && <span className="pending" aria-live="polite">Updating…</span>}
    </div>
  );
}
