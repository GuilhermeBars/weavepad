# Weavepad architecture

Weavepad is an npm-workspaces monorepo requiring Node 20 or newer. Session 1
provides the web placeholder, HTTP health server, and tested shared domain package.
Authentication, editing, WebSocket rooms, Redis, and product e2e flows are later sessions.

## Components and boundaries

- `apps/web`: Next.js 15 App Router, React 19 and Tailwind v4. The future web
  server owns Auth.js JWT sessions, access checks, document/member CRUD and token issuance.
- `apps/sync-server`: a Node HTTP server on port 1234. Currently only
  `GET /health` is implemented. It will own active Y.Doc rooms, WebSocket sync,
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
4. Rooms load full state plus ordered pending updates from Postgres. Later
   persistence will append updates and atomically compact them. Redis is optional
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
Quality gates are `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`. Vitest projects cover shared logic and the HTTP server with one
worker. `npm run e2e` is wired to Playwright with local browser storage, but the
product suite and server orchestration are intentionally not implemented yet.
Docker/CI configuration is also reserved for later sessions.
