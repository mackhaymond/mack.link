# Security Policy

## Reporting a vulnerability

Open a private security advisory at
<https://github.com/mackhaymond/mack.link/security/advisories/new>, or email
security@mackhaymond.co. Please include reproduction steps and the commit /
deployment URL you tested against.

## Production runtime

The deployed Worker uses **only** Cloudflare's V8 isolate runtime and the
following bound services:

- `DB` — Cloudflare D1 (SQLite)
- `JWT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — Worker secrets

Nothing in `node_modules` runs in production. `npm audit` findings in
dev-only packages (Wrangler, Miniflare, Vitest pool, esbuild, undici via
miniflare, ws via miniflare) **do not affect deployed code**.

## Currently accepted dev-only advisories

The following advisories cannot be auto-resolved without a major version
bump of `@cloudflare/vitest-pool-workers` that drops the
`defineWorkersProject` config helper and requires a non-trivial test-runner
migration. We pin to the current stable line and accept the risk because the
affected packages **never execute in production**.

| Package | Severity | Advisory | Notes |
|---|---|---|---|
| `wrangler@^4.33.2` | High | [GHSA-36p8-mvp6-cv38](https://github.com/advisories/GHSA-36p8-mvp6-cv38) | OS command injection in `wrangler pages deploy`; we don't use Pages. Workers `deploy` is not affected. |
| `miniflare` (transitive via wrangler / vitest-pool-workers) | Moderate | via undici, ws | Dev/test-time HTTP/WebSocket server |
| `undici@<7.24.0` (transitive) | High | [GHSA-f269-vfmq-vjvj](https://github.com/advisories/GHSA-f269-vfmq-vjvj), [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q), [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | WebSocket DoS in HTTP client; only invoked by Miniflare's local dev server |
| `ws@8.0.0–8.20.0` (transitive) | Moderate | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | Uninitialized memory disclosure; only used inside Miniflare locally |

Tracking: revisit when `@cloudflare/vitest-pool-workers` ships a release
that preserves backwards compatibility for `defineWorkersProject` or provides
a clear migration path.

## Production security controls (worker)

- `JWT_SECRET` is required at runtime; missing secret raises immediately
  (`worker/src/config.js:requireJwtSecret`)
- Dev-auth bypass requires **both** `AUTH_DISABLED=true` and
  `ENVIRONMENT=development`; production deployments never set
  `ENVIRONMENT` so the bypass is structurally impossible to enable
- CORS: explicit allow-list (`ALLOWED_ORIGINS`); never `*` with credentials
- OAuth: `state` always validated, `redirect_uri` allow-listed against
  `ALLOWED_REDIRECT_URIS` or origins from `ALLOWED_ORIGINS`
- Multi-tenancy: every link CRUD path filters by `owner_id`; 404 (not 403)
  for not-yours to avoid existence enumeration
- Password-protected links: PBKDF2 100k SHA-256, constant-time compare,
  session token in httpOnly cookie scoped to `/{shortcode}`
- Session JWT: HS256, httpOnly + `__Host-` prefix + SameSite=Lax
- Rate limits: 50/hr create, 200/hr update/delete, 50/hr bulk ops,
  10/min password verify per (shortcode + IP)
- Standard security headers on every response: HSTS (preload), nosniff,
  X-Frame-Options=DENY, Referrer-Policy=strict-origin-when-cross-origin,
  Permissions-Policy=interest-cohort=(), CSP for HTML
- Analytics retention: cron at 03:00 UTC deletes rows older than
  `ANALYTICS_RETENTION_DAYS` (default 365)
- Logger PII scrubbing: drops Authorization/Cookie/password/JWT_SECRET keys,
  redacts `?session=` / `?password=` / `?token=` URL params, truncates
  strings at 2 KB
