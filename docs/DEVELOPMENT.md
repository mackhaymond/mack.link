# 💻 Development Guide

Complete guide for setting up local development and contributing to Mack.link.

## 🛠️ Prerequisites

Before you start, make sure you have:

- **Node.js 18+** ([download here](https://nodejs.org/))
- **Git** for version control
- **Cloudflare account** (free tier works fine)
- **GitHub account** for OAuth testing
- **Code editor** (VS Code recommended)

## 🚀 Quick Start

### 1. Get the Code
```bash
# Clone the repository
git clone https://github.com/mackhaymond/mack.link.git
cd mack.link

# Install all dependencies (uses npm workspaces)
npm install
```

### 2. Setup Local Database
```bash
# Apply the database schema locally (uses in-memory D1)
npm run db:apply:local
```

### 3. Configure Environment
Create your local configuration in `worker/wrangler.jsonc`:
```json
{
  "name": "mack-link-dev",
  "vars": {
    "GITHUB_CLIENT_ID": "your_github_oauth_client_id",
    "AUTHORIZED_USER": "your_github_username",
    "SESSION_COOKIE_NAME": "__Host-link_session",
    "SESSION_MAX_AGE": "28800"
  }
}
```

### 4. Add Secrets
```bash
# Add your GitHub OAuth secret (get this from GitHub Developer Settings)
echo "your_github_client_secret" | npx wrangler secret put GITHUB_CLIENT_SECRET

# Add a JWT secret for sessions (use any random string)
echo "$(openssl rand -base64 32)" | npx wrangler secret put JWT_SECRET
```

### 5. Start Development
```bash
# Start both the worker and admin panel
npm run dev

# This will start:
# - Worker dev server at http://localhost:8787
# - Admin dev server at http://localhost:5173
```

### Test Your Setup
1. **Open the admin panel**: `http://localhost:5173`
2. **Sign in with GitHub** (make sure your OAuth app is configured)
3. **Create a test link**
4. **Test the redirect**: `http://localhost:8787/your-shortcode`

## 📁 Project Architecture

Mack.link uses **npm workspaces** for managing the monorepo:

```
mack.link/
├── 📁 worker/                  # Cloudflare Worker (Backend)
│   ├── src/
│   │   ├── index.js           # Main worker entry point
│   │   ├── routes/            # Route handlers
│   │   │   ├── admin.js       # Serves embedded React app
│   │   │   ├── routerApi.js   # API endpoint routing
│   │   │   └── redirect.js    # Shortcode redirects
│   │   ├── auth.js            # GitHub OAuth & sessions
│   │   ├── db.js              # D1 database operations
│   │   └── analytics.js       # Click tracking & reporting
│   │   (admin SPA is served via Cloudflare's Static Assets binding from
│   │    ../admin/dist, configured in wrangler.jsonc - see S1)
│   ├── wrangler.jsonc         # Worker configuration
│   └── package.json
├── 📁 admin/                   # React Admin Panel (Frontend)
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── services/          # API client & utilities
│   │   └── App.jsx            # Main application
│   ├── vite.config.js         # Build configuration
│   └── package.json
├── 📁 docs/                    # Documentation
└── package.json               # Root workspace configuration
```

### OAuth-disabled Dev Mode (for AI/Playwright)

#### Zero-click local dev auth (recommended)

When developing the Admin UI locally, enable a cookie-free, zero-click dev auth that works even if the browser blocks third-party cookies.

- Admin: set `VITE_AUTH_DISABLED=true` (done by `npm run dev:ai`)
- Worker: optionally set `AUTH_DISABLED=true` (also done by `npm run dev:ai`)
- The Admin sends a local-only header `x-dev-auth: 1` for API requests
- The Worker accepts this header only for `Host: localhost` or `127.0.0.1` and returns a mock user, skipping authorized-user enforcement
- No cookies or redirects are required

Troubleshooting:
- If `/api/user` returns 403, ensure the request has `x-dev-auth: 1` and `Host: localhost:8787`
- If `/api/user` returns 401, the Worker rejected the request as unauthenticated and no dev bypass applied; confirm you are running `npm run dev:ai`
- CORS preflight allows `x-dev-auth`; verify `Access-Control-Allow-Headers` includes it

For automated UI development and testing by an agent, you can run the stack in a special mode where the Admin UI is available without any login clicks or cookies.

Dev mode is controlled by the Worker environment variable `AUTH_DISABLED=true`. The client-side flag `VITE_AUTH_DISABLED=true` toggles the Admin UI into “dev mode” and will automatically fetch a mock user from the Worker on load.

Run:

```
$ npm run dev:ai
```

What this does:
- Starts the Worker with `AUTH_DISABLED=true` and a development JWT secret
- Starts the Admin with `VITE_AUTH_DISABLED=true` and `VITE_API_BASE=http://localhost:8787`
- The Admin bootstraps dev auth by calling `GET /api/user` on load (no cookie needed)
- The OAuth endpoints on the Worker are short-circuited to return a mock user when `AUTH_DISABLED=true`
- The Admin UI shows a small banner indicating dev auth is disabled

Notes:
- This mode is strictly for local/CI development by an AI agent. Do not enable it in production.
- Cookies are not required; the Admin directly reads the mock user from `/api/user` and stores it in localStorage.
- You can customize the mock user via Worker environment variables: `AUTH_DISABLED_USER_LOGIN`, `AUTH_DISABLED_USER_NAME`, `AUTH_DISABLED_USER_AVATAR_URL`

Playwright usage:
- Launch your tests against http://localhost:5173/admin
- Option A (UI): navigate to /admin and click the Sign in button; login happens without redirects.
- Option B (API, recommended for headless tests): do a POST to http://localhost:8787/api/auth/dev/login with credentials include, then visit /admin. Example:

```bash
curl -i -X POST \
  -H "Content-Type: application/json" \
  --cookie-jar cookies.txt \
  http://localhost:8787/api/auth/dev/login
```

Playwright example:

```ts
// playwright.dev-auth.ts
import { test as setup } from '@playwright/test';

setup('dev login', async ({ request, context }) => {
  const resp = await request.post('http://localhost:8787/api/auth/dev/login', {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok()) throw new Error('Dev login failed');
  // Session cookie is now stored in the browser context; navigate to admin
  const page = await context.newPage();
  await page.goto('http://localhost:5173/admin');
});
```

- Protected API routes are available once the session cookie is set.

Long-running command guidance:
- This command starts dev servers. If you ask an agent to run it, provide explicit instructions for what you want tested while it’s running and confirm before proceeding.

## 🔄 Development Commands

### Essential Commands
```bash
# Start development (both worker + admin)
npm run dev

# Build for production
npm run build

# Deploy to Cloudflare
npm run deploy

# Run linting
npm run lint

# Validate deployment
npm run validate:local
```

### Worker-Specific Commands
```bash
# Start only the worker
npm run dev:worker

# Apply database schema
npm run db:apply:local

# View worker logs
npm run logs:tail

# Add secrets
npm run secrets:put --name=SECRET_NAME
```

### Admin-Specific Commands
```bash
# Start only the admin panel
npm run dev:admin

# Build admin for embedding
npm -w admin run build

# Preview production build
npm -w admin run preview
```

## 🎨 Development Workflow

### Making Changes

1. **Worker Changes**: Edit files in `worker/src/`
   - Changes auto-reload with `npm run dev:worker`
   - Test API endpoints at `http://localhost:8787/api/*`

2. **Admin Changes**: Edit files in `admin/src/`
   - Changes auto-reload with `npm run dev:admin`
   - React dev server at `http://localhost:5173`

3. **Database Changes**: Edit `worker/src/schema.sql`
   - Apply with `npm run db:apply:local`

### Environment Setup

Create `admin/.env.local` for admin development:
```env
VITE_API_BASE=http://localhost:8787
VITE_WORKER_DOMAIN=localhost:8787
```

### Hot Reload Setup
- **Worker**: Uses Wrangler's built-in hot reload
- **Admin**: Uses Vite's hot module replacement (HMR)
- **Database**: In-memory D1 resets on worker restart

## 🎨 Code Style Guidelines

### Worker Code (JavaScript)
```javascript
// Use ES modules and async/await
import { someFunction } from './utils.js';

export async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);
    const result = await someFunction(url.pathname);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Request failed:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
```

**Guidelines:**
- Use descriptive function and variable names
- Handle errors gracefully with try/catch
- Return proper HTTP status codes
- Use structured logging for debugging

### React Code (JSX)
```jsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

function LinkCreator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (data) => {
    try {
      setLoading(true);
      setError(null);
      await createLink(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-red-600 text-sm">{error}</div>
      )}
      <button 
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Create Link
      </button>
    </div>
  );
}
```

**Guidelines:**
- Use functional components with hooks
- Implement loading and error states
- Use Tailwind CSS for styling
- Import icons from Lucide React

## 🧪 Testing Your Changes

### Automated Validation
```bash
# Test local deployment
npm run validate:local

# Test production deployment
npm run validate:prod
```

### Manual Testing Checklist
- [ ] **Authentication**: Sign in/out with GitHub works
- [ ] **Link Management**: Create, edit, delete links
- [ ] **Redirects**: Short links redirect correctly
- [ ] **Password Protection**: Protected links require password
- [ ] **Analytics**: Click tracking and charts work
- [ ] **Mobile**: Interface works on mobile devices
- [ ] **Error Handling**: Graceful error messages

### Testing Password-Protected Links
1. Create a link with a password in the admin panel
2. Visit the short URL in an incognito window
3. Verify password prompt appears
4. Test with correct and incorrect passwords

### Testing Analytics
1. Create some test links
2. Visit them multiple times from different browsers/devices
3. Check the analytics dashboard for data
4. Verify charts and breakdowns are working

## 🐛 Debugging

### Worker Debugging
```bash
# Real-time logs
npm run logs:tail

# Filter for errors only
npm run logs:errors

# Filter for analytics
npm run logs:analytics
```

**Common Issues:**
- **Database errors**: Check D1 binding and schema
- **OAuth issues**: Verify GitHub app configuration
- **CORS errors**: Check API configuration

### Admin Panel Debugging
- **Browser DevTools**: Network tab for API calls
- **React DevTools**: Component state inspection
- **Console Errors**: JavaScript runtime errors

**Common Issues:**
- **API connection**: Check VITE_API_BASE in .env.local
- **Build errors**: Check Vite configuration
- **Styling issues**: Verify Tailwind CSS setup

## 🚀 Adding New Features

### Adding an API Endpoint
1. **Create handler** in `worker/src/routes/`
2. **Register route** in `worker/src/routes/routerApi.js`
3. **Add client method** in `admin/src/services/api.js`
4. **Create React hook** in `admin/src/hooks/` (if needed)

Example:
```javascript
// worker/src/routes/routesCustom.js
export async function handleCustomEndpoint(request, env) {
  return new Response(JSON.stringify({ message: 'Hello!' }));
}

// worker/src/routes/routerApi.js
import { handleCustomEndpoint } from './routesCustom.js';
// Add to route handler...

// admin/src/services/api.js
export const customApi = {
  greeting: () => fetch('/api/custom').then(r => r.json())
};
```

### Adding a UI Component
1. **Create component** in `admin/src/components/`
2. **Use Tailwind** for styling
3. **Handle states** (loading, error, success)
4. **Add to parent** component

### Updating Database Schema
1. **Edit** `worker/src/schema.sql`
2. **Apply locally**: `npm run db:apply:local`
3. **Test changes** thoroughly
4. **Apply to production**: `npm run db:apply:prod`

## ⚡ Performance Tips

### Worker Performance
- **Minimize database queries** - batch operations when possible
- **Use efficient SQL** - proper indexing and WHERE clauses
- **Cache responses** - set appropriate cache headers
- **Optimize redirects** - minimize redirect response time

### Frontend Performance
- **Lazy load components** - use React.lazy() for large components
- **Optimize bundles** - check bundle size with Vite
- **Implement virtualization** - for large lists
- **Use React.memo** - for expensive re-renders

## 🔒 Security Best Practices

- **Never log secrets** or sensitive user data
- **Validate all inputs** on both client and server
- **Use HTTPS** in production environments
- **Implement rate limiting** for sensitive endpoints
- **Regular security audits** of dependencies
- **Proper error handling** - don't leak internal details

---

*Ready to contribute? Check out our [Contributing Guide](./CONTRIBUTING.md) for guidelines on submitting pull requests!*
