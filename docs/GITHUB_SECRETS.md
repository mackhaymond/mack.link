# Required GitHub Repository Secrets

This document outlines the secrets that need to be configured in your GitHub repository for the CI/CD pipeline to work properly.

## Repository Secrets Setup

Navigate to your repository → Settings → Secrets and variables → Actions → Repository secrets

### Required Secrets

#### Existing Secrets (already configured)
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token for deployment (needs Workers Scripts: Edit + D1: Edit on the account)
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `JWT_SECRET` - Secret key for signing JWT tokens
- `OAUTH_CLIENT_SECRET` - GitHub OAuth application client secret

#### Required for production deploy
- `OAUTH_CLIENT_ID` - Your GitHub OAuth application client ID

#### Required for PR preview deploys (S3)
- `CF_WORKERS_SUBDOMAIN` - Your account's workers.dev subdomain (the bit between the worker name and `.workers.dev`). Find via `wrangler whoami` or in the Cloudflare dashboard under Workers → "Your subdomain". Example: if your prod worker URL is `worker.example-acct.workers.dev`, set this to `example-acct`. The preview job uses it to build the staging URL: `https://worker-staging.<CF_WORKERS_SUBDOMAIN>.workers.dev`.

### Setting up OAUTH_CLIENT_ID

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Find your OAuth App for this project
3. Copy the "Client ID" value
4. Add it as a repository secret named `OAUTH_CLIENT_ID`

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

The CI/CD pipeline will automatically create the following environment configurations:

### For Testing (validation job)
```
VITE_API_BASE=http://localhost:8787
VITE_WORKER_DOMAIN=localhost:8787
VITE_GITHUB_CLIENT_ID=test_client_id
```

### For Production (deploy job)
```
VITE_API_BASE=https://link.mackhaymond.co
VITE_WORKER_DOMAIN=link.mackhaymond.co
# Optional at runtime; used at admin build time only
VITE_GITHUB_CLIENT_ID=${secrets.OAUTH_CLIENT_ID}
```

## Local Development

For local development, create an `admin/.env.local` file with appropriate values:

```bash
# For local development with local worker
VITE_API_BASE=http://localhost:8787
VITE_WORKER_DOMAIN=localhost:8787
VITE_GITHUB_CLIENT_ID=your_github_oauth_client_id

# OR for local development with production API
VITE_API_BASE=https://link.mackhaymond.co
VITE_WORKER_DOMAIN=link.mackhaymond.co
VITE_GITHUB_CLIENT_ID=your_github_oauth_client_id
```

The `.env.local` file is git-ignored and will not be committed to the repository.
