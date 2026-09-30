# Docker and CI

Run `docker compose up --build` from the repository root. Compose waits for
Postgres and Redis health checks, applies committed migrations once, starts sync,
then starts web. Open <http://localhost:3310>; browser WebSocket connections use
`ws://localhost:1234`. Postgres data persists in the `postgres-data` volume.

The Compose defaults are for development. Change `POSTGRES_PASSWORD`,
`AUTH_SECRET`, `COLLAB_TOKEN_SECRET`, and `INTERNAL_API_SECRET` in production using
environment variables or a root `.env` file. Use independent random secrets and a
URL-safe database password (the password is interpolated into the connection URL).
Postgres and Redis are available only on the Compose network.

Set `AUTH_URL` to the public web origin and `NEXT_PUBLIC_SYNC_URL` to the public
WebSocket address for deployments. The latter is passed both as a Docker build
argument and a runtime variable, but Next.js embeds it in browser JavaScript at
build time: rebuild the web image whenever it changes. Browsers cannot resolve the
Compose service name `sync`; only server-side requests use `http://sync:1234`.

Docker enables `NEXT_OUTPUT=standalone`. Its runtime starts the monorepo standalone
entry point at `apps/web/server.js`, with static assets and `public` beside it.
Normal local and Playwright builds omit standalone output and use `next start`.

CI runs formatting, lint, type checks, migrated Postgres integration and unit
tests, production builds, Chromium e2e against Postgres, and Compose validation
and image builds. The Docker job starts the stack, probes sync health and the
web login page, emits logs on failure, and always tears down its containers.
The workflow configuration describes intended CI checks; consult the
[workflow runs](https://github.com/GuilhermeBars/weavepad/actions/workflows/ci.yml)
for their actual status. Compose configuration validation passed locally, but
the Docker daemon is unavailable in the sandbox used for the documentation
captures, so container builds and startup were not verified there.
