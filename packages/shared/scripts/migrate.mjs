import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; see .env.example');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
