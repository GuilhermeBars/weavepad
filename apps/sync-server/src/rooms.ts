import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { canEdit, type Role, MESSAGE_TYPE, SYNC_MESSAGE_TYPE } from '@weavepad/shared';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { DocumentDeletedError, type Repository } from './repository.js';
import type { Fanout, FanoutEvent } from './redis.js';

const LOAD = Symbol('load');
const REMOTE = Symbol('remote');
function message(type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}
interface Peer {
  role: Role;
  ids: Set<number>;
}
export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awareness.Awareness(this.doc);
  private readonly peers = new Map<WebSocket, Peer>();
  private pending: Uint8Array[] = [];
  private deleted = false;
  private persisted = 0;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private publications = new Set<Promise<void>>();
  constructor(
    readonly id: string,
    private repo: Repository,
    private config: Config,
    private logger: Logger,
    private bus?: Fanout,
  ) {
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD || this.deleted) return;
      this.pending.push(update);
      this.broadcast(message(MESSAGE_TYPE.SYNC, (encoder) => sync.writeUpdate(encoder, update)));
      if (origin !== REMOTE) this.publish({ kind: 'update', data: update });
    });
    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const data = awareness.encodeAwarenessUpdate(this.awareness, [
          ...added,
          ...updated,
          ...removed,
        ]);
        this.broadcast(
          message(MESSAGE_TYPE.AWARENESS, (encoder) => encoding.writeVarUint8Array(encoder, data)),
        );
        if (origin !== REMOTE) this.publish({ kind: 'awareness', data });
      },
    );
  }
  async load() {
    try {
      await this.bus?.subscribe(this.id, (event) => this.receiveRemote(event));
      for (const update of await this.repo.load(this.id)) Y.applyUpdate(this.doc, update, LOAD);
      // Another instance may have unflushed updates predating our subscription.
      this.publish({ kind: 'sync-request', data: new Uint8Array() });
      this.timer = setInterval(() => {
        void this.flush().catch((err: unknown) =>
          this.logger.error({ err, docId: this.id }, 'Persistence failed; retained for retry'),
        );
      }, this.config.FLUSH_INTERVAL_MS);
      return this;
    } catch (err) {
      await this.bus?.unsubscribe(this.id).catch(() => {});
      this.awareness.destroy();
      this.doc.destroy();
      throw err;
    }
  }
  private receiveRemote(event: FanoutEvent) {
    if (this.deleted) return;
    if (event.kind === 'update') Y.applyUpdate(this.doc, event.data, REMOTE);
    else if (event.kind === 'awareness')
      awareness.applyAwarenessUpdate(this.awareness, event.data, REMOTE);
    else {
      this.publish({ kind: 'update', data: Y.encodeStateAsUpdate(this.doc) });
      this.publish({
        kind: 'awareness',
        data: awareness.encodeAwarenessUpdate(this.awareness, [
          ...this.awareness.getStates().keys(),
        ]),
      });
    }
  }
  private publish(event: FanoutEvent) {
    if (!this.bus) return;
    const task = this.bus
      .publish(this.id, event)
      .catch((err: unknown) => this.logger.error({ err, docId: this.id }, 'Redis publish failed'));
    this.publications.add(task);
    void task.finally(() => this.publications.delete(task));
  }
  private send(ws: WebSocket, bytes: Uint8Array) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > this.config.MAX_PAYLOAD_BYTES * 4) {
      ws.terminate();
      return;
    }
    ws.send(bytes, (err) => {
      if (err) ws.terminate();
    });
  }
  private broadcast(bytes: Uint8Array) {
    for (const ws of this.peers.keys()) this.send(ws, bytes);
  }
  connect(ws: WebSocket, role: Role) {
    if (this.deleted) {
      ws.close(4403, 'Document deleted');
      return;
    }
    this.peers.set(ws, { role, ids: new Set() });
    this.send(
      ws,
      message(MESSAGE_TYPE.SYNC, (encoder) => sync.writeSyncStep1(encoder, this.doc)),
    );
    this.sendAwareness(ws);
  }
  disconnect(ws: WebSocket) {
    const peer = this.peers.get(ws);
    this.peers.delete(ws);
    if (peer) awareness.removeAwarenessStates(this.awareness, [...peer.ids], ws);
  }
  private sendAwareness(ws: WebSocket) {
    this.send(
      ws,
      message(MESSAGE_TYPE.AWARENESS, (encoder) =>
        encoding.writeVarUint8Array(
          encoder,
          awareness.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
        ),
      ),
    );
  }
  receive(ws: WebSocket, bytes: Uint8Array) {
    if (this.deleted) return;
    const peer = this.peers.get(ws);
    if (!peer) return;
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_TYPE.SYNC) {
        const subtype = decoding.readVarUint(decoder);
        if (subtype === SYNC_MESSAGE_TYPE.STEP1) {
          this.send(
            ws,
            message(MESSAGE_TYPE.SYNC, (encoder) => sync.readSyncStep1(decoder, encoder, this.doc)),
          );
        } else if (subtype === SYNC_MESSAGE_TYPE.STEP2 || subtype === SYNC_MESSAGE_TYPE.UPDATE) {
          // Never feed viewer step2/update into Yjs, including initial offline state.
          if (canEdit(peer.role)) Y.applyUpdate(this.doc, decoding.readVarUint8Array(decoder), ws);
        } else throw new Error('Unknown sync message');
      } else if (type === MESSAGE_TYPE.AWARENESS) {
        this.receiveAwareness(ws, peer, decoder);
      } else if (type === MESSAGE_TYPE.QUERY_AWARENESS) this.sendAwareness(ws);
      else throw new Error('Unknown message');
    } catch {
      ws.close(1003, 'Malformed protocol message');
    }
  }
  /** Accept only presence IDs owned by this transport; providers also echo remote states. */
  private receiveAwareness(ws: WebSocket, peer: Peer, decoder: decoding.Decoder) {
    const data = decoding.readVarUint8Array(decoder);
    const presence = decoding.createDecoder(data);
    const count = decoding.readVarUint(presence);
    const entries: { id: number; clock: number; state: string }[] = [];
    for (let i = 0; i < count; i++) {
      const id = decoding.readVarUint(presence);
      const clock = decoding.readVarUint(presence);
      const state = decoding.readVarString(presence);
      JSON.parse(state);
      // Providers echo received presence. Ignore other peers' states rather than
      // treating those protocol-compatible echoes as ownership claims.
      const owned = [...this.peers.values()].some((other) => other !== peer && other.ids.has(id));
      if (peer.ids.has(id) || (!owned && !this.awareness.getStates().has(id)))
        entries.push({ id, clock, state });
    }
    const ids = entries.map((entry) => entry.id);
    if (new Set([...peer.ids, ...ids]).size > 100) throw new Error('Too many awareness ids');
    for (const id of ids) peer.ids.add(id);
    const filtered = encoding.createEncoder();
    encoding.writeVarUint(filtered, entries.length);
    for (const entry of entries) {
      encoding.writeVarUint(filtered, entry.id);
      encoding.writeVarUint(filtered, entry.clock);
      encoding.writeVarString(filtered, entry.state);
    }
    awareness.applyAwarenessUpdate(this.awareness, encoding.toUint8Array(filtered), ws);
    // A client can announce departure before its old transport closes (offline
    // or a half-open socket). Release those IDs so a fresh transport can claim
    // them; the old socket must not remove the new connection's presence later.
    for (const entry of entries) {
      if (entry.state === 'null' && !this.awareness.getStates().has(entry.id))
        peer.ids.delete(entry.id);
    }
  }

  flush(compact = false): Promise<void> {
    const next = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.deleted) return;
        const batch = this.pending.splice(0);
        if (batch.length) {
          try {
            await this.repo.append(this.id, batch);
            this.persisted += batch.length;
          } catch (err) {
            this.pending.unshift(...batch);
            throw err;
          }
        }
        if (compact || this.persisted >= this.config.COMPACT_AFTER_UPDATES) {
          await this.repo.compact(this.id);
          this.persisted = 0;
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DocumentDeletedError)) throw err;
        // The web app deleted the parent row; no retry can persist these edits.
        this.deleted = true;
        this.pending = [];
        clearInterval(this.timer);
        for (const ws of this.peers.keys()) ws.close(4403, 'Document deleted');
        this.logger.info({ docId: this.id }, 'Discarded state for deleted document');
      });
    this.writes = next;
    return next;
  }
  async destroy() {
    // Stop fan-out input before the final drain. A failed flush keeps the room alive.
    await this.bus?.unsubscribe(this.id);
    try {
      await this.flush(true);
    } catch (err) {
      await this.bus?.subscribe(this.id, (event) => this.receiveRemote(event));
      throw err;
    }
    clearInterval(this.timer);
    await Promise.all(this.publications);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
interface Entry {
  room: Promise<Room>;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
}
export class RoomManager {
  private readonly rooms = new Map<string, Entry>();
  private stopping = false;
  constructor(
    private repo: Repository,
    private config: Config,
    private logger: Logger,
    private bus?: Fanout,
  ) {}
  get size() {
    return this.rooms.size;
  }
  async acquire(id: string): Promise<{ room: Room; release: () => void }> {
    if (this.stopping) throw new Error('Server is shutting down');
    let entry = this.rooms.get(id);
    if (entry?.closing) {
      await entry.closing;
      return this.acquire(id);
    }
    if (!entry) {
      entry = { room: new Room(id, this.repo, this.config, this.logger, this.bus).load(), refs: 0 };
      this.rooms.set(id, entry);
    }
    const current = entry;
    clearTimeout(current.timer);
    current.refs++;
    try {
      const room = await current.room;
      let released = false;
      return {
        room,
        release: () => {
          if (released) return;
          released = true;
          current.refs--;
          if (!current.refs && !this.stopping) this.schedule(id, current);
        },
      };
    } catch (err) {
      this.rooms.delete(id);
      throw err;
    }
  }
  private schedule(id: string, entry: Entry) {
    entry.timer = setTimeout(() => {
      entry.closing = entry.room
        .then((room) => room.destroy())
        .then(() => {
          this.rooms.delete(id);
        });
      void entry.closing.catch((err: unknown) => {
        delete entry.closing;
        this.logger.error({ err, docId: id }, 'Room unload failed; retained for retry');
        if (!this.stopping) this.schedule(id, entry);
      });
    }, this.config.ROOM_IDLE_MS);
  }
  async close() {
    this.stopping = true;
    for (const entry of this.rooms.values()) clearTimeout(entry.timer);
    const results = await Promise.allSettled(
      [...this.rooms.values()].map(
        (entry) => entry.closing ?? entry.room.then((room) => room.destroy()),
      ),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    this.rooms.clear();
  }
}
