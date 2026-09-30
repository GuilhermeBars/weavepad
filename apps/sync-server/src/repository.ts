import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';

/** A deleted document is terminal, unlike a transient database outage. */
export class DocumentDeletedError extends Error {
  constructor() { super('Document not found'); this.name = 'DocumentDeletedError'; }
}

export interface Snapshot {
  id: string; documentId: string; label: string; createdBy: string; createdAt: Date; state: Uint8Array;
}
export type SnapshotMetadata = Omit<Snapshot, 'state'>;
export function metadata({ state: _state, ...rest }: Snapshot): SnapshotMetadata {
  void _state;
  return rest;
}
export interface Repository {
  health(): Promise<void>;
  load(id: string): Promise<Uint8Array[]>;
  append(id: string, updates: Uint8Array[]): Promise<void>;
  /** Atomically merge persisted state and log; never overwrite with a stale room state. */
  compact(id: string): Promise<void>;
  createSnapshot(id: string, label: string, userId: string, state: Uint8Array): Promise<Snapshot>;
  getSnapshot(id: string, snapshotId: string): Promise<Snapshot | undefined>;
  close(): Promise<void>;
}
export function mergeState(updates: Uint8Array[]): Uint8Array {
  const doc = new Y.Doc();
  try {
    for (const update of updates) Y.applyUpdate(doc, update);
    return Y.encodeStateAsUpdate(doc);
  } finally { doc.destroy(); }
}
/** Test/development repository, intentionally without foreign-key fixtures. */
export class MemoryRepository implements Repository {
  readonly states = new Map<string, Uint8Array>();
  readonly updates = new Map<string, Uint8Array[]>();
  readonly snapshots = new Map<string, Snapshot>();
  async health() {}
  async load(id: string) {
    const state = this.states.get(id);
    return [...(state ? [state] : []), ...(this.updates.get(id) ?? [])].map((u) => u.slice());
  }
  async append(id: string, updates: Uint8Array[]) {
    this.updates.set(id, [...(this.updates.get(id) ?? []), ...updates.map((u) => u.slice())]);
  }
  async compact(id: string) {
    const state = this.states.get(id);
    this.states.set(id, mergeState([...(state ? [state] : []), ...(this.updates.get(id) ?? [])]));
    this.updates.delete(id);
  }
  async createSnapshot(documentId: string, label: string, createdBy: string, state: Uint8Array) {
    const snapshot = { id: randomUUID(), documentId, label, createdBy, state: state.slice(), createdAt: new Date() };
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }
  async getSnapshot(id: string, snapshotId: string) {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot?.documentId === id ? snapshot : undefined;
  }
  async close() {}
}
