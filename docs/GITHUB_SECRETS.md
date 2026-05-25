# Required GitHub Repository Secrets

This document outlines the secrets that need to be configured in your GitHub repository for the CI/CD pipeline to work properly.

## Repository Secrets Setup

Navigate to your repository → Settings → Secrets and variables → Actions → Repository secrets

### Required Secrets

#### Production deploy
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token (needs Workers Scripts: Edit + D1: Edit on the account)
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account ID

That's the entire CI secret surface. CI runs `validate` on every push/PR and `deploy` on push to `main` — there is no staging / preview pipeline.

### Removed after Sprint 2a (Cloudflare Access migration)

The following secrets are no longer used by CI and can be deleted from
the repo's Actions secrets:

- `OAUTH_CLIENT_ID` — Worker no longer runs GitHub OAuth (Cloudflare Access does)
- `OAUTH_CLIENT_SECRET` — same
- `JWT_SECRET` — Worker no longer signs session JWTs

The matching Worker secrets should also be deleted from production. See
[SECURITY.md](../SECURITY.md) for the explicit `wrangler secret delete`
commands.

### Removed after preview-pipeline retirement

These were used only by the (now-removed) PR-preview deploy job and can
be deleted from the repo's Actions secrets and the `staging` GitHub
Environment:

- `CF_WORKERS_SUBDOMAIN` — was used to build the per-PR staging URL.

The `staging` GitHub Environment itself can also be deleted (Settings →
Environments → `staging`) if nothing else references it.

## Environment Configuration

The CI pipeline writes a single `.env.local` (validate job) and a single `.env.production` (deploy job) for the admin build:

### Validate job
```
VITE_API_BASE=http://localhost:8787
VITE_WORKER_DOMAIN=localhost:8787
VITE_GITHUB_CLIENT_ID=test_client_id
```

`VITE_GITHUB_CLIENT_ID` is unused after Sprint 2a (the SPA no longer runs OAuth) but is kept in the build env as a stable build-time string until the next admin cleanup pass — Vite's `import.meta.env` treats it as a constant whether or not anything reads it.

### Production deploy job
```
VITE_API_BASE=https://link.mackhaymond.co
VITE_WORKER_DOMAIN=link.mackhaymond.co
```

## Local Development

For local development, create an `admin/.env.local` file with appropriate values:

```bash
VITE_API_BASE=http://localhost:8787
VITE_WORKER_DOMAIN=localhost:8787
VITE_AUTH_DISABLED=true
```

`VITE_AUTH_DISABLED=true` tells the admin SPA to use the hardcoded mock user instead of fetching `/cdn-cgi/access/get-identity` (Cloudflare Access isn't running in local dev).

The `.env.local` file is git-ignored and will not be committed to the repository.
