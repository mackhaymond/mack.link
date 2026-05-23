# Dev Auth Testing Results

## Setup
- Worker running on: http://localhost:8787
- Admin UI running on: http://localhost:5173/admin/
- Configuration: `.dev.vars` file with AUTH_DISABLED=true

## Test Results

### ✅ Test 1: Worker API with x-dev-auth header
```bash
curl -H "x-dev-auth: 1" http://localhost:8787/api/user
```
**Result**: Returns mock user `ai-dev`
```json
{
  "login": "ai-dev",
  "id": 0,
  "name": "AI Developer",
  "avatar_url": "https://avatars.githubusercontent.com/u/0?v=4"
}
```

### ✅ Test 2: Worker API without header (AUTH_DISABLED mode)
```bash
curl http://localhost:8787/api/user
```
**Result**: Returns mock user `ai-dev`
```json
{
  "login": "ai-dev",
  "id": 0,
  "name": "AI Developer",
  "avatar_url": "https://avatars.githubusercontent.com/u/0?v=4"
}
```

### ✅ Test 3: Protected endpoint (get links)
```bash
curl -H "x-dev-auth: 1" http://localhost:8787/api/links
```
**Result**: Returns empty array (no links created yet)
```json
[]
```

## Admin UI Configuration

The admin UI is configured to:
1. Set `VITE_AUTH_DISABLED=true` - tells the UI to skip OAuth flow
2. Set `VITE_API_BASE=http://localhost:8787` - points to local worker
3. Send `x-dev-auth: 1` header on all API requests (via shared HTTP client)

## How It Works

1. **Worker Side** (`.dev.vars`):
   - `AUTH_DISABLED=true` - Bypasses OAuth entirely
   - `SESSION_ALLOW_INSECURE_COOKIES=true` - Allows non-HTTPS cookies
   - `JWT_SECRET=dev-local` - Sets a dev-only JWT secret

2. **Admin Side** (environment variables):
   - `VITE_AUTH_DISABLED=true` - UI skips login screen
   - `VITE_API_BASE=http://localhost:8787` - Points to local worker
   - HTTP client automatically sends `x-dev-auth: 1` header

3. **Dual Protection**:
   - The `x-dev-auth` header works on localhost even if AUTH_DISABLED is false
   - AUTH_DISABLED=true makes all requests return mock user
   - Both methods work independently for maximum reliability

## Next Steps

Navigate to http://localhost:5173/admin/ to verify the UI:
- Should skip login screen automatically
- Should show "Auth disabled (dev)" badge in header
- Should be able to create/edit/delete links
- Should show mock user "AI Developer" in the UI

