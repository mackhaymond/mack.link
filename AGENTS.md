# Agents Guide

Canonical dev / agent workflow docs live in [WARP.md](./WARP.md). Read that
first — it covers `npm run dev:ai`, dev-auth, validation, and operational
guidelines in detail.

## Quick reference

```bash
npm install
npm run dev:ai          # zero-click dev mode (auth disabled)
npm run validate:local  # all direct-mode tests must pass with dev:ai running
npm run lint && npm test && npm run build
```

- Worker: http://localhost:8787
- Admin:  http://localhost:5173/admin

## Auth (Sprint 2a)

Production auth is handled by **Cloudflare Access** at the edge.
`/admin*` and `/api/*` are gated by a single Access app (Allow user's
GitHub email); the Worker just verifies the `Cf-Access-Jwt-Assertion`
header. See [SECURITY.md](./SECURITY.md) for the full boundary model.

## Dev auth (defense in depth)

The dev bypass requires **all three** of:
1. `AUTH_DISABLED=true` (worker/.dev.vars)
2. `ENVIRONMENT=development` (worker/.dev.vars)
3. request URL host is `localhost` / `127.0.0.1`

Production deployments never set `ENVIRONMENT`, so the bypass is
structurally impossible to enable in prod. See `.dev.vars.example` for
the local values.

## Schema migrations

Use `npm run db:apply:local` (or `db:apply:prod`). It invokes the JS
migration runner (`worker/scripts/migrate.mjs`) which tracks applied
migrations in a `migrations` table. New migrations live under
`worker/src/migrations/NNN_*.sql`. The runner is idempotent.

`worker/src/schema.sql` is for **fresh installs only** and stays in sync
with the latest migration state.

## Safe operation in coding agents

- Long-running commands (e.g. `npm run dev:ai`): describe the intent
  first, wait for approval, then run.
- Use `npm run logs:tail` for debugging dev sessions.
- Commit in logical chunks; rebase over merge; push when a feature is
  complete. Don't deploy from CI for unreviewed branches.
- For CI / headless tests, run against `npm run dev:ai` — the dev
  bypass returns a mock user on the first localhost request, no login
  endpoint to call. The old `POST /api/auth/dev/login` flow is gone.