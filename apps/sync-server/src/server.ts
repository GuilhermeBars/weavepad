import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { pino, type Logger } from 'pino';
import { z } from 'zod';
import { verifyCollabToken, type CollabToken } from '@weavepad/shared/tokens';
import { applyRestore, canRead, createSnapshot, fragmentToPlainBlocks, CLOSE_CODE, DOCUMENT_FRAGMENT } from '@weavepad/shared';
import type { Config } from './config.js';
import { metadata, type Repository } from './repository.js';
import { RoomManager } from './rooms.js';
import type { Fanout } from './redis.js';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
    if (size > 16384) throw new HttpError(413, 'Request body too large');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}
export function createSyncServer(options: { config: Config; repository: Repository; logger?: Logger; fanout?: Fanout }) {
  const { config, repository, fanout } = options;
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL });
  const rooms = new RoomManager(repository, config, logger, fanout);
  let stopping = false;
  const tasks = new Set<Promise<void>>();
  function track(task: Promise<void>) { tasks.add(task); void task.finally(() => tasks.delete(task)); }
  const server = createServer((request, response) => {
    track(handle(request, response).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : err instanceof z.ZodError ? 400 : 500;
      if (status === 500) logger.error({ err }, 'HTTP request failed');
      if (!response.headersSent) json(response, status, { error: status === 500 ? 'Internal server error' : err instanceof Error ? err.message : 'Bad request' });
      else response.destroy();
    }));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (stopping) throw new HttpError(503, 'Shutting down');
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      let db = true;
      try { await repository.health(); } catch (err) { db = false; logger.error({ err }, 'Database health check failed'); }
      json(response, db ? 200 : 503, { status: db ? 'ok' : 'degraded', db: db ? 'ok' : 'error', redis: { enabled: Boolean(fanout) }, activeRooms: rooms.size }); return;
    }
    const route = /^\/internal\/docs\/([^/]+)\/(snapshots|restore|text)$/.exec(url.pathname);
    if (!route) throw new HttpError(404, 'Not found');
    const actual = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.INTERNAL_API_SECRET}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Unauthorized');
    const id = z.uuid().parse(route[1]); const action = route[2];
    if (request.method !== (action === 'text' ? 'GET' : 'POST')) throw new HttpError(405, 'Method not allowed');
    // The trusted web service authorizes editor/owner access before invoking these routes.
    const input = action === 'text' ? undefined : await body(request);
    const snapshotInput = action === 'snapshots' ? z.object({ label: z.string().trim().min(1).max(200), userId: z.uuid() }).strict().parse(input) : undefined;
    const restoreInput = action === 'restore' ? z.object({ snapshotId: z.uuid(), userId: z.uuid() }).strict().parse(input) : undefined;
    const lease = await rooms.acquire(id);
    try {
      if (action === 'text') json(response, 200, { blocks: fragmentToPlainBlocks(lease.room.doc.getXmlFragment(DOCUMENT_FRAGMENT)) });
      else if (snapshotInput) {
        await lease.room.flush();
        const snapshot = await repository.createSnapshot(id, snapshotInput.label, snapshotInput.userId, createSnapshot(lease.room.doc));
        json(response, 201, metadata(snapshot));
      } else if (restoreInput) {
        const snapshot = await repository.getSnapshot(id, restoreInput.snapshotId);
        if (!snapshot) throw new HttpError(404, 'Snapshot not found');
        applyRestore(lease.room.doc, snapshot.state); await lease.room.flush();
        logger.info({ docId: id, snapshotId: snapshot.id, userId: restoreInput.userId }, 'Snapshot restored');
        json(response, 200, { snapshotId: snapshot.id, documentId: id });
      }
    } finally { lease.release(); }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.MAX_PAYLOAD_BYTES, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, boolean>();
  server.on('upgrade', (request, socket, head) => {
    if (stopping) { socket.destroy(); return; }
    let claims: CollabToken | undefined; let code: number = CLOSE_CODE.UNAUTHORIZED;
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      claims = verifyCollabToken(url.searchParams.get('token') ?? '', config.COLLAB_TOKEN_SECRET);
      const room = decodeURIComponent(url.pathname.slice(1));
      if (!room || room.includes('/') || room !== claims.docId || !canRead(claims.role)) { code = CLOSE_CODE.FORBIDDEN; claims = undefined; }
    } catch { claims = undefined; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('error', (err) => logger.debug({ err }, 'WebSocket error'));
      alive.set(ws, true); ws.on('pong', () => alive.set(ws, true));
      if (!claims) { ws.close(code, code === CLOSE_CODE.UNAUTHORIZED ? 'Invalid or expired token' : 'Forbidden'); return; }
      const token = claims;
      const queued: Uint8Array[] = []; let queuedSize = 0;
      const buffer = (data: Buffer, binary: boolean) => {
        if (!binary) { ws.close(1003, 'Binary protocol required'); return; }
        queuedSize += data.length;
        if (queuedSize > config.MAX_PAYLOAD_BYTES) ws.close(1009, 'Too much pending data'); else queued.push(data);
      };
      ws.on('message', buffer);
      track((async () => {
        const lease = await rooms.acquire(token.docId); ws.off('message', buffer);
        if (ws.readyState !== WebSocket.OPEN || stopping) { lease.release(); return; }
        lease.room.connect(ws, token.role);
        ws.once('close', () => { lease.room.disconnect(ws); lease.release(); });
        ws.on('message', (data: Buffer, binary) => { if (binary) lease.room.receive(ws, data); else ws.close(1003, 'Binary protocol required'); });
        for (const bytes of queued) lease.room.receive(ws, bytes);
      })().catch((err: unknown) => { logger.error({ err, docId: token.docId }, 'Room connection failed'); ws.close(1011, 'Room unavailable'); }));
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false); if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, config.PING_INTERVAL_MS);
  let closing: Promise<void> | undefined;
  async function shutdown() {
    stopping = true; clearInterval(heartbeat);
    const httpClosed = new Promise<void>((resolve, reject) => {
      server.close((err) => { if (err && 'code' in err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err); else resolve(); });
    });
    const wsClosed = new Promise<void>((resolve) => wss.close(() => resolve()));
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); server.closeAllConnections(); }, 1000);
    try { await Promise.all([httpClosed, wsClosed]); await Promise.all(tasks); await rooms.close(); }
    finally { clearTimeout(force); await fanout?.close(); await repository.close(); }
  }
  return { server, rooms, close: () => (closing ??= shutdown()) };
}
