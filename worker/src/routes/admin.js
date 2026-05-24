// S1: serves the admin SPA via Cloudflare's Static Assets binding (env.ASSETS),
// configured under `assets` in wrangler.jsonc. Replaces the previous
// `admin-assets.js` embed pipeline (build-admin.js -> JSON-encoded bundle
// inlined into the Worker JS) which inflated the Worker bundle by ~820 KB
// and ate worker-bundle budget headroom.
//
// URL prefix translation:
//   - The admin app is served at /admin/* (Vite `base: '/admin/'`), so
//     references inside index.html look like `/admin/assets/index-abc.js`.
//   - On disk the Vite build emits those files at `admin/dist/assets/...`
//     (flat at dist root, NOT nested under `/admin`).
//   - The Static Assets binding maps request pathname -> filesystem path
//     under `directory`, so we MUST strip the leading `/admin` from the
//     request URL before delegating, otherwise every asset 404s and the
//     SPA fallback kicks in for JS/CSS requests (serving HTML with the
//     wrong content-type and breaking the page).
//
// SPA routing:
//   - `not_found_handling: "single-page-application"` in wrangler.jsonc
//     makes the binding return index.html (200) for any unmatched path,
//     so deep links like /admin/dashboard work without a worker-side
//     fallback table.
//
// Cache headers:
//   - In production, Cloudflare's CDN automatically sets long max-age +
//     immutable on hashed `/assets/*` files and no-cache on HTML. Local
//     Miniflare does not reliably reproduce those headers (the validate
//     script in scripts/validate-deployment.js asserts CSS long-cache
//     headers, which would otherwise regress under dev).
//   - We re-apply the same headers the old `admin-assets.js` handler did,
//     wrapping the binding's Response so dev + prod behave identically.
export async function handleAdmin(request, env) {
	const url = new URL(request.url);
	// /admin -> /, /admin/ -> /, /admin/dashboard -> /dashboard,
	// /admin/assets/x.js -> /assets/x.js
	const strippedPath = url.pathname.replace(/^\/admin/, '') || '/';
	const isHashedAsset = strippedPath.startsWith('/assets/');
	url.pathname = strippedPath;
	const response = await env.ASSETS.fetch(new Request(url.toString(), request));
	const headers = new Headers(response.headers);
	headers.set(
		'Cache-Control',
		isHashedAsset
			? 'public, max-age=31536000, immutable'
			: 'no-cache, no-store, must-revalidate',
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
