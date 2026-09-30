import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';
import { pino } from 'pino';
import { readConfig } from './config.js';
import { PostgresRepository } from './postgres.js';
import { RedisFanout } from './redis.js';
import { createSyncServer } from './server.js';

dotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const config = readConfig();
const logger = pino({ level: config.LOG_LEVEL });
const repository = new PostgresRepository(config.DATABASE_URL);
repository.pool.on('error', (err) => logger.error({ err }, 'Idle database connection error'));
const fanout = config.REDIS_URL ? new RedisFanout(config.REDIS_URL, logger) : undefined;
const app = createSyncServer({ config, repository, logger, ...(fanout ? { fanout } : {}) });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => { logger.fatal('Shutdown timed out; pending writes may remain'); process.exit(1); }, 20000);
  try { await app.close(); logger.info('Sync server stopped'); }
  catch (err) { logger.fatal({ err }, 'Shutdown failed'); process.exitCode = 1; }
  finally { clearTimeout(deadline); process.disconnect?.(); if (process.exitCode) process.exit(process.exitCode); }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
process.on('message', (message) => { if (message === 'shutdown') void stop(); });
app.server.on('error', (err) => { logger.error({ err }, 'Server error'); process.exitCode = 1; void stop(); });
app.server.listen(config.PORT, config.SYNC_HOST, () => {
  logger.info({ address: app.server.address(), redisEnabled: Boolean(fanout) }, 'Sync server listening'); process.send?.('ready');
});
