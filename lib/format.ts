import type { Certificate, Price } from './types';

/** Certificate data comes from a scrape, so only http(s) links are ever rendered. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
}

export function fmtPrice(p: Price | null): string | null {
  if (!p || typeof p.amount !== 'number') return null;
  if (p.amount === 0) return 'Free';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: p.currency || 'IDR', maximumFractionDigits: 0 }).format(p.amount);
}

export function fmtDuration(c: Pick<Certificate, 'hours' | 'durationText'>): string | null {
  if (typeof c.hours === 'number') return `about ${c.hours} h`;
  return c.durationText || null;
}

export const starsText = (avg: number) => '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));

/** "DICODING · Amazon Web Services" when the programme runner and the credential owner differ. */
export function issuerLine(c: Pick<Certificate, 'issuer' | 'institution'>): string {
  if (!c.issuer) return c.institution || 'Issuer not listed';
  if (c.institution && c.institution.toLowerCase() !== c.issuer.toLowerCase()) return `${c.issuer} · ${c.institution}`;
  return c.issuer;
}

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
