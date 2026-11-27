import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // libSQL ships a native module for local SQLite files; keep it out of the bundle.
  serverExternalPackages: ['@libsql/client', 'libsql'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
