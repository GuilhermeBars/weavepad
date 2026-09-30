import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export default defineConfig({
  dialect: 'postgresql',
  schema: fileURLToPath(new URL('./src/db/schema.ts', import.meta.url)).replaceAll('\\', '/'),
  out: relative(process.cwd(), fileURLToPath(new URL('./drizzle', import.meta.url))).replaceAll('\\', '/'),
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres' },
});
