import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createHealthServer } from './server.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const port = Number(process.env.SYNC_PORT ?? 1234);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SYNC_PORT must be 1..65535');
const host = process.env.SYNC_HOST ?? '127.0.0.1';
const server = createHealthServer();
server.listen(port, host, () => console.log(`Sync server listening on http://${host}:${port}`));
server.on('error', (error) => { console.error(error); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}
