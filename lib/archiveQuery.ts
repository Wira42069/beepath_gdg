// Archive filter state <-> URL query. Shared by the server page and the client filter bar.

export type ArchiveFilterValues = { q: string; skill: string; cat: string; free: boolean; hours: number; all: boolean };

export function toQuery(v: ArchiveFilterValues, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (v.q.trim()) p.set('q', v.q.trim());
  if (v.skill) p.set('skill', v.skill);
  if (v.cat) p.set('cat', v.cat);
  if (v.free) p.set('free', '1');
  if (v.hours) p.set('hours', String(v.hours));
  if (v.all) p.set('all', '1');
  for (const [k, val] of Object.entries(extra)) p.set(k, val);
  const s = p.toString();
  return s ? `?${s}` : '';
}
