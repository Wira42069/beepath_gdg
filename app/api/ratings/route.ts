// POST /api/ratings  { certificateId, skillId, stars (1-5), relevant (bool), clientId }
// Saves or replaces this browser's anonymous rating and returns the pair's new aggregate.
import { NextResponse } from 'next/server';
import { current } from '@/lib/data';
import { RatingError, saveRating } from '@/lib/repo';

export async function POST(req: Request) {
  // Only the app's own pages post ratings. Compare with the Host the browser used (req.url can
  // carry the server's bind address instead); on Vercel the public host is in x-forwarded-host.
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: 'Cross-site requests are not accepted' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send a JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send a JSON object' }, { status: 400 });
  try {
    const { db, dataset } = await current();
    const agg = await saveRating(db, dataset, body as Record<string, unknown> as never);
    return NextResponse.json({ agg });
  } catch (err) {
    if (err instanceof RatingError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Saving a rating failed:', err);
    return NextResponse.json({ error: 'Could not save the rating' }, { status: 500 });
  }
}
