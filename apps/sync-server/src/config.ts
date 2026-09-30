import { z } from 'zod';

const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const schema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(1234),
  SYNC_HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  COLLAB_TOKEN_SECRET: z.string().trim().min(1),
  INTERNAL_API_SECRET: z.string().trim().min(1),
  REDIS_URL: z.string().url().optional(),
  FLUSH_INTERVAL_MS: positive(1000),
  COMPACT_AFTER_UPDATES: positive(100),
  ROOM_IDLE_MS: positive(1000),
  PING_INTERVAL_MS: positive(30000),
  MAX_PAYLOAD_BYTES: positive(1024 * 1024),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse({
    ...env,
    PORT: env.PORT ?? env.SYNC_PORT,
    REDIS_URL: env.REDIS_URL || undefined,
  });
}
