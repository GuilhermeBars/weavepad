import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { documents, documentState, documentUpdates, snapshots } from '@weavepad/shared/db/schema';
import { mergeState, type Repository } from './repository.js';

export class PostgresRepository implements Repository {
  readonly pool: Pool;
  private readonly db;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    this.db = drizzle(this.pool);
  }
  async health() { await this.db.execute(sql`select 1`); }
  private async locked<T>(id: string, operation: (tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0]) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).for('update');
      if (!rows.length) throw new Error('Document not found');
      return operation(tx);
    });
  }
  async load(id: string) {
    return this.locked(id, async (tx) => {
      const states = await tx.select().from(documentState).where(eq(documentState.documentId, id));
      const updates = await tx.select().from(documentUpdates).where(eq(documentUpdates.documentId, id)).orderBy(asc(documentUpdates.id));
      return [...states.map((r) => r.state), ...updates.map((r) => r.update)];
    });
  }
  async append(id: string, updates: Uint8Array[]) {
    if (!updates.length) return;
    await this.locked(id, async (tx) => {
      await tx.insert(documentUpdates).values(updates.map((update) => ({ documentId: id, update: Buffer.from(update) })));
      await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
    });
  }
  async compact(id: string) {
    await this.locked(id, async (tx) => {
      const states = await tx.select().from(documentState).where(eq(documentState.documentId, id));
      const updates = await tx.select().from(documentUpdates).where(eq(documentUpdates.documentId, id)).orderBy(asc(documentUpdates.id));
      const state = Buffer.from(mergeState([...states.map((r) => r.state), ...updates.map((r) => r.update)]));
      await tx.insert(documentState).values({ documentId: id, state }).onConflictDoUpdate({ target: documentState.documentId, set: { state, updatedAt: new Date() } });
      await tx.delete(documentUpdates).where(eq(documentUpdates.documentId, id));
    });
  }
  async createSnapshot(documentId: string, label: string, createdBy: string, state: Uint8Array) {
    const [snapshot] = await this.db.insert(snapshots).values({ documentId, label, createdBy, state: Buffer.from(state) }).returning();
    if (!snapshot) throw new Error('Snapshot insert returned no row');
    return snapshot;
  }
  async getSnapshot(id: string, snapshotId: string) {
    const [snapshot] = await this.db.select().from(snapshots).where(and(eq(snapshots.documentId, id), eq(snapshots.id, snapshotId)));
    return snapshot;
  }
  async close() { await this.pool.end(); }
}
