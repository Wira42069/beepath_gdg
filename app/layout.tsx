import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { TopBar, Footer } from '@/components/Chrome';
import { ToastProvider } from '@/components/Toast';
import { current } from '@/lib/data';

export const metadata: Metadata = {
  title: 'BeePath',
  description: 'Pick a tech role, follow its skill path, and see a short list of certificates worth your time at each step.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Every page reads the database (ratings change as students rate), so nothing is prerendered.
export const dynamic = 'force-dynamic';

function SetupHelp({ message }: { message: string }) {
  return (
    <div className="setup">
      <h1>BeePath needs its data</h1>
      <p>{message}</p>
      <pre>npm run db:seed</pre>
      <p className="fine">Locally this fills <code>.data/beepath.db</code>. On Vercel, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN and seed the Turso database the same way.</p>
    </div>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  let info = null;
  let setupError: string | null = null;
  try {
    ({ info } = await current());
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
  }
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <ToastProvider>
          <TopBar label={info ? info.meta.label || info.meta.dataSource : 'Setup needed'} isSample={info?.isSample ?? true} />
          {info?.isSample && (
            <p className="banner"><strong>Prototype on sample data.</strong> {info.meta.notice}</p>
          )}
          <main id="main" tabIndex={-1}>{setupError ? <SetupHelp message={setupError} /> : children}</main>
          <Footer dataset={info?.name ?? ''} />
        </ToastProvider>
      </body>
    </html>
  );
}
