import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { Pool } from 'pg';
import { signCollabToken } from '@weavepad/shared/tokens';
import { snapshotToPlainText, type Role } from '@weavepad/shared';
import { readConfig } from './config.js';
import {
  DocumentDeletedError,
  MemoryRepository,
  mergeState,
  type Repository,
} from './repository.js';
import { PostgresRepository } from './postgres.js';
import { createSyncServer } from './server.js';
import type { Fanout, FanoutEvent } from './redis.js';

const secret = 'test-collab-secret';
const userId = randomUUID();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function token(docId: string, role: Role = 'editor', exp = Math.floor(Date.now() / 1000) + 300) {
  return signCollabToken({ docId, userId, name: 'Test', color: '#123456', role, exp }, secret);
}
function replace(doc: Y.Doc, value: string) {
  doc.transact(() => {
    const fragment = doc.getXmlFragment('default');
    fragment.delete(0, fragment.length);
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, value);
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
  });
}
const plain = (doc: Y.Doc) => snapshotToPlainText(Y.encodeStateAsUpdate(doc));
async function start(
  repository: Repository = new MemoryRepository(),
  overrides: NodeJS.ProcessEnv = {},
  fanout?: Fanout,
) {
  const config = readConfig({
    DATABASE_URL: 'postgresql://localhost/test',
    COLLAB_TOKEN_SECRET: secret,
    INTERNAL_API_SECRET: 'internal-test',
    LOG_LEVEL: 'silent',
    ROOM_IDLE_MS: '30',
    FLUSH_INTERVAL_MS: '20',
    ...overrides,
  });
  const app = createSyncServer({ config, repository, ...(fanout ? { fanout } : {}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const clients: WebsocketProvider[] = [];
  cleanups.push(async () => {
    for (const client of clients) {
      client.destroy();
      client.awareness.destroy();
      client.doc.destroy();
    }
    await app.close();
  });
  async function client(id: string, role: Role = 'editor', doc = new Y.Doc()) {
    const provider = new WebsocketProvider(base.replace('http:', 'ws:'), id, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      params: { token: token(id, role) },
      disableBc: true,
    });
    clients.push(provider);
    await vi.waitFor(() => expect(provider.synced).toBe(true));
    return provider;
  }
  async function api(id: string, action: string, payload?: unknown, authorized = true) {
    return fetch(`${base}/internal/docs/${id}/${action}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        ...(authorized ? { authorization: 'Bearer internal-test' } : {}),
        'content-type': 'application/json',
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  }
  return { app, base, client, api, repository };
}
it('converges two real y-websocket clients and cleans awareness on disconnect', async () => {
  const { client } = await start();
  const id = randomUUID();
  const a = await client(id);
  const b = await client(id);
  replace(a.doc, 'Hello');
  await vi.waitFor(() => expect(plain(b.doc)).toBe('Hello'));
  replace(b.doc, 'World');
  await vi.waitFor(() => expect(plain(a.doc)).toBe('World'));
  a.awareness.setLocalStateField('user', { name: 'Alice' });
  await vi.waitFor(() => expect(b.awareness.getStates().has(a.doc.clientID)).toBe(true));
  a.disconnect();
  await vi.waitFor(() => expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false));
  a.connect();
  await vi.waitFor(() => expect(a.synced).toBe(true));
  a.awareness.setLocalStateField('user', { name: 'Reconnected' });
  await vi.waitFor(() =>
    expect(b.awareness.getStates().get(a.doc.clientID)?.user).toEqual({ name: 'Reconnected' }),
  );
});
it('lets a new transport reclaim presence after departure before the old socket closes', async () => {
  const { client } = await start();
  const id = randomUUID();
  const old = await client(id);
  const observer = await client(id);
  old.awareness.setLocalStateField('user', { name: 'Before' });
  await vi.waitFor(() =>
    expect(observer.awareness.getStates().get(old.doc.clientID)?.user).toEqual({ name: 'Before' }),
  );
  old.awareness.setLocalState(null);
  await vi.waitFor(() => expect(observer.awareness.getStates().has(old.doc.clientID)).toBe(false));
  const replacementDoc = new Y.Doc();
  replacementDoc.clientID = old.doc.clientID;
  const replacement = await client(id, 'editor', replacementDoc);
  for (let i = 0; i < 10; i++)
    replacement.awareness.setLocalStateField('user', { name: 'Returned' });
  await vi.waitFor(() =>
    expect(observer.awareness.getStates().get(old.doc.clientID)?.user).toEqual({
      name: 'Returned',
    }),
  );
  old.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(observer.awareness.getStates().get(replacement.doc.clientID)?.user).toEqual({
    name: 'Returned',
  });
});
it('serves viewer sync step1 but rejects initial step2 and later edits without persistence', async () => {
  const repo = new MemoryRepository();
  const { client, app } = await start(repo);
  const id = randomUUID();
  const editor = await client(id);
  replace(editor.doc, 'Allowed');
  await vi.waitFor(async () =>
    expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Allowed'),
  );
  const initial = new Y.Doc();
  replace(initial, 'Forbidden offline');
  const viewer = await client(id, 'viewer', initial);
  replace(viewer.doc, 'Forbidden live');
  // A valid round trip after the offending frames proves they have been processed.
  viewer.awareness.setLocalStateField('barrier', 1);
  await vi.waitFor(() =>
    expect(editor.awareness.getStates().get(viewer.doc.clientID)?.barrier).toBe(1),
  );
  const lease = await app.rooms.acquire(id);
  await lease.room.flush(true);
  lease.release();
  expect(plain(editor.doc)).toBe('Allowed');
  expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Allowed');
  const freshViewer = await client(id, 'viewer');
  expect(plain(freshViewer.doc)).toBe('Allowed');
});
it.each(['invalid', 'expired', 'wrong-room'])(
  'rejects %s tokens with protocol close codes',
  async (kind) => {
    const { base, app } = await start();
    const id = randomUUID();
    const value =
      kind === 'invalid'
        ? 'invalid'
        : token(
            kind === 'wrong-room' ? randomUUID() : id,
            'editor',
            kind === 'expired' ? 1 : undefined,
          );
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/${id}?token=${value}`);
    const [code] = await once(ws, 'close');
    expect(code).toBe(kind === 'wrong-room' ? 4403 : 4401);
    expect(app.rooms.size).toBe(0);
  },
);
it('unloads, compacts, and reloads persisted content', async () => {
  const repo = new MemoryRepository();
  const { client, app } = await start(repo);
  const id = randomUUID();
  const a = await client(id);
  replace(a.doc, 'Persist me');
  await vi.waitFor(async () =>
    expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Persist me'),
  );
  a.disconnect();
  await vi.waitFor(() => expect(app.rooms.size).toBe(0));
  expect(repo.updates.get(id)).toBeUndefined();
  expect(repo.states.has(id)).toBe(true);
  const b = await client(id);
  expect(plain(b.doc)).toBe('Persist me');
});
it('snapshots live state and forward-restores connected clients; validates internal API', async () => {
  const { client, api } = await start();
  const id = randomUUID();
  const a = await client(id);
  const b = await client(id);
  replace(a.doc, 'Original');
  await vi.waitFor(() => expect(plain(b.doc)).toBe('Original'));
  expect((await api(id, 'text', undefined, false)).status).toBe(401);
  expect((await api(id, 'snapshots', { label: '', userId })).status).toBe(400);
  const response = await api(id, 'snapshots', { label: 'Version one', userId });
  expect(response.status).toBe(201);
  const snapshot = (await response.json()) as { id: string; state?: unknown };
  expect(snapshot.state).toBeUndefined();
  replace(a.doc, 'Changed');
  await vi.waitFor(() => expect(plain(b.doc)).toBe('Changed'));
  expect((await api(id, 'restore', { snapshotId: snapshot.id, userId })).status).toBe(200);
  await vi.waitFor(() => {
    expect(plain(a.doc)).toBe('Original');
    expect(plain(b.doc)).toBe('Original');
  });
  expect(await (await api(id, 'text')).json()).toMatchObject({ blocks: [{ text: 'Original' }] });
  expect((await api(randomUUID(), 'restore', { snapshotId: snapshot.id, userId })).status).toBe(
    404,
  );
});
it('compaction preserves deletion history and later updates', async () => {
  const repo = new MemoryRepository();
  const id = randomUUID();
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  replace(doc, 'First');
  replace(doc, 'Second');
  await repo.append(id, updates.splice(0));
  await repo.compact(id);
  replace(doc, 'Third');
  await repo.append(id, updates.splice(0));
  expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Third');
  await repo.compact(id);
  expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Third');
  doc.destroy();
});
it('retries a failed append without losing the batch and flushes at shutdown', async () => {
  const repo = new MemoryRepository();
  const { app } = await start(repo, { FLUSH_INTERVAL_MS: '60000' });
  const id = randomUUID();
  const lease = await app.rooms.acquire(id);
  replace(lease.room.doc, 'Retained');
  vi.spyOn(repo, 'append').mockRejectedValueOnce(new Error('Temporary outage'));
  await expect(lease.room.flush()).rejects.toThrow('Temporary outage');
  await lease.room.flush();
  replace(lease.room.doc, 'Shutdown');
  lease.release();
  await app.close();
  expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Shutdown');
});
it('reports health and database failures', async () => {
  const repo = new MemoryRepository();
  const { base } = await start(repo);
  expect(await (await fetch(base + '/health')).json()).toEqual({
    status: 'ok',
    db: 'ok',
    redis: { enabled: false },
    activeRooms: 0,
  });
  vi.spyOn(repo, 'health').mockRejectedValueOnce(new Error('Down'));
  expect((await fetch(base + '/health')).status).toBe(503);
});
it('discards terminal deleted-document writes and closes peers without retrying', async () => {
  const repo = new MemoryRepository();
  const { app, client } = await start(repo, { FLUSH_INTERVAL_MS: '60000' });
  const id = randomUUID();
  const peer = await client(id);
  const lease = await app.rooms.acquire(id);
  replace(lease.room.doc, 'Unflushed when deleted');
  const append = vi.spyOn(repo, 'append').mockRejectedValue(new DocumentDeletedError());
  const compact = vi.spyOn(repo, 'compact');
  await expect(lease.room.flush()).resolves.toBeUndefined();
  await expect(lease.room.flush(true)).resolves.toBeUndefined();
  await vi.waitFor(() => expect(peer.wsconnected).toBe(false));
  expect(append).toHaveBeenCalledTimes(1);
  expect(compact).not.toHaveBeenCalled();
  lease.release();
  await vi.waitFor(() => expect(app.rooms.size).toBe(0));
});
it('validates config and defaults PORT to 1234', () => {
  const env = {
    DATABASE_URL: 'postgresql://localhost/db',
    COLLAB_TOKEN_SECRET: secret,
    INTERNAL_API_SECRET: 'internal',
  };
  expect(readConfig(env).PORT).toBe(1234);
  expect(readConfig({ ...env, PORT: '4567', SYNC_PORT: '1234' }).PORT).toBe(4567);
  expect(() => readConfig({ ...env, PORT: '-1' })).toThrow();
  expect(() => readConfig({ ...env, COLLAB_TOKEN_SECRET: '' })).toThrow();
});
it('compacts at the configured threshold', async () => {
  const repo = new MemoryRepository();
  const { app } = await start(repo, { COMPACT_AFTER_UPDATES: '2' });
  const id = randomUUID();
  const lease = await app.rooms.acquire(id);
  replace(lease.room.doc, 'One');
  replace(lease.room.doc, 'Two');
  await lease.room.flush();
  expect(repo.updates.has(id)).toBe(false);
  expect(snapshotToPlainText(repo.states.get(id)!)).toBe('Two');
  lease.release();
});
it('fans out updates, presence and restore across instances, including unflushed initial state', async () => {
  const subscriptions = new Map<string, Map<string, (event: FanoutEvent) => void>>();
  let publishes = 0;
  function bus(): Fanout {
    const instance = randomUUID();
    return {
      async subscribe(id, receive) {
        const room = subscriptions.get(id) ?? new Map();
        room.set(instance, receive);
        subscriptions.set(id, room);
      },
      async unsubscribe(id) {
        subscriptions.get(id)?.delete(instance);
      },
      async publish(id, event) {
        publishes++;
        if (publishes > 100) throw new Error('Fanout loop');
        for (const [origin, receive] of subscriptions.get(id) ?? [])
          if (origin !== instance) receive(event);
      },
      async close() {
        for (const room of subscriptions.values()) room.delete(instance);
      },
    };
  }
  const repo = new MemoryRepository();
  const first = await start(repo, { FLUSH_INTERVAL_MS: '60000' }, bus());
  const second = await start(repo, { FLUSH_INTERVAL_MS: '60000' }, bus());
  const id = randomUUID();
  const a = await first.client(id);
  replace(a.doc, 'Unflushed');
  await vi.waitFor(async () =>
    expect(await (await first.api(id, 'text')).json()).toMatchObject({
      blocks: [{ text: 'Unflushed' }],
    }),
  );
  expect(await repo.load(id)).toEqual([]);
  const b = await second.client(id);
  await vi.waitFor(() => expect(plain(b.doc)).toBe('Unflushed'));
  a.awareness.setLocalStateField('user', 'Alice');
  await vi.waitFor(() => expect(b.awareness.getStates().get(a.doc.clientID)?.user).toBe('Alice'));
  const snapshot = (await (
    await first.api(id, 'snapshots', { label: 'Before', userId })
  ).json()) as { id: string };
  replace(b.doc, 'After');
  await vi.waitFor(() => expect(plain(a.doc)).toBe('After'));
  expect((await second.api(id, 'restore', { snapshotId: snapshot.id, userId })).status).toBe(200);
  await vi.waitFor(() => {
    expect(plain(a.doc)).toBe('Unflushed');
    expect(plain(b.doc)).toBe('Unflushed');
  });
  expect(publishes).toBeLessThan(100);
});
it('terminates a client that does not answer keepalive pings', async () => {
  const { base } = await start(new MemoryRepository(), { PING_INTERVAL_MS: '25' });
  const id = randomUUID();
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/${id}?token=${token(id)}`, {
    autoPong: false,
  });
  const [code] = await once(ws, 'close');
  expect(code).toBe(1006);
});
it.runIf(Boolean(process.env.DATABASE_URL))(
  'Postgres: real server sync, snapshot/restore, unload and compaction',
  async () => {
    const url = process.env.DATABASE_URL!;
    const repo = new PostgresRepository(url);
    const id = randomUUID();
    await repo.pool.query('INSERT INTO users(id,email,name,color) VALUES ($1,$2,$3,$4)', [
      userId,
      `${userId}@test.invalid`,
      'Test',
      '#123456',
    ]);
    await repo.pool.query('INSERT INTO documents(id,title,owner_id) VALUES ($1,$2,$3)', [
      id,
      'Integration',
      userId,
    ]);
    cleanups.push(async () => {
      const pool = new Pool({ connectionString: url });
      try {
        await pool.query('DELETE FROM documents WHERE id=$1', [id]);
        await pool.query('DELETE FROM users WHERE id=$1', [userId]);
      } finally {
        await pool.end();
      }
    });
    const { client, api, app } = await start(repo);
    const a = await client(id);
    const b = await client(id);
    replace(a.doc, 'Database original');
    await vi.waitFor(() => expect(plain(b.doc)).toBe('Database original'));
    const snapshot = (await (await api(id, 'snapshots', { label: 'Saved', userId })).json()) as {
      id: string;
    };
    replace(b.doc, 'Changed');
    await vi.waitFor(() => expect(plain(a.doc)).toBe('Changed'));
    expect((await api(id, 'restore', { snapshotId: snapshot.id, userId })).status).toBe(200);
    await vi.waitFor(() => expect(plain(a.doc)).toBe('Database original'));
    a.disconnect();
    b.disconnect();
    await vi.waitFor(() => expect(app.rooms.size).toBe(0));
    expect(snapshotToPlainText(mergeState(await repo.load(id)))).toBe('Database original');
    expect(
      (await repo.pool.query('SELECT count(*) FROM document_updates WHERE document_id=$1', [id]))
        .rows[0].count,
    ).toBe('0');
    const c = await client(id);
    expect(plain(c.doc)).toBe('Database original');
    const lease = await app.rooms.acquire(id);
    replace(lease.room.doc, 'Pending when deleted');
    await repo.pool.query('DELETE FROM documents WHERE id=$1', [id]);
    await expect(lease.room.flush()).resolves.toBeUndefined();
    lease.release();
    await vi.waitFor(() => expect(app.rooms.size).toBe(0));
    await expect(repo.load(id)).rejects.toBeInstanceOf(DocumentDeletedError);
  },
  20000,
);
