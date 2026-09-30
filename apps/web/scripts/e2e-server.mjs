import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const require = createRequire(import.meta.url);
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  AUTH_URL: 'http://127.0.0.1:3310',
  AUTH_TRUST_HOST: 'true',
  AUTH_SECRET: randomBytes(32).toString('hex'),
  COLLAB_TOKEN_SECRET: randomBytes(32).toString('hex'),
  INTERNAL_API_SECRET: randomBytes(32).toString('hex'),
  NEXT_PUBLIC_SYNC_URL: 'ws://127.0.0.1:1310',
  SYNC_INTERNAL_URL: 'http://127.0.0.1:1310',
  SYNC_HOST: '127.0.0.1',
  PORT: '1310',
  REDIS_URL: '',
  AUTH_GITHUB_ID: '',
  AUTH_GITHUB_SECRET: '',
};
let database;
let socket;
let sync;
let stopping;
let stopPoll;
const children = new Set();

function start(script, args = [], cwd = root) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function run(script, args) {
  const [code] = await once(start(script, args), 'exit');
  if (code !== 0) throw new Error(`${script} failed (${code})`);
}

async function assertPortFree(port) {
  const probe = createServer();
  probe.listen(port, '127.0.0.1');
  await once(probe, 'listening');
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}

async function stop() {
  clearInterval(stopPoll);
  for (const child of children) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await sync?.close();
  await socket?.stop();
  await database?.close();
  if (env.E2E_SHUTDOWN_FILE) await rm(env.E2E_SHUTDOWN_FILE, { force: true });
}

function shutdown() {
  return (stopping ??= stop().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown());

try {
  // Never reuse a developer server or database. PGlite is isolated and in memory.
  await assertPortFree(3310);
  await assertPortFree(1310);
  if (env.E2E_USE_PGLITE === '1' || !env.DATABASE_URL) {
    database = await PGlite.create();
    socket = new PGLiteSocketServer({
      db: database,
      host: '127.0.0.1',
      port: 0,
      maxConnections: 20,
    });
    await socket.start();
    env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
  }
  await run(join(root, 'packages/shared/scripts/migrate.mjs'), []);
  if (!process.env.npm_execpath) throw new Error('Start E2E through npm run e2e.');
  if (env.E2E_SKIP_BUILD === '1') {
    await access(join(root, 'apps/web/.next/BUILD_ID'));
    await access(join(root, 'apps/sync-server/dist/server.js'));
  } else {
    await run(process.env.npm_execpath, ['run', 'build']);
  }

  const { readConfig } = await import('../../sync-server/dist/config.js');
  const { PostgresRepository } = await import('../../sync-server/dist/postgres.js');
  const { createSyncServer } = await import('../../sync-server/dist/server.js');
  const repository = new PostgresRepository(env.DATABASE_URL);
  repository.pool.on('error', (error) => console.error('Database pool error', error));
  sync = createSyncServer({ config: readConfig(env), repository });
  sync.server.listen(1310, '127.0.0.1');
  await once(sync.server, 'listening');
  await repository.health();
  if (env.E2E_SHUTDOWN_FILE) {
    stopPoll = setInterval(() => {
      if (existsSync(env.E2E_SHUTDOWN_FILE)) void shutdown();
    }, 100);
  }
  const web = start(
    require.resolve('next/dist/bin/next'),
    ['start', '--hostname', '127.0.0.1', '--port', '3310'],
    join(root, 'apps/web'),
  );
  web.once('error', () => void shutdown());
  web.once('exit', (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      void shutdown();
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await shutdown();
}
