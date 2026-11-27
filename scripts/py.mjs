#!/usr/bin/env node
// Runs a Python script with whichever interpreter this machine has (python3 on macOS/Linux,
// python or py on Windows), so npm scripts work everywhere.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
for (const cmd of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error?.code === 'ENOENT') continue;
  // The Windows Store "python3" alias exits 9009 without running anything; try the next name.
  if (r.status === 9009) continue;
  process.exit(r.status ?? 1);
}
console.error('Python 3 was not found. Install it from https://www.python.org/downloads/');
process.exit(1);
