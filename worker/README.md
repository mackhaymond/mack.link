# Worker (Cloudflare Worker)

This is the Cloudflare Worker for mack.link. Most development tasks should be run from the repository root using npm workspaces.

## Common tasks (from repo root)

- Install dependencies (all workspaces):
  - `npm ci`
- Start Worker in dev (builds admin assets and runs wrangler dev):
  - `npm run dev:worker`
  - or start both Worker + Admin: `npm run dev`
- Build only the admin app (the worker bundle no longer embeds it since S1; it's served via Static Assets):
  - `npm -w worker run build`
- Deploy to production (builds admin + worker, then deploys):
  - `npm run deploy`
- Apply D1 schema locally:
  - `npm -w worker run db:apply:local`
- Apply D1 schema to production:
  - `npm -w worker run db:apply`
- Run tests:
  - `npm -w worker run test`

## Notes
- Since S1, the admin UI is served by Cloudflare's Static Assets binding (`env.ASSETS`) from `admin/dist/`. The Worker bundle no longer embeds it; `worker/src/routes/admin.js` is a thin delegator that strips the `/admin` URL prefix and forwards to `env.ASSETS.fetch()`. The `directory` path in `wrangler.jsonc` (`../admin/dist`) is resolved relative to where `wrangler deploy` runs (the `worker/` workspace).

