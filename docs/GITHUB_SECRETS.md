# Required GitHub Repository Secrets

This document outlines the secrets that need to be configured in your GitHub repository for the CI/CD pipeline to work properly.

## Repository Secrets Setup

Navigate to your repository → Settings → Secrets and variables → Actions → Repository secrets

### Required Secrets

#### Production deploy
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token (needs Workers Scripts: Edit + D1: Edit on the account)
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

#### Required for PR preview deploys (S3)
- `CF_WORKERS_SUBDOMAIN` - Your account's workers.dev subdomain (the bit between the worker name and `.workers.dev`). Find via `wrangler whoami` or in the Cloudflare dashboard under Workers → "Your subdomain". Example: if your prod worker URL is `worker.example-acct.workers.dev`, set this to `example-acct`. The preview job uses it to build the staging URL: `https://worker-staging.<CF_WORKERS_SUBDOMAIN>.workers.dev`.

### Removed after Sprint 2a (Cloudflare Access migration)

The following secrets are no longer used by CI and can be deleted from
the repo's Actions secrets:

- `OAUTH_CLIENT_ID` — Worker no longer runs GitHub OAuth (Cloudflare Access does)
- `OAUTH_CLIENT_SECRET` — same
- `JWT_SECRET` — Worker no longer signs session JWTs

The matching Worker secrets should also be deleted from production. See
[SECURITY.md](../SECURITY.md) for the explicit `wrangler secret delete`
commands.

### Setting up PR preview deploys (S3)

Three one-time steps required before the first preview job runs:

1. **Create the staging D1 database** (local machine):
   ```bash
   cd worker
   npx wrangler d1 create mack-link-staging
   ```
   Copy the printed `database_id`.

2. **Paste the database_id into `worker/wrangler.jsonc`**: find the `env.staging.d1_databases[0]` entry and replace `REPLACE_ME_AFTER_wrangler_d1_create` with the actual ID. Commit + push.

3. **Add the `CF_WORKERS_SUBDOMAIN` secret** in repo Settings → Secrets and variables → Actions, as described above. While there, also replace the `<your-subdomain>` placeholders in `env.staging.vars.ALLOWED_ORIGINS` and `ALLOWED_REDIRECT_URIS` with the real subdomain (these are non-blocking for the deploy since staging runs in AUTH_DISABLED mode, but cleaner to fix when you do step 2).

Until steps 1+2 are done, the preview job auto-detects the placeholder and skips with a `::warning::` instead of failing CI - PRs remain mergeable.

## Environment Configuration

The CI/CD pipeline writes a `.env.local` (validate job) and `.env.production` (preview / deploy jobs) for the admin build:

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
