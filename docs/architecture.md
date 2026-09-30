# Weavepad architecture

Weavepad is an npm-workspaces monorepo requiring Node 20 or newer. Session 1
provides the web placeholder and tested shared domain package. Session 2 implements
the sync engine, persistence, optional Redis fan-out and internal versioning API.
Session 3 implements web authentication, document APIs, and the collaborative UI.
The committed product e2e suite and CI orchestration remain later sessions.

## Components and boundaries

- `apps/web`: Next.js 15 App Router, React 19 and Tailwind v4. The web
  server owns Auth.js JWT sessions, access checks, document/member CRUD and token issuance.
- `apps/sync-server`: HTTP and WebSocket server on `PORT` (default 1234;
  `SYNC_PORT` remains a fallback). It owns active Y.Doc rooms, WebSocket sync,
  awareness, persistence, and internal snapshot/restore endpoints.
- `packages/shared`: framework-free TypeScript. Its root export contains roles,
  protocol constants and versioning. Import `@weavepad/shared/tokens` and
  `@weavepad/shared/db/schema` only on the server; they depend on Node crypto/Buffer.
  Builds emit ESM and declarations to dist. Type exports refer to source so
  typechecking a clean checkout does not require generated build artifacts.

## Intended data flow

1. A signed-in user requests a document's short-lived token from the web API.
   Access comes from ownership/membership in Postgres, never from client claims.
2. The browser connects to the sync server with the token. The token is
   base64url JSON plus an HMAC-SHA256 signature, not a JWT. Verification checks
   authenticated claims and exclusive expiry in Unix seconds. Document ID must
   also match the requested room. Invalid authentication closes with 4401;
   denied authorization with 4403.
3. y-websocket exchanges sync and awareness messages. The server must drop
   viewer sync step2 and update messages, while allowing sync step1 and presence.
   Editors can edit, snapshot and restore; owners additionally share and manage.
4. Rooms load full state plus ordered pending updates from Postgres.
   Persistence batches updates and atomically compacts them. Redis is optional
   for cross-instance updates/presence; IndexedDB will keep offline browser edits.
5. Web snapshot/restore requests go through authenticated internal sync HTTP
   endpoints because the sync process owns live state.

## Snapshots and restore semantics

Snapshots are full Yjs state updates. Structured/plain-text projections read
`Y.XmlFragment('default')`; text marks are retained in snapshots but omitted
from plain text. Diffs expose top-level structured blocks, lines, and words.
Restore decodes the snapshot into a temporary document, clones its rich content,
and replaces the live fragment in one new transaction tagged `weavepad:restore`.
It preserves unrelated shared maps and existing CRDT history. Never apply old
state bytes directly to the live document as a restore: merging is not rewinding.

At transaction completion, the live fragment equals the selected snapshot.
Unseen concurrent offline edits subsequently merge by Yjs rules: edits to deleted
nodes can disappear, while independently inserted blocks can survive. All peers
converge; restore does not promise to erase unknown future updates. Tests cover
both delivery orders, duplicate updates, rich formatting, and concurrent restores.

## Database and local operation

Drizzle defines users, documents, members, full state, append-only updates and
snapshots. Document-owned rows cascade on document deletion. User references from
ownership and snapshots restrict deletion. Membership has a composite primary
key; emails are unique. The application must normalize emails, keep the owner
membership consistent with owner_id, and update updated_at on mutations.

Run `npm install`, copy `.env.example` to root `.env`, then run
`npm run db:local` in one terminal and `npm run db:migrate` in another.
The local server binds only 127.0.0.1:5432 and persists in root `.pglite/`.
Application code and migrations use pg with DATABASE_URL, also usable against
Postgres 16. PGlite is a local development substitute, not a production server.
The [PGlite socket API](https://pglite.dev/docs/pglite-socket) provides the TCP bridge.
Known upstream limitations include [extended-protocol error recovery](https://github.com/electric-sql/pglite/issues/958)
and [concurrent connection scheduling](https://github.com/electric-sql/pglite/issues/1046).
The smoke test uses simple protocol for intentional SQL failures; normal writes
and binary round-trips use parameterized pg queries. Validate concurrent database
workloads against real Postgres in later CI; the local bridge is not equivalent
to Postgres under all failure/concurrency conditions.
The migration script closes its connection pool even on error. Stop local servers
with Ctrl+C. `npm run dev` runs web and sync; the database is a separate process.
Web and sync explicitly load root `.env`; existing environment values win.

Run `npm run db:generate` for schema changes and commit the generated SQL and
Drizzle metadata. Run `node tools/check-db.mjs` for the finite local migration,
constraint and persistence smoke test (requires port 5432 to be free).
Run `npm run format` to apply the repository's Prettier style. CI quality gates are
`npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`. Vitest projects cover shared logic and the HTTP server with one
worker. `npm run e2e` is wired to Playwright with local browser storage, but the
product suite and server orchestration are intentionally not implemented yet.
The sync image is available via `docker build -f apps/sync-server/Dockerfile .`.
Compose and CI configuration are reserved for later sessions.

## Sync runtime and API (session 2)

Start with `npm run build -w @weavepad/shared`, then build/start the sync workspace.
`DATABASE_URL`, `COLLAB_TOKEN_SECRET`, and `INTERNAL_API_SECRET` are required.
`REDIS_URL` empty/unset disables Redis. Zod validates configuration at startup;
Pino logs structured events without logging token-bearing URLs or request bodies.
Keep root `.env` PORT unset when running web and sync together: Next.js also reads
PORT. For a standalone sync deployment, PORT takes precedence over SYNC_PORT.

The standard provider URL is `ws://host:1234/<docId>?token=...`. Invalid or expired
tokens close with 4401; document mismatch or denied read access closes with 4403.
Tokens grant access for the connection lifetime; subsequent token expiry does not
disconnect an established session. Viewer step2 and update frames are discarded.
Malformed protocol frames close with 1003; payloads default to a 1 MiB limit.
Ping/pong detects dead peers. Slow consumers are disconnected when queued output
exceeds four times the payload limit. Presence is transient and removed on close.

`GET /health` returns `{status, db: "ok"|"error", redis: {enabled}, activeRooms}`;
database failure yields HTTP 503. Redis's enabled flag reports configuration,
not a claim that Redis is currently healthy.

Internal endpoints require `Authorization: Bearer <INTERNAL_API_SECRET>`:

- `POST /internal/docs/:id/snapshots`, `{label, userId}`: HTTP 201 with
  `{id, documentId, label, createdBy, createdAt}` (no binary state).
- `POST /internal/docs/:id/restore`, `{snapshotId, userId}`: HTTP 200 with
  `{snapshotId, documentId}` after the forward update is flushed.
- `GET /internal/docs/:id/text`: HTTP 200 with `{blocks: PlainBlock[]}`.

IDs in this API are UUIDs. Labels must contain 1–200 trimmed characters. JSON
bodies are limited to 16 KiB. The secret authenticates the trusted web service;
the web API must check the caller's document role before requesting a snapshot
or restore. `userId` is attribution, not a substitute for authorization.

Rooms are shared across concurrent acquisitions and remain pinned during HTTP
operations. After the last lease disconnects, the default idle grace is 1 second.
Pending updates are appended every second, compacted after 100 updates or on
unload, and drained on SIGINT/SIGTERM. Failed batches stay in memory for retry;
failed unloads retain the room. A process crash can lose the unflushed batch;
WebSocket delivery is not a durable-write acknowledgment.

Postgres load, append and compaction transactions lock the document row. Compaction
merges the persisted base and log under that lock, so an instance with stale local
state cannot erase another instance's writes. Redis subscribers join before load,
relay updates/presence with instance echo suppression, and request peer state to
recover unflushed changes on room startup and Redis reconnection. Redis pub/sub is
not a durable queue; during an outage instances can temporarily diverge, and
presence expires through awareness timeouts. Each instance persists received Yjs
updates; duplicate updates remain safe under CRDT merge and compaction.

Tuning variables: `FLUSH_INTERVAL_MS`, `COMPACT_AFTER_UPDATES`, `ROOM_IDLE_MS`,
`PING_INTERVAL_MS`, `MAX_PAYLOAD_BYTES`, `LOG_LEVEL`, and `SYNC_HOST`.

`node tools/check-sync.mjs` is a finite local smoke harness: it runs
`npm run db:local` in the background, migrates, checks the built sync server's
health, runs tests with DATABASE_URL set, and stops both servers in a finally
block. Build shared/sync first. The harness requires local ports 5432 and 1234
to be free. Normal `npm test` skips the Postgres-backed test without DATABASE_URL;
set it to a migrated test database to run that test against real Postgres or
the local PGlite wire server. Tests use real ws/y-websocket clients, with separate
fan-out and Redis-adapter tests that do not require a Redis daemon.

## Web runtime and API (session 3)

The web app loads root `.env` in `next.config.ts`. Set `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_URL` (the browser-facing origin), `COLLAB_TOKEN_SECRET`, `SYNC_INTERNAL_URL`,
and `INTERNAL_API_SECRET`. The two collaboration secrets must match the sync
server. `NEXT_PUBLIC_SYNC_URL` is the browser-facing WebSocket address and is
embedded at build time. `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` together enable
GitHub; otherwise only Credentials demo login is offered. Behind a trusted reverse
proxy, configure Auth.js host trust with `AUTH_TRUST_HOST=true`.

Credentials login normalizes email, validates a display name, and upserts a user
with a randomly selected color on first login. There is deliberately no password
or email verification: this is a demo identity system, and knowing an email lets
someone use that account. JWT sessions carry the database user ID and color. The
middleware protects `/` and `/d/*`; pages and every API handler independently
check the session. API mutations also check the request Origin against AUTH_URL.
Drizzle uses the shared schema and a process-global pg Pool. No database connection
or runtime secret is required merely to build the app.

The document API is implemented by the App Router catch-all route under `/api/docs`:

| Method / path                                    | Access / behavior                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| GET /api/docs                                    | Signed in; returns `mine` (owner role) and `shared`                        |
| POST /api/docs                                   | Signed in; `{title}`, inserts document and owner membership atomically     |
| PATCH /api/docs/:id                              | Owner; `{title}`                                                           |
| DELETE /api/docs/:id                             | Owner; cascading deletion                                                  |
| GET /api/docs/:id/token                          | Any member; 5-minute signed token with current database role               |
| GET /api/docs/:id/members                        | Owner; membership list                                                     |
| POST /api/docs/:id/members                       | Owner; `{email,role}`, user must already exist                             |
| PATCH /api/docs/:id/members/:userId              | Owner; `{role}`                                                            |
| DELETE /api/docs/:id/members/:userId             | Owner; removes membership                                                  |
| GET /api/docs/:id/snapshots                      | Any member; metadata only                                                  |
| POST /api/docs/:id/snapshots                     | Editor/owner; `{label}`, sync internal API                                 |
| GET /api/docs/:id/snapshots/:snapshotId/diff     | Any member; saved text → current live server text, word additions/removals |
| POST /api/docs/:id/snapshots/:snapshotId/restore | Editor/owner; sync internal forward restore                                |

Owner mutations lock the document row, then re-read memberships in the transaction.
Demotion/removal/upsert cannot remove the final owner. When the owner_id user loses
ownership, owner_id moves to a remaining owner, keeping the schema invariant intact.
Membership is the authorization source; no requested role or session role is trusted.
If a buffered sync append/compaction encounters a deleted document, it discards that
terminal batch, closes remaining peers with 4403, and unloads without retrying or
recreating rows. Transient database failures still retain batches for retry.
As in the sync contract, role changes take effect on the next WebSocket connection;
they do not forcibly terminate an existing connection. APIs recheck access each time.

The editor uses TipTap 3 Collaboration and CollaborationCaret, with StarterKit's
separate undo history disabled per the [TipTap collaboration guide](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing).
Yjs uses the `default` fragment. IndexedDB caches are scoped by both account and
document, and cross-tab broadcast sync is disabled to avoid bypassing server role
checks. The provider's automatic reconnect is suppressed; the app fetches a fresh
token before every attempt, backs off on outages, and becomes read-only when access
is denied. Awareness drives names, cursors and the avatar stack. Reconnect refreshes
the local presence clock and clears metadata for absent remote peers so the initial
server state can repopulate avatars immediately. Explicit awareness departures
release their server-side ID claim even if the old transport remains half-open.
A Connected badge
means the Yjs handshake completed, not an acknowledgment of durable database writes.
History compares with current server state; unsent offline edits are not included.
Offline persistence supports editing in an already loaded app and recovery when the
app can load again; there is no service worker caching the entire application shell.

The web image uses `apps/web/Dockerfile` and Next's standalone output. Pass
`--build-arg NEXT_PUBLIC_SYNC_URL=wss://your-sync-host` for deployment, then supply
server-only secrets at runtime. The image starts `apps/web/server.js` as a non-root
user. Normal local production startup remains `npm run start -w @weavepad/web`.
Vitest includes web guard/token/last-owner and connection-state tests.
