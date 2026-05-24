# 📡 API Reference

Complete documentation for Mack.link's REST API endpoints. All endpoints support JSON requests and responses.

## 🌐 Base URL

Replace `YOUR_DOMAIN` with your deployed worker domain:

```
https://YOUR_DOMAIN.com
```

**Live Demo API**: `https://link.mackhaymond.co`

## 🔐 Authentication

Authentication is handled by **Cloudflare Access** at the edge. The Worker
verifies the `Cf-Access-Jwt-Assertion` header that Access injects on
proxied requests; it doesn't issue its own session cookies or run an
OAuth flow.

For the full path-coverage table (which paths Access protects vs.
bypasses, the dev-bypass model, and the JWT verification logic), see
[SECURITY.md](../SECURITY.md).

For browser-facing flows: the admin SPA reads identity from
`/cdn-cgi/access/get-identity` after Access logs the user in. No
session cookie handling is required in the client.

For automated API access: you need a Cloudflare Access **service token**
(client ID + client secret) issued from the Zero Trust dashboard. Pass
them as `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers:

```bash
curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     https://link.mackhaymond.co/api/links
```

The Worker's previous GitHub OAuth flow (`GET /api/auth/github`,
`GET /admin/auth/callback`) was removed in Sprint 2a. The only
auth-related endpoint left is `POST /api/auth/logout`, which returns
the Cloudflare Access logout URL for the SPA to navigate to.

---

## 🔓 Public Endpoints

### Redirect Links

#### `GET /{shortcode}`

Redirects visitors to the destination URL and tracks analytics.

**Parameters:**
- `shortcode` - The unique identifier for your link

**Response Codes:**
- `301/302` - Successful redirect to destination
- `403` - Link requires password or not yet active
- `404` - Link not found
- `410` - Link has expired

**Example:**
```bash
curl -I https://link.mackhaymond.co/demo
# HTTP/1.1 301 Moved Permanently
# Location: https://github.com/mackhaymond/mack.link
```

### Password Protected Links

#### `POST /{shortcode}`

Submit password for protected links.

**Request Body:**
```json
{
  "password": "your-password-here"
}
```

**Response:**
- `200` - Password correct, sets access cookie
- `401` - Invalid password
- `404` - Link not found

---

## 🔑 Authentication Endpoints

#### `POST /api/auth/logout`

Returns the Cloudflare Access logout URL. The admin SPA navigates to
this URL to clear the `CF_Authorization` cookie and bounce the user
back to the Access login page.

**Response:**
```json
{
  "logout": "https://YOUR-TEAM.cloudflareaccess.com/cdn-cgi/access/logout"
}
```

---

## 🔐 Protected API Endpoints

All endpoints below require a valid Cloudflare Access JWT (verified by the
Worker via `Cf-Access-Jwt-Assertion`) or a valid Access service token
(`CF-Access-Client-Id` + `CF-Access-Client-Secret`). See the
Authentication section above.

### Link Management

#### `GET /api/links`

Retrieve all your links. Supports both complete and paginated responses.

**Query Parameters:**
- `limit` (optional) - Max links per page (1-1000)
- `cursor` (optional) - Pagination cursor from previous response

**Complete Response** (no pagination params):
```json
{
  "abc123": {
    "url": "https://example.com",
    "description": "My awesome link",
    "redirectType": 301,
    "created": "2024-01-15T10:30:00Z",
    "updated": "2024-01-15T10:30:00Z",
    "clicks": 42,
    "lastClicked": "2024-01-16T15:45:30Z",
    "password": null,
    "activatesAt": null,
    "expiresAt": null,
    "archived": false
  }
}
```

**Paginated Response** (with limit/cursor):
```json
{
  "links": {
    "abc123": { /* link object */ }
  },
  "cursor": "eyJzaG9ydGNvZGUiOiJhYmMxMjMifQ",
  "hasMore": true
}
```

#### `POST /api/links`

Create a new short link.

**Request Body:**
```json
{
  "shortcode": "my-link",
  "url": "https://example.com",
  "description": "Optional description",
  "redirectType": 301,
  "password": "optional-password",
  "activatesAt": "2024-02-01T00:00:00Z",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**Response:**
```json
{
  "shortcode": "my-link",
  "url": "https://example.com",
  "description": "Optional description",
  "redirectType": 301,
  "created": "2024-01-15T10:30:00Z",
  "updated": "2024-01-15T10:30:00Z",
  "clicks": 0,
  "password": "••••••••",
  "activatesAt": "2024-02-01T00:00:00Z",
  "expiresAt": "2024-12-31T23:59:59Z",
  "archived": false
}
```

**Error Responses:**
- `400` - Missing required fields or invalid data
- `409` - Shortcode already exists

#### `PUT /api/links/{shortcode}`

Update an existing link.

**Request Body:** (all fields optional)
```json
{
  "url": "https://new-url.com",
  "description": "Updated description",
  "redirectType": 302,
  "password": "new-password",
  "activatesAt": null,
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

**Response:** Updated link object (same as POST response)

#### `DELETE /api/links/{shortcode}`

Delete a link permanently.

**Response:**
- `204` - Link deleted successfully
- `404` - Link not found

#### `GET /api/links/{shortcode}`

Get details for a specific link.

**Response:** Single link object (same format as GET /api/links)

### Bulk Operations

#### `POST /api/links/bulk`

Create multiple links at once (up to 100).

**Request Body:**
```json
{
  "items": [
    {
      "shortcode": "link1",
      "url": "https://example.com",
      "description": "First link"
    },
    {
      "shortcode": "link2", 
      "url": "https://example.org"
    }
  ]
}
```

**Response:**
```json
{
  "created": [
    { "shortcode": "link1", "url": "https://example.com", /* ... */ }
  ],
  "conflicts": ["link2"],
  "errors": [
    { "shortcode": "invalid", "error": "Invalid URL format" }
  ]
}
```

#### `DELETE /api/links/bulk`

Delete multiple links at once.

**Request Body:**
```json
{
  "shortcodes": ["link1", "link2", "link3"]
}
```

**Response:**
```json
{
  "deleted": ["link1", "link3"],
  "notFound": ["link2"]
}
```

### Analytics

#### `GET /api/analytics/overview`
Get summary analytics for all links or a specific link.

**Query Parameters:**
- `shortcode` (optional) - Get analytics for specific link only
- `from` (optional) - Start date (ISO 8601)
- `to` (optional) - End date (ISO 8601)

**Response:**
```json
{
  "totalClicks": 1250,
  "totalLinks": 42,
  "todayClicks": 15,
  "last7DaysClicks": 127
}
```

#### `GET /api/analytics/timeseries`
Get click data over time for charts.

**Query Parameters:**
- `shortcode` (optional) - Specific link or global if omitted
- `from` (optional) - Start date (ISO 8601)
- `to` (optional) - End date (ISO 8601)

**Response:**
```json
{
  "data": [
    { "date": "2024-01-15", "clicks": 25 },
    { "date": "2024-01-16", "clicks": 42 }
  ]
}
```

#### `GET /api/analytics/timeseries-links`
Get timeseries data for top performing links.

**Query Parameters:**
- `from` (optional) - Start date (ISO 8601)
- `to` (optional) - End date (ISO 8601)
- `limit` (optional) - Number of top links (default: 5)

#### `GET /api/analytics/breakdown`
Get detailed breakdowns by dimension.

**Query Parameters:**
- `shortcode` (optional) - Specific link or global if omitted
- `dimension` (optional) - One of: `ref`, `country`, `city`, `device`, `os`, `browser` (default: `ref`)
- `limit` (optional) - Number of results (default: 10)
- `from` (optional) - Start date (ISO 8601)
- `to` (optional) - End date (ISO 8601)

**Response:**
```json
{
  "dimension": "ref",
  "data": [
    { "key": "twitter.com", "clicks": 127 },
    { "key": "facebook.com", "clicks": 89 }
  ]
}
```

#### `GET /api/analytics/export`
Export analytics data for download.

**Query Parameters:**
- `shortcode` (optional) - Specific link or global if omitted  
- `from` (optional) - Start date (ISO 8601)
- `to` (optional) - End date (ISO 8601)
- `format` (optional) - Export format: `json` (default)

**Response:** JSON file download with comprehensive analytics data.

### User Management

#### `GET /api/user`
Get current authenticated user information.

**Response:**
```json
{
  "login": "your-username",
  "id": 123456,
  "avatar_url": "https://avatars.githubusercontent.com/u/123456",
  "name": "Your Name"
}
```

### Metadata

#### `GET /api/meta/reserved-paths`
Get list of reserved paths that cannot be used as shortcodes.

**Response:**
```json
{
  "reserved": [
    "admin", "api", "auth", "oauth", "callback",
    "www", "mail", "ftp", "assets", "static"
  ],
  "count": 45,
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

**Headers:** Includes cache headers (`Cache-Control`, `ETag`) for efficient repeated requests.

---

## 📊 Data Models

### Link Object
```typescript
interface Link {
  url: string;                    // Destination URL
  description?: string;           // Optional description
  redirectType: 301 | 302 | 307 | 308;       // HTTP redirect status
  created: string;                // ISO 8601 timestamp
  updated: string;                // ISO 8601 timestamp
  clicks: number;                 // Total click count
  lastClicked?: string;           // ISO 8601 timestamp of last click
}
```

### User Object
```typescript
interface User {
  login: string;                  // Email address (full) — post-Sprint-2b
  email: string;                  // Same as login
  id: string;                     // Cloudflare Access subject claim (`sub`)
  avatar_url: string;             // Profile picture URL (may be empty)
  name?: string;                  // Display name
}
```

---

## Error Codes

- `400` - Bad Request (invalid data)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (user not authorized)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (shortcode already exists)
- `500` - Internal Server Error

## Rate Limits

Refer to Cloudflare’s current limits for Workers and D1. Actual quotas vary by plan and are subject to change. For most personal projects on free tiers, this application will comfortably operate within default limits.

## CORS

- Admin routes under `/admin` are same-origin and do not require CORS.
- API routes include permissive CORS headers: the worker echoes the request `Origin` when present (or `*`), allows credentials, and sets `Vary: Origin`.

Example headers:
```
Access-Control-Allow-Origin: https://your-site.example
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Vary: Origin
```

---

*For implementation examples, see the admin panel source code.*
