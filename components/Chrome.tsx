'use client';
// Top bar and footer. Client components only for the active-nav highlight and the export button.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { exportRatings } from '@/lib/store';
import { download } from './Toast';

const Logo = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="#f2a900" />
    <polygon points="32,14 47,23 47,41 32,50 17,41 17,23" fill="#0c2f3a" />
    <polygon points="32,24 40,28.5 40,37.5 32,42 24,37.5 24,28.5" fill="#f2a900" />
  </svg>
);

export function TopBar({ label, isSample }: { label: string; isSample: boolean }) {
  const path = usePathname();
  const current = path.startsWith('/archive') ? '/archive' : path.startsWith('/me') ? '/me' : '/';
  const link = (href: string, text: string) => (
    <Link href={href} aria-current={current === href ? 'page' : undefined}>{text}</Link>
  );
  return (
    <header className="topbar">
      <Link className="brand" href="/"><Logo />BeePath</Link>
      <nav className="nav" aria-label="Main">
        {link('/', 'Roles')}
        {link('/archive', 'Archive')}
        {link('/me', 'My progress')}
      </nav>
      <span className={`pill${isSample ? '' : ' real'}`}>{label}</span>
    </header>
  );
}

export function Footer({ dataset }: { dataset: string }) {
  return (
    <footer className="footer">
      <p>Student prototype for STACK 2026. Not an official Binus system.</p>
      <p>No login. Your progress stays in this browser. Ratings are anonymous and shared, so they help rank certificates for other students.</p>
      <p>
        <button type="button" onClick={() => download('beepath-my-ratings.json', JSON.stringify(exportRatings(dataset), null, 2), 'application/json')}>
          Export my ratings (JSON)
        </button>
      </p>
    </footer>
  );
}
