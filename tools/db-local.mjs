import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
const db = await PGlite.create(fileURLToPath(new URL('../.pglite', import.meta.url)));
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5432, maxConnections: 10 });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
// Allows test harnesses to shut down gracefully on Windows as well as Unix.
process.on('message', (message) => { if (message === 'shutdown') void stop().finally(() => process.disconnect?.()); });
process.once('disconnect', () => { void stop(); });
try {
  await server.start();
  console.log('PGlite listening on 127.0.0.1:5432 (persistent .pglite/)');
  process.send?.('ready');
} catch (error) { await db.close(); throw error; }
