import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@weavepad/shared/db/schema';

const globalDb = globalThis as typeof globalThis & { weavepadPool?: Pool };
const pool = globalDb.weavepadPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
globalDb.weavepadPool = pool;
export const db = drizzle(pool, { schema });
export const repository = {
  async role(documentId: string, userId: string) {
    const [member] = await db.select({ role: schema.documentMembers.role }).from(schema.documentMembers)
      .where(and(eq(schema.documentMembers.documentId, documentId), eq(schema.documentMembers.userId, userId)));
    return member?.role ?? null;
  },
};
