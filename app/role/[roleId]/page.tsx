import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { RolePath } from '@/components/RolePath';
import { current } from '@/lib/data';
import { getRatingAggs, getSkillEntries } from '@/lib/repo';
import { findRole } from '@/lib/roles';

type Params = { params: Promise<{ roleId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const role = findRole((await params).roleId);
  return { title: role ? `${role.name} · BeePath` : 'BeePath' };
}

export default async function RolePage({ params }: Params) {
  const role = findRole((await params).roleId);
  if (!role || role.status !== 'available') {
    return (
      <div className="state">
        <h1>That role isn&apos;t available yet</h1>
        <p><Link href="/">Back to all roles</Link></p>
      </div>
    );
  }
  const { db, dataset, info } = await current();
  const skillIds = role.skills.map((s) => s.id);
  const [entries, aggs] = await Promise.all([getSkillEntries(db, dataset, skillIds), getRatingAggs(db, dataset, skillIds)]);
  return (
    <Suspense>
      <RolePath role={role} entries={entries} aggs={aggs} hasPrices={info.hasPrices} hasHours={info.hasHours} />
    </Suspense>
  );
}
