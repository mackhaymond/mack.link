# Security Policy

## Reporting a vulnerability

Open a private security advisory at
<https://github.com/mackhaymond/mack.link/security/advisories/new>, or email
security@mackhaymond.co. Please include reproduction steps and the commit /
deployment URL you tested against.

## Authentication boundary (Sprint 2a)

Admin / API authentication is enforced by **Cloudflare Access** at the
edge, not by the Worker. The Worker's only auth responsibility is to
verify the `Cf-Access-Jwt-Assertion` header that Access injects on every
request it proxies.

Path coverage (configured in the Cloudflare Zero Trust dashboard, not
in this repo):

| Path                       | Access app | Worker auth                        |
|----------------------------|------------|------------------------------------|
| `/`                        | none       | none (public marketing page)       |
| `/{shortcode}`             | none       | none (public short-link redirect)  |
| `/api/password/verify`     | bypass     | none (public — anonymous visitors  |
|                            |            | submit password for protected links)|
| `/admin/*`                 | protected  | verify `Cf-Access-Jwt-Assertion`   |
| `/api/*` (everything else) | protected  | verify `Cf-Access-Jwt-Assertion`   |

JWT verification (`worker/src/access.js`): RS256, JWKS-cached
per-isolate for 1h, checks `iss` matches `TEAM_DOMAIN`, `aud` includes
`POLICY_AUD`, `exp`/`nbf` within bounds. JWKS fetched lazily from
`<TEAM_DOMAIN>/cdn-cgi/access/certs`.

Belt-and-suspenders: the Worker also rejects (403) any verified identity
whose login doesn't match `AUTHORIZED_USER`. Access's Allow policy
should already prevent this, but if the policy is ever disabled while
the app stays Required, the Worker still rejects unknown identities.

`*.workers.dev` bypass: the workers.dev backend URL is NOT gated by
Access. JWT verification rejects unauthenticated requests there too
(no `Cf-Access-Jwt-Assertion` header → 401 from the Worker).

### Dev bypass (local-only, defense in depth)

`npm run dev:ai` mode where Access doesn't intercept localhost. The
Worker returns a mock user iff ALL of these hold:

1. `env.AUTH_DISABLED === 'true'`
2. `env.ENVIRONMENT === 'development'` (only ever set in `worker/.dev.vars`)
3. Request host (derived from `request.url`, not the `Host` header) is
   `localhost` / `127.0.0.1`

Production deployments never set `ENVIRONMENT`, so the bypass is
structurally impossible to enable in prod even if `AUTH_DISABLED` leaks.

### Worker secrets that should be deleted after Sprint 2a merge

Sprint 2a removed the in-Worker OAuth + JWT pipeline. The user should
delete these from production (no automated cleanup — the user retains
deployment trigger):

```bash
wrangler secret delete JWT_SECRET
wrangler secret delete GITHUB_CLIENT_ID
wrangler secret delete GITHUB_CLIENT_SECRET
```

And from the GitHub Actions repository secrets:
`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `JWT_SECRET` (no longer
referenced by CI).

## Production runtime

The deployed Worker uses **only** Cloudflare's V8 isolate runtime and the
following bound services:

- `DB` — Cloudflare D1 (SQLite)
- `ASSETS` — Cloudflare Static Assets binding (serves `admin/dist/`)
- Cloudflare Access — protects `/admin*` and `/api/*` (configured in
  the dashboard, not this repo)

Nothing in `node_modules` runs in production. `npm audit` findings in
dev-only packages (Wrangler, Miniflare, Vitest pool, esbuild, undici via
miniflare, ws via miniflare) **do not affect deployed code**.

## Currently accepted dev-only advisories

The following advisories cannot be auto-resolved without a major version
bump of `@cloudflare/vitest-pool-workers` to 0.13+ that drops the
`defineWorkersProject` config helper and requires a non-trivial test-runner
migration. We track the latest patch line that keeps the `./config` export
(currently `0.12.21`) and accept the risk because the affected packages
**never execute in production**.

| Package | Severity | Advisory | Notes |
|---|---|---|---|
| `wrangler@4.72.0` (transitive via vitest-pool-workers) | High | [GHSA-36p8-mvp6-cv38](https://github.com/advisories/GHSA-36p8-mvp6-cv38) | OS command injection in `wrangler pages deploy`; we don't use Pages. Workers `deploy` is not affected. The top-level direct `wrangler@4.94.0` is past the fix range. |
| `miniflare@4.20260310.0` (transitive) | Moderate | via undici, ws | Dev/test-time HTTP/WebSocket server |
| `undici@<7.24.0` (transitive) | High | [GHSA-f269-vfmq-vjvj](https://github.com/advisories/GHSA-f269-vfmq-vjvj), [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q), [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | WebSocket DoS in HTTP client; only invoked by Miniflare's local dev server |
| `ws@8.0.0–8.20.0` (transitive) | Moderate | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | Uninitialized memory disclosure; only used inside Miniflare locally |

Tracking: revisit when `@cloudflare/vitest-pool-workers` ships a release
that preserves backwards compatibility for `defineWorkersProject` or
provides a clean migration path. The `worker/wrangler.jsonc`
`compatibility_date` is intentionally pinned to a value supported by the
bundled `workerd` (currently `2026-03-10`) so local tests don't fall back
silently. Bump together.

## Production security controls (worker)

- Auth boundary: Cloudflare Access at the edge; Worker verifies
  `Cf-Access-Jwt-Assertion` RS256 JWT against `<TEAM_DOMAIN>/cdn-cgi/access/certs`
  (`worker/src/access.js`)
- Dev-auth bypass requires **all three** of `AUTH_DISABLED=true`,
  `ENVIRONMENT=development`, and a localhost request URL; production
  deployments never set `ENVIRONMENT` so the bypass is structurally
  impossible to enable
- CORS: explicit allow-list (`ALLOWED_ORIGINS`); never `*` with credentials
- Multi-tenancy: every link CRUD path filters by `owner_id`; 404 (not 403)
  for not-yours to avoid existence enumeration
- Password-protected links: PBKDF2 100k SHA-256, constant-time compare,
  session token in httpOnly cookie scoped to `/{shortcode}`
- Rate limits: 50/hr create, 200/hr update/delete, 50/hr bulk ops,
  10/min password verify per (shortcode + IP)
- Standard security headers on every response: HSTS (preload), nosniff,
  X-Frame-Options=DENY, Referrer-Policy=strict-origin-when-cross-origin,
  Permissions-Policy=interest-cohort=(), CSP for HTML
- Analytics + expired-link sweep: cron at 03:00 UTC (S2)
- Logger PII scrubbing: drops Authorization/Cookie/password keys,
  redacts `?session=` / `?password=` / `?token=` URL params, truncates
  strings at 2 KB
