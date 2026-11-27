'use client';
// Pieces shared by the role panel and the archive list.
import { linkedinUrl } from '@/lib/cv';
import { fmtDuration, fmtPrice, issuerLine, thisMonth } from '@/lib/format';
import { setCompleted, useCompleted } from '@/lib/store';
import type { Certificate } from '@/lib/types';
import { useToast } from './Toast';

export function CertMeta({ c, children }: { c: Certificate; children?: React.ReactNode }) {
  const credit = c.creditEarning && !/^non/i.test(c.creditEarning);
  return (
    <p className="meta">
      {issuerLine(c)}
      {c.code && <span className="badge code" title="Search this code in the Binus certification app to submit it">{c.code}</span>}
      {c.sample && <span className="badge sample">Sample</span>}
      {c.providerType === 'campus' && <span className="badge">Campus</span>}
      {credit && <span className="badge done" title={c.creditEarning ?? ''}>Credit earning</span>}
      {children}
    </p>
  );
}

export function CertFacts({ c }: { c: Certificate }) {
  const facts = [fmtPrice(c.price), fmtDuration(c), c.level].filter(Boolean) as string[];
  if (!facts.length) return null;
  return <ul className="facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>;
}

export function CertDetails({ c, open = false }: { c: Certificate; open?: boolean }) {
  if (!c.description && !c.outcomes) return null;
  return (
    <details open={open}>
      <summary>What it covers</summary>
      {c.description && <p>{c.description}</p>}
      {c.outcomes && <p><strong>Learning outcomes:</strong> {c.outcomes}</p>}
    </details>
  );
}

export function CompleteActions({ cert, skillId }: { cert: Certificate; skillId: string | null }) {
  const completed = useCompleted();
  const toast = useToast();
  const done = completed[cert.id];
  if (done) {
    return (
      <>
        <span className="badge done">Completed ✓</span>
        <a className="btn ghost" href={linkedinUrl(cert, done.completedOn)} target="_blank" rel="noopener noreferrer">Add to LinkedIn ↗</a>
      </>
    );
  }
  return (
    <button
      type="button"
      className="btn ghost"
      onClick={() => {
        setCompleted(cert.id, skillId, thisMonth());
        toast('Added to My progress');
      }}
    >
      Mark as completed
    </button>
  );
}
