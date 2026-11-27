// GET /api/certificates?ids=a,b,c  -> the certificates (and the skills each is placed on).
// Used by My progress, whose list of completed certificates lives in the browser.
import { NextResponse } from 'next/server';
import { current } from '@/lib/data';
import { getCertificatesByIds, getSkillsForCerts } from '@/lib/repo';

export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s))
    .slice(0, 200);
  if (!ids.length) return NextResponse.json({ certificates: [] });
  try {
    const { db, dataset } = await current();
    const [certs, skills] = await Promise.all([getCertificatesByIds(db, dataset, ids), getSkillsForCerts(db, dataset, ids)]);
    return NextResponse.json({ certificates: certs.map((c) => ({ ...c, skills: (skills[c.id] ?? []).map((s) => s.skillId) })) });
  } catch (err) {
    console.error('Loading certificates failed:', err);
    return NextResponse.json({ error: 'Could not load certificates' }, { status: 500 });
  }
}
