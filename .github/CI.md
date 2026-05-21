# CI/CD for mack.link

This document describes the automated deployment and health-check workflows used by this repository.

## 🏗️ Pipeline Overview

The CI/CD setup supports the unified architecture where:
- The React admin panel is embedded into the Cloudflare Worker
- A single deployment target is used (no separate Pages deployment)
- Builds happen in CI; the Worker is deployed with embedded assets
- A scheduled health check validates the live site

## 📋 Workflows (current)

1) Production deploy (on push to main)
- File: .github/workflows/ci.yml
- Steps:
  - Install dependencies (root)
  - Build admin assets and embed into the worker
  - Deploy with cloudflare/wrangler-action
  - Smoke-test root and /admin

2) Daily health check
- File: .github/workflows/health.yml
- Schedule: daily at 02:00 UTC (plus manual dispatch)
- Runs scripts/validate-deployment.js against production

Note: There is no staging workflow in this repo at present, and no CodeQL or dependency-audit workflow. Add those separately if needed.

## 🔐 Required repository secrets

Configure in Repo → Settings → Secrets and variables → Actions → Repository secrets

- CLOUDFLARE_API_TOKEN: Cloudflare API token (deploy)
- CLOUDFLARE_ACCOUNT_ID: Cloudflare account ID
- JWT_SECRET: Random secure string (session JWT)
- OAUTH_CLIENT_SECRET: GitHub OAuth app client secret
- OAUTH_CLIENT_ID (recommended): GitHub OAuth client ID (used at build time for admin; optional at runtime)

Tip to generate a JWT secret locally: `openssl rand -base64 32`

## ⚙️ Worker configuration snippet

This matches worker/wrangler.jsonc in the repo (values are examples):

```jsonc
{
  "name": "worker",
  "main": "src/index.js",
  "compatibility_date": "2025-09-03",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mack-link",
      "database_id": "your-database-id"
    }
  ],
  "vars": {
    "GITHUB_CLIENT_ID": "your-github-client-id",
    "AUTHORIZED_USER": "your-github-username",
    "SESSION_MAX_AGE": "28800",
    "SESSION_COOKIE_NAME": "link_session"
  }
}
```

Notes
- The application supports a default cookie name of "__Host-link_session". The current config explicitly sets it to "__Host-link_session".
- Secrets GITHUB_CLIENT_SECRET and JWT_SECRET are supplied at deploy time by the workflow.

## 🧪 Local validation

```bash
# Install all dependencies
npm ci

# Build (admin + worker), then validate the running dev worker
npm run build
npm run validate:local
```

## 🚀 Deploys

Automatic (recommended)
- Push to main → ci.yml builds and deploys

Manual (from local)
- From repo root: `npm run deploy`

## 🧭 Troubleshooting

- Deployment fails with authentication error
  - Ensure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set and valid
- Admin panel “Failed to fetch”
  - Ensure JWT_SECRET and OAUTH_CLIENT_SECRET are provided at deploy time
  - Verify D1 binding exists and schema applied
- Build size too large
  - Check bundling; see admin/vite.config.js manualChunks and minification

## 📚 References
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Project architecture: ../docs/ADMIN_INTEGRATION.md

---
Last updated: 2025-09
Maintainer: mackhaymond
Status: ✅ Production Ready
