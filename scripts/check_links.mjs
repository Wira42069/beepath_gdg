#!/usr/bin/env node
// Checks every free-resource link in data/roles.json. Run before a demo or recording.
//   node scripts/check_links.mjs
// Exit code 1 if a link is broken (4xx/5xx other than "blocked for bots", or unreachable).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roles = JSON.parse(fs.readFileSync(path.join(root, 'data', 'roles.json'), 'utf8'));
const links = new Map(); // url -> [where]
for (const r of roles) for (const s of r.skills) for (const res of s.resources ?? []) {
  if (!links.has(res.url)) links.set(res.url, []);
  links.get(res.url).push(`${r.id}/${s.id}`);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return { ok: true, status: res.status, final: res.url };
      if (method === 'HEAD' && res.status >= 400) continue; // many sites reject HEAD
      return { ok: res.status === 403 || res.status === 429, blocked: res.status === 403 || res.status === 429, status: res.status, final: res.url };
    } catch (err) {
      if (method === 'GET') return { ok: false, status: String(err.cause?.code ?? err.name ?? err.message) };
    }
  }
  return { ok: false, status: '?' };
}

const results = [];
const queue = [...links.keys()];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const url = queue.shift();
    results.push({ url, ...(await check(url)) });
  }
}));

let broken = 0;
for (const r of results.sort((a, b) => Number(a.ok) - Number(b.ok))) {
  const moved = r.final && r.final.replace(/\/$/, '') !== r.url.replace(/\/$/, '') ? ` -> ${r.final}` : '';
  const tag = !r.ok ? 'BROKEN ' : r.blocked ? 'blocked' : 'ok     ';
  if (!r.ok) broken += 1;
  console.log(`${tag} ${r.status}  ${r.url}${moved}  (${links.get(r.url).join(', ')})`);
}
console.log(`\n${results.length} links, ${broken} broken. "blocked" = the site refuses scripts; open it once by hand.`);
process.exit(broken ? 1 : 0);
