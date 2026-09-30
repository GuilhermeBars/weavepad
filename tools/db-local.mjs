import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
const db = await PGlite.create(fileURLToPath(new URL('../.pglite', import.meta.url)));
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5432, maxConnections: 10 });
let stopping = false;
// Finite smoke-test harnesses can stop an npm-launched child gracefully on Windows.
const stopFlagIndex = process.argv.indexOf('--shutdown-file');
const stopFile = stopFlagIndex === -1 ? undefined : process.argv[stopFlagIndex + 1];
let stopPoll;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(stopPoll);
  await server.stop();
  await db.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
// Allows test harnesses to shut down gracefully on Windows as well as Unix.
process.on('message', (message) => { if (message === 'shutdown') void stop().finally(() => process.disconnect?.()); });
process.once('disconnect', () => { void stop(); });
try {
  await server.start();
  if (stopFile) stopPoll = setInterval(() => { if (existsSync(stopFile)) void stop(); }, 100);
  console.log('PGlite listening on 127.0.0.1:5432 (persistent .pglite/)');
  process.send?.('ready');
} catch (error) { await db.close(); throw error; }
