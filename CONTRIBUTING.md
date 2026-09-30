# Contributing to Weavepad

Use Node.js 20+ and npm workspaces. Follow the [local setup](README.md#local-without-docker), copy `.env.example` to `.env`, and keep credentials out of commits. Web uses port 3310; do not use port 3000.

Keep changes focused and explain the problem, resulting behavior, and validation in your pull request. Use strict TypeScript and the existing boundaries: web owns sessions and membership, sync owns live Yjs rooms, and shared owns domain logic. Add meaningful tests when behavior changes, particularly for permission and convergence boundaries.

Before submitting:

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build -w @weavepad/shared
npm test
npm run e2e
```

Stop local servers before E2E; it owns ports 3310 and 1310. A supplied `DATABASE_URL` must point to a dedicated test database. The database-backed unit test needs that variable exported to the test process; see the README for test scope and skipped-test behavior.

For schema changes, run `npm run db:generate` and include the SQL migration and Drizzle metadata. Update documentation for changed behavior or configuration. Refresh real UI captures with `npm run docs:screenshots` when relevant; do not substitute mock UI. See [architecture](docs/architecture.md) for restore, persistence, and permission invariants.
