# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Script Overview (root-first)
- Dev (long-running):
  - Start both: `npm run dev` (requires GitHub OAuth setup)
  - AI dev (auth disabled): `npm run dev:ai` (Worker AUTH_DISABLED=true; Admin VITE_AUTH_DISABLED=true)
  - Worker only: `npm run dev:worker`
  - Admin only: `npm run dev:admin`
  - Fast worker (skip pre-embed): `npm run dev:worker:fast`
- Build: `npm run build` (shared + admin; the worker bundle no longer embeds admin since S1)
- Deploy: `npm run deploy`
- Validate: `npm run validate:local` | `npm run validate:prod` | `npm run validate:url --url="https://staging.example.com"`
- Database:
  - Apply schema (local): `npm run db:apply:local`
  - Apply schema (prod): `npm run db:apply:prod`
  - Reconcile analytics (local|prod): `npm run db:reconcile:analytics:local` | `npm run db:reconcile:analytics:prod`
  - One-off query: `npm run db:q:local --sql="SELECT COUNT(*) FROM links;"` (or `db:q:prod`)
- Logs (long-running):
  - Tail: `npm run logs:tail`
  - Analytics only: `npm run logs:analytics`
  - Errors only: `npm run logs:errors`
- Secrets (pipe values; do not paste inline):
  - `echo "secret_value" | npm run secrets:put --name=SECRET_NAME`
- Lint: `npm run lint` (admin) or `npm run lint:all`
- Security: `npm run security:audit` | `npm run security:fix`
- Maintenance: `npm run maintenance` (audit → build → validate prod)

### Worker Development
```bash
# Start local worker (build admin, embed, run wrangler dev)
npm run dev:worker

# Validate local deployment endpoints
npm run validate:local

# Deploy to production
npm run deploy

# Manage secrets (via stdin)
echo "secret_value" | npm run secrets:put --name=SECRET_NAME

# Tail worker logs
npm run logs:tail

# Apply D1 schema locally (once or after schema changes)
npm run db:apply:local

# Apply D1 schema to production
npm run db:apply:prod

# Reconcile analytics data inconsistencies (prod)
npm run db:reconcile:analytics:prod

# Run validation script for deployment
npm run validate:local
```

### Admin Panel Development
```bash
# Start development server (requires worker running for full flow)
npm run dev:admin

# Build for production
npm run build:admin

# Lint code
npm run lint

# Preview production build (from admin workspace)
npm -w admin run preview
```

### Full Stack Development
With npm workspaces, you can start both from the repo root:
```bash
# Terminal 1: Start worker (builds admin and runs wrangler dev)
npm run dev:worker

# Terminal 2: Start admin (Vite)
npm run dev:admin
```
Or start both in one terminal using:
```bash
npm run dev
```

Access:
- Worker API: http://localhost:8787
- Admin UI: http://localhost:5173
- Test redirects: http://localhost:8787/{shortcode}
- Password-protected links: http://localhost:8787/{shortcode} (enter password when prompted)

### Agents & AI Dev Mode

Zero-click dev auth for Admin UI development:
- Run: `npm run dev:ai` (starts Worker on 8787 and Admin on 5173)
- Admin sets `VITE_AUTH_DISABLED=true` and sends `x-dev-auth: 1` on API requests
- Worker recognizes the header only when `Host` is `localhost`/`127.0.0.1` and returns a mock user
- Authorized-user checks are skipped in this local mode; production remains unaffected

Optional programmatic login remains available:
```bash
curl -i -X POST \
  -H "Content-Type: application/json" \
  -H "x-dev-auth: 1" \
  http://localhost:8787/api/auth/dev/login
```

Agent workflow guidance:
- Long-running commands: before starting `npm run dev:ai`, specify what to test (e.g., visit `/admin`, create a link, verify redirect). Await user “continue” before running.
- Prefer rebase over merge for PRs; commit in logical chunks.
- Tail logs locally when needed: `npm run logs:tail` (avoid tailing production unless asked).
- If `/api/user` returns 403, ensure the request includes `x-dev-auth: 1` and uses local Host.

## Architecture Overview

This project runs as a single Cloudflare Worker that serves an embedded React admin panel, handles API routes, and processes link redirects:

```
┌─────────────────────────────────────────────────────┐
│                  User Request                       │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│            Cloudflare Worker (Single Origin)        │
│                                                     │
│  ┌─────────────┐    ┌────────────┐    ┌──────────┐  │
│  │  Redirect   │    │    API     │    │  Admin   │  │
│  │   Handler   │    │  Endpoints │    │   Panel  │  │
│  │ /{shortcode}│    │  /api/*    │    │  /admin  │  │
│  └──────┬──────┘    └─────┬──────┘    └────┬─────┘  │
│         │                 │                 │        │
│         ▼                 ▼                 ▼        │
│  ┌─────────────┐    ┌──────────────┐  ┌──────────┐  │
│  │ Password    │    │ Auth/Session │  │ Embedded │  │
│  │ Protection  │    │ Management   │  │ React UI │  │
│  └─────────────┘    └──────────────┘  └──────────┘  │
│         │                  │                │        │
└─────────┼──────────────────┼────────────────┼────────┘
          │                  │                │
          ▼                  ▼                ▼
    ┌───────────────────────────────────────────────┐
    │               Cloudflare D1 (SQLite)          │
    │                                               │
    │  • Links with password protection & scheduling │
    │  • Analytics with UTM tracking & aggregations  │
    │  • Session management & rate limiting          │
    └───────────────────────────────────────────────┘
```

### Core Components

**Cloudflare Worker** (`/worker/`)
- **Entry Point**: `src/index.js` - Main worker with request lifecycle management
- **Admin UI**: `src/routes/admin.js` is a thin delegator (~10 LOC) that strips the `/admin` URL prefix and forwards to `env.ASSETS.fetch()` (Cloudflare Static Assets binding, configured in `wrangler.jsonc` with `directory: "../admin/dist"`). S1 replaced the previous embed pipeline so the React build is served by Cloudflare's CDN instead of being inlined into the Worker JS bundle.
- **Routing**: `src/routes.js` handles request dispatching between admin, redirects, and API
- **Authentication**: `src/auth.js` manages GitHub OAuth and session verification
- **Password System**: `src/password.js` provides PBKDF2 hashing with Web Crypto API
- **Database**: `src/db.js` abstracts Cloudflare D1 operations for link storage
- **API Router**: `src/routes/routerApi.js` handles all `/api/*` endpoints
- **Redirect Handler**: `src/routes/redirect.js` processes shortcode redirects with password protection
- **Session Management**: `src/session.js` handles JWT-based session cookies with secure HttpOnly settings

**React Admin Panel** (`/admin/`)
- **Main App**: `src/App.jsx` with tabbed interface (Links/Analytics)
- **Providers**: 
  - `src/providers/QueryProvider.jsx` - React Query configuration
  - `src/providers/ThemeProvider.jsx` - Dark/light mode support
- **Router**: Client-side routing with React Router (basename: `/admin`)
- **Authentication Flow**: `src/components/AuthCallback.jsx` handles GitHub OAuth callback
- **Link Management**: 
  - `src/components/LinkList.jsx` - Display and edit links
  - `src/components/CreateLinkForm.jsx` - Create new links with advanced options
  - `src/components/EditLinkModal.jsx` - Edit existing links with password protection
  - `src/components/BulkImportModal.jsx` - Bulk import links from CSV
  - `src/components/QRCodeModal.jsx` - Generate and download QR codes
- **Search & Filtering**: `src/components/LinkSearch.jsx` with real-time filtering
- **Analytics Dashboard**: `src/components/Analytics.jsx` with charts and metrics
- **API Client**: `src/services/api.js` handles all backend communication
- **React Query Hooks**: `src/hooks/useLinks.js` and `src/hooks/useAnalytics.js` for data fetching, caching, and mutations

### Data Flow

1. **Redirect Flow**: `/{shortcode}` → Worker → Password Check → D1 lookup → HTTP redirect
2. **API Flow**: Management UI → `/api/*` → Authentication → D1 operations → Response
3. **Auth Flow**: GitHub OAuth → Session JWT → HttpOnly cookie → API access
4. **Password Flow**: Password form → Web Crypto PBKDF2 hash → Verification → Session token

### Storage Strategy

- **Primary Storage**: Cloudflare D1 (SQLite) for link data and analytics
- **Session Storage**: JWT tokens in HttpOnly cookies
- **Password Storage**: PBKDF2 hashed passwords (format: `salt:hash`)
- **Caching**: React Query for frontend state management with stale-time tuning

### Key Configuration Files

- `worker/wrangler.jsonc`: Worker deployment config, environment variables, D1 binding, Static Assets binding (S1)
- `admin/vite.config.js`: Frontend build configuration
- `admin/tailwind.config.js`: Tailwind CSS customization

## Development Patterns

### Error Handling
- Worker uses structured logging via `src/logger.js`
- Frontend has ErrorBoundary components for graceful failures
- API responses follow consistent error format with proper HTTP status codes
- Password verification has secure failure handling with rate limiting

### Authentication Architecture
- GitHub OAuth for user identity
- Server-side session management with JWT
- HttpOnly cookies for security (no client-side token exposure)
- Single authorized user restriction via `AUTHORIZED_USER` environment variable
- Session expiration configurable via `SESSION_MAX_AGE`

### Password Protection System
- Links can be password-protected using the admin interface
- Passwords are hashed using PBKDF2 with a salt (100,000 iterations, SHA-256)
- Password verification happens server-side without leaking timing information
- Password sessions last for 1 hour and are stored in the D1 database
- Clean UI for password entry with custom strength validation

### Link Scheduling
- Links can be scheduled to activate at a future time (`activates_at` field)
- Links can be configured to expire at a certain time (`expires_at` field)
- Appropriate status codes are returned for inactive or expired links (403 and 410)
- UI provides datetime pickers for scheduling in the local timezone

### API Design
- RESTful endpoints under `/api/`
- CORS configured for cross-origin requests from management UI
- Bulk operations supported for efficiency (`/api/links/bulk`)
- Pagination support for large datasets
- Password verification endpoint (`/api/password/verify`)
- Analytics endpoints with filtering options

### Frontend State Management
- React Query for server state and caching
- Local React state for UI state
- Keyboard shortcuts via custom hook (`useKeyboardShortcuts`)
- **Real-time Analytics**: 15-second polling for overview, timeseries, and breakdown data when analytics tab is active
- **Real-time Links**: Synchronized polling with analytics (15s when analytics active, 10s otherwise)
- Background polling continues when tab is not focused for continuous real-time updates

### Analytics System
- UTM parameter tracking (source, medium, campaign, etc.)
- Device, browser, OS, and location breakdown
- Bot detection to filter out automated traffic
- Aggregation tables for fast querying of large datasets
- Timeseries data for historical analysis
- Export functionality for further processing

### Performance Optimizations
- Edge-first architecture with Cloudflare Workers
- Efficient D1 queries with proper indexing
- Frontend code splitting and lazy loading
- Optimized bundle size with Vite
- Caching headers for static assets
- Minimized worker bundle size via optimized asset embedding

## Environment Setup

### Required Environment Variables (Worker)
- `GITHUB_CLIENT_ID`: OAuth application ID
- `GITHUB_CLIENT_SECRET`: OAuth application secret (via `wrangler secret put`)
- `JWT_SECRET`: Secret used to sign session JWT cookies (via `wrangler secret put`)
- `AUTHORIZED_USER`: GitHub username allowed to access the system
- `SESSION_COOKIE_NAME` (optional): Name of the session cookie (default `__Host-link_session`)
- `SESSION_MAX_AGE` (optional): Session lifetime in seconds (default `28800`)

Note: The admin UI is served from the same origin at `/admin`, so a dedicated `MANAGEMENT_ORIGIN` is no longer required.

### Required Environment Variables (Admin)
- `VITE_API_BASE`: Worker API base URL
- `VITE_WORKER_DOMAIN`: Domain for shortcode redirects

### Testing Strategy

- Manual testing checklist includes OAuth flow, CRUD operations, password-protected links, and redirect functionality
- Use `npx wrangler tail` for real-time log debugging
- Migration script `src/migrate-analytics.sql` reconciles data inconsistencies
- Deployment validation script `scripts/validate-deployment.js` tests full integration

## Deployment Notes

- Worker deploys via `wrangler deploy` to Cloudflare Workers
- Management panel is embedded and served by the Worker at `/admin`
- D1 database migrations handled through Wrangler CLI
- Environment variables must be set in Cloudflare Dashboard for production

## Analytics Monitoring

### Error Monitoring
```bash
# Monitor analytics errors in real-time
npx wrangler tail --format pretty | grep -i "analytics"

# Check for specific error patterns
npx wrangler tail --format pretty | grep -E "(Analytics.*failed|statement.*failed)"
```

### Data Consistency Checks
```bash
# Check analytics counter consistency
npx wrangler d1 execute mack-link --remote --command "SELECT 
    'Links total' as source, SUM(clicks) as count FROM links WHERE archived=0
UNION ALL
    SELECT 'Analytics counter' as source, value as count FROM counters WHERE name='analytics:_all:totalClicks'
UNION ALL
    SELECT 'Analytics daily total' as source, SUM(clicks) as count FROM analytics_day WHERE scope='_all';"

# Verify UTM tracking is working
npx wrangler d1 execute mack-link --remote --command "SELECT dimension, key, clicks FROM analytics_agg WHERE dimension LIKE 'utm_%' ORDER BY clicks DESC LIMIT 10;"

# Check password-protected link usage
npx wrangler d1 execute mack-link --remote --command "SELECT shortcode, COUNT(*) as session_count FROM counters WHERE name LIKE 'pwd_session:%' GROUP BY shortcode;"
```

### Performance Metrics
- Monitor `counters` table growth for traffic trends
- Check `analytics_day` for daily click patterns  
- Review `analytics_agg` for top referrers and UTM performance
- Use Cloudflare Analytics for worker request patterns and errors
- Check scheduled and password-protected link performance

### Keyboard Shortcuts

The admin interface supports the following keyboard shortcuts:

- `Ctrl/Cmd + N`: Create new link
- `Ctrl/Cmd + K` or `/`: Focus search
- `Ctrl/Cmd + F`: Focus search (overrides browser Find within app)
- `Escape`: Close modal; in search input: clear when non-empty, otherwise blur
- `Ctrl/Cmd + /` or `Shift + ?`: Show keyboard shortcuts help
- `Ctrl/Cmd + 1` (or `Alt + 1`): Go to Links
- `Ctrl/Cmd + 2` (or `Alt + 2`): Go to Analytics
