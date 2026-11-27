import Link from 'next/link';
import { current } from '@/lib/data';
import { countMapped } from '@/lib/repo';
import { ROLES, availableRoles } from '@/lib/roles';

export default async function Home() {
  const { db, dataset, info } = await current();
  const skillIds = availableRoles().flatMap((r) => r.skills.map((s) => s.id));
  const mapped = await countMapped(db, dataset, skillIds);

  return (
    <div className="wrap">
      <section className="hero">
        <h1>What role do you want to work toward?</h1>
        <p>Pick a role, follow its skill path, and see a short list of certificates worth your time at each step.</p>
      </section>
      <ul className="role-grid">
        {ROLES.map((r) => (
          <li key={r.id}>
            {r.status === 'available' ? (
              <Link className="role-card" href={`/role/${r.id}`}>
                <span className="icon" aria-hidden="true">{r.icon}</span>
                <h2>{r.name}</h2>
                <p>{r.tagline}</p>
                <span className="tag">{r.skills.length} skills · Start path</span>
              </Link>
            ) : (
              <div className="role-card soon" aria-disabled="true">
                <span className="icon" aria-hidden="true">{r.icon}</span>
                <h2>{r.name}</h2>
                <p>{r.tagline}</p>
                <span className="tag">Coming soon</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="archive-note">
        The {info.isSample ? 'sample ' : ''}archive has {info.certificates} entries. {mapped} of them are matched to a skill in the available
        roles, so you see those instead of scrolling the whole list. <Link href="/archive">Browse the whole archive with filters</Link>.
      </p>
    </div>
  );
}
