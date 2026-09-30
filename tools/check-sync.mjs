import assert from 'node:assert/strict';
import { spawn, fork } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const stopFile = fileURLToPath(new URL('../.pglite/sync-smoke.stop', import.meta.url));
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres', COLLAB_TOKEN_SECRET: 'smoke-collab-secret', INTERNAL_API_SECRET: 'smoke-internal-secret', REDIS_URL: '', PORT: '1234', SYNC_HOST: '127.0.0.1' };
let database; let sync;
function completed(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return once(child, 'exit').then(([code]) => code);
}
async function run(args) {
  const child = spawn(process.execPath, [npm, ...args], { cwd: root, env, stdio: 'inherit' });
  assert.equal(await completed(child), 0, args.join(' ') + ' failed');
}
async function ready(child, predicate) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Startup timeout')), 30000);
    function finish(error) { clearTimeout(timer); child.off('exit', exited); child.off('message', message); child.stdout?.off('data', output); if (error) reject(error); else resolve(); }
    function exited(code) { finish(new Error('Unexpected exit: ' + code)); }
    function message(value) { if (predicate(value)) finish(); }
    function output(value) { if (predicate(value.toString())) finish(); }
    child.once('exit', exited); child.on('message', message); child.stdout?.on('data', output);
  });
}
async function stop(child, request) {
  if (!child || child.exitCode !== null) return;
  const exited = completed(child); await request();
  const timer = setTimeout(() => child.kill(), 10000);
  try { await exited; } finally { clearTimeout(timer); }
}
try {
  await rm(stopFile, { force: true });
  database = spawn(process.execPath, [npm, 'run', 'db:local', '--', '--shutdown-file', stopFile], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  database.stdout.pipe(process.stdout);
  await ready(database, (value) => String(value).includes('PGlite listening'));
  await run(['run', 'db:migrate']);
  sync = fork(fileURLToPath(new URL('../apps/sync-server/dist/index.js', import.meta.url)), [], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await ready(sync, (value) => value === 'ready');
  const response = await fetch('http://127.0.0.1:1234/health'); assert.equal(response.status, 200);
  const health = await response.json(); assert.equal(health.db, 'ok'); assert.equal(health.redis.enabled, false);
  console.log('Sync health:', JSON.stringify(health));
  await run(['test']);
} finally {
  await stop(sync, () => sync.send('shutdown'));
  await stop(database, () => writeFile(stopFile, 'stop'));
  await rm(stopFile, { force: true });
  console.log('Sync and local database stopped.');
}
