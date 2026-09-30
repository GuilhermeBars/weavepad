import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@weavepad/shared/db/schema';

const globalDb = globalThis as typeof globalThis & { weavepadPool?: Pool };
function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  // Idle connection errors must not become unhandled EventEmitter exceptions.
  pool.on('error', () => console.error('Idle database connection failed'));
  return pool;
}
const pool = globalDb.weavepadPool ?? createPool();
globalDb.weavepadPool = pool;
export const db = drizzle(pool, { schema });
export const repository = {
  async role(documentId: string, userId: string) {
    const [member] = await db
      .select({ role: schema.documentMembers.role })
      .from(schema.documentMembers)
      .where(
        and(
          eq(schema.documentMembers.documentId, documentId),
          eq(schema.documentMembers.userId, userId),
        ),
      );
    return member?.role ?? null;
  },
};
