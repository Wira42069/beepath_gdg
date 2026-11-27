// Database connection. Turso in production, a local SQLite file in development.
//
//   TURSO_DATABASE_URL   libsql://<db>-<org>.turso.io   (unset = local file .data/beepath.db)
//   TURSO_AUTH_TOKEN     token for that database
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { applySchema } from './schema.mjs';

export function databaseUrl(): string {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  if (process.env.VERCEL) {
    throw new Error('TURSO_DATABASE_URL is not set. On Vercel the app needs a Turso database (see README, "Deploy").');
  }
  const dir = path.join(process.cwd(), '.data');
  fs.mkdirSync(dir, { recursive: true });
  return `file:${path.join(dir, 'beepath.db')}`;
}

export function openClient(url = databaseUrl()): Client {
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
}

let shared: { client: Client; ready: Promise<void> } | null = null;

/** One client per server process; the schema is applied once, on first use. */
export async function getDb(): Promise<Client> {
  if (!shared) {
    const client = openClient();
    shared = { client, ready: applySchema(client) };
    shared.ready.catch(() => { shared = null; }); // let the next request retry
  }
  await shared.ready;
  return shared.client;
}
