# Agents Guide

Canonical dev / agent workflow docs live in [WARP.md](./WARP.md). Read that
first — it covers `npm run dev:ai`, dev-auth, validation, and operational
guidelines in detail.

## Quick reference

```bash
npm install
npm run dev:ai          # zero-click dev mode (auth disabled)
npm run validate:local  # 19/19 must pass with dev:ai running
npm run lint && npm test && npm run build
```

- Worker: http://localhost:8787
- Admin:  http://localhost:5173/admin

## Dev auth (defense in depth)

The dev bypass requires **both** `AUTH_DISABLED=true` **and**
`ENVIRONMENT=development` in `worker/.dev.vars` (see `.dev.vars.example`).
Setting only one of them does nothing — defense in depth so production can
never accidentally enter dev mode. The Admin dev server sends
`x-dev-auth: 1` and the Worker also requires the request Host to be
localhost / 127.0.0.1.

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
- For CI / headless tests, POST `/api/auth/dev/login` with `x-dev-auth: 1`.