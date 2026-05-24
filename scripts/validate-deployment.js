#!/usr/bin/env node

/**
 * Deployment validator for mack.link.
 *
 * Sprint 2a (A4): auto-detects whether Cloudflare Access is in front of
 * the deployed site and runs the appropriate test suite:
 *
 *   - **Access mode**: probing /admin returns a 302 to *.cloudflareaccess.com.
 *     We can't see the SPA / API content from an anonymous client, so we
 *     POSITIVELY ASSERT that Access is intercepting (i.e. that someone
 *     hasn't accidentally disabled the Application or unlinked the policy).
 *     This is what `npm run validate:prod` runs against the live site.
 *
 *   - **Direct mode**: /admin returns 200 with the SPA shell directly.
 *     This is what `npm run validate:local` runs against `npm run dev:ai`
 *     (where Access doesn't intercept localhost) and what an unprotected
 *     *.workers.dev backend would look like. Runs the full content-level
 *     assertions on the SPA, assets, CORS, API surface.
 *
 * Usage:
 *   node scripts/validate-deployment.js [base-url]
 *
 * Default base-url: http://localhost:8787
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_BASE_URL = 'http://localhost:8787';
const TIMEOUT = 10000;
const ACCESS_HOST_RE = /\.cloudflareaccess\.com/i;

class DeploymentValidator {
  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
    this.accessMode = false;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '🔍',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      header: '📋'
    }[type] || 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async test(name, testFn) {
    try {
      this.log(`Testing: ${name}`);
      await testFn();
      this.log(`✓ ${name}`, 'success');
      this.passed++;
    } catch (error) {
      this.log(`✗ ${name}: ${error.message}`, 'error');
      this.failed++;
    }
  }

  async warn(name, testFn) {
    try {
      await testFn();
    } catch (error) {
      this.log(`⚠ ${name}: ${error.message}`, 'warning');
      this.warnings++;
    }
  }

  /**
   * Probe /admin (without following redirects) and return true if the
   * response is a 302 to *.cloudflareaccess.com. This is how we detect
   * Access is gating the site without hardcoding a deployment-specific URL.
   */
  async detectAccessMode() {
    try {
      const r = await this.fetch('/admin', { redirect: 'manual' });
      if (r.status !== 302) return false;
      const loc = r.headers.get('location') || '';
      return ACCESS_HOST_RE.test(loc);
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Tests common to both Access mode and Direct mode.
  // ──────────────────────────────────────────────────────────────────

  async validateCommon() {
    await this.test('Worker is responding', async () => {
      const response = await this.fetch('/');
      if (!response.ok && response.status !== 401 && response.status !== 302) {
        throw new Error(`Worker not responding: ${response.status}`);
      }
    });

    await this.test('Home page renders or redirects to /admin', async () => {
      // `/` is NOT gated by Cloudflare Access in our setup (the policy only
      // covers /admin* and /api/*). So this assertion is the same in both
      // modes: either render the marketing HTML (anonymous in prod) or
      // 302 to /admin (dev-auth mode mock user).
      const response = await this.fetch('/', { redirect: 'manual' });
      if (response.status === 302) {
        const loc = response.headers.get('location');
        if (loc !== '/admin') throw new Error(`Home redirect target unexpected: ${loc}`);
        return;
      }
      if (response.status !== 200) {
        throw new Error(`Expected 200 or 302, got ${response.status}`);
      }
      const html = await response.text();
      if (!html.includes('Sign in to Admin')) throw new Error('Home page missing "Sign in to Admin" button');
      if (!html.includes('href="/admin"')) throw new Error('Home page missing admin link');
      if (!html.includes('link.mackhaymond.co')) throw new Error('Home page missing title');
    });

    await this.test('Unknown shortcode returns 404 from the redirect handler', async () => {
      const response = await this.fetch('/no-such-shortcode-zzz123', { redirect: 'manual' });
      if (response.status !== 404) {
        throw new Error(`Expected 404 for unknown shortcode, got ${response.status}`);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Access-mode tests: assert Cloudflare Access is intercepting.
  // ──────────────────────────────────────────────────────────────────

  async validateAccessProtection() {
    await this.test('Cloudflare Access protects /admin', async () => {
      const response = await this.fetch('/admin', { redirect: 'manual' });
      if (response.status !== 302) {
        throw new Error(`Expected 302 to Access, got ${response.status} (Access app may be disabled)`);
      }
      const loc = response.headers.get('location') || '';
      if (!ACCESS_HOST_RE.test(loc)) {
        throw new Error(`Expected redirect to *.cloudflareaccess.com, got: ${loc}`);
      }
    });

    await this.test('Cloudflare Access protects /admin deep links', async () => {
      const response = await this.fetch('/admin/dashboard', { redirect: 'manual' });
      if (response.status !== 302 || !ACCESS_HOST_RE.test(response.headers.get('location') || '')) {
        throw new Error('Deep links into the SPA must also be Access-gated');
      }
    });

    await this.test('Cloudflare Access protects /api/*', async () => {
      const response = await this.fetch('/api/links', { redirect: 'manual' });
      if (response.status !== 302) {
        throw new Error(`/api/links must redirect through Access (got ${response.status})`);
      }
      const loc = response.headers.get('location') || '';
      if (!ACCESS_HOST_RE.test(loc)) {
        throw new Error(`/api/links redirect target unexpected: ${loc}`);
      }
    });

    await this.test('Cloudflare Access protects /api/auth/logout', async () => {
      // We don't actually want this endpoint reachable anonymously - it's
      // protected by the same Access app as the rest of /api/*. POST it
      // (the only method the Worker accepts) and verify Access intercepts.
      const response = await this.fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' });
      if (response.status !== 302 || !ACCESS_HOST_RE.test(response.headers.get('location') || '')) {
        throw new Error('Expected Access to intercept POST /api/auth/logout');
      }
    });

    await this.warn('Cloudflare Access bypass: /api/password/verify is public', async () => {
      // The password-protected-shortcode flow needs to work for anonymous
      // visitors. A separate Access "bypass" application should cover
      // exactly this path. If the bypass is missing or misconfigured,
      // anonymous password verification will 302 to login (broken UX for
      // visitors of password-protected short links).
      //
      // This is a *configuration* check (warning), not a hard fail: the
      // PR fixing the Access auth code shouldn't be blocked by a missing
      // Access dashboard rule. If you see this warning, add a Bypass
      // Application for the path /api/password/verify in the Cloudflare
      // Zero Trust dashboard.
      const response = await this.fetch('/api/password/verify', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcode: 'nope', password: 'x' }),
      });
      if (response.status === 302 && ACCESS_HOST_RE.test(response.headers.get('location') || '')) {
        throw new Error('Access is gating /api/password/verify - add a Bypass Application in the CF Zero Trust dashboard');
      }
    });

    await this.test('Short-link redirects are NOT Access-gated', async () => {
      // /{shortcode} must reach the Worker directly so external visitors
      // can follow links without seeing an Access login screen.
      // We probe with a non-existent shortcode: the Worker returns 404,
      // Access would return 302. Anything other than a same-origin
      // response from the Worker indicates Access regressed onto / paths.
      const response = await this.fetch('/no-such-shortcode-validator', { redirect: 'manual' });
      if (response.status === 302) {
        const loc = response.headers.get('location') || '';
        if (ACCESS_HOST_RE.test(loc)) {
          throw new Error('Access has erroneously been placed in front of short-link redirects');
        }
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Direct-mode tests: no Access in front - content-level assertions.
  // ──────────────────────────────────────────────────────────────────

  async validateAdminPanelServing() {
    await this.test('Admin panel serves at /admin', async () => {
      const response = await this.fetch('/admin');
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      const contentType = response.headers.get('content-type');
      if (!contentType.includes('text/html')) throw new Error(`Expected HTML, got ${contentType}`);
      const html = await response.text();
      if (!html.includes('<div id="root">')) throw new Error('Admin panel missing React root element');
      if (!html.includes('/admin/assets/')) throw new Error('Admin panel missing asset references');
    });

    await this.test('Admin panel serves with trailing slash', async () => {
      const response = await this.fetch('/admin/');
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
    });
  }

  async validateSPARouting() {
    const routes = ['/admin/login', '/admin/dashboard', '/admin/some-deep-route'];
    for (const route of routes) {
      await this.test(`SPA routing works for ${route}`, async () => {
        const response = await this.fetch(route);
        if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
        const html = await response.text();
        if (!html.includes('<div id="root">')) throw new Error('SPA route not serving React app');
      });
    }
  }

  async validateAssetServing() {
    const adminResponse = await this.fetch('/admin');
    const adminHtml = await adminResponse.text();
    const cssMatches = adminHtml.match(/href="\/admin\/(assets\/[^"]+\.css)"/g) || [];
    const jsMatches = adminHtml.match(/src="\/admin\/(assets\/[^"]+\.js)"/g) || [];
    const cssAssets = cssMatches.map(m => m.match(/href="\/admin\/([^"]+)"/)[1]);
    const jsAssets = jsMatches.map(m => m.match(/src="\/admin\/([^"]+)"/)[1]);

    for (const asset of cssAssets) {
      await this.test(`CSS asset serves: ${asset}`, async () => {
        const response = await this.fetch(`/admin/${asset}`);
        if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
        const contentType = response.headers.get('content-type');
        if (!contentType.includes('text/css')) throw new Error(`Expected CSS, got ${contentType}`);
        const cacheControl = response.headers.get('cache-control') || '';
        if (!cacheControl.includes('max-age=31536000')) throw new Error('CSS asset missing long cache headers');
      });
    }

    for (const asset of jsAssets) {
      await this.test(`JS asset serves: ${asset}`, async () => {
        const response = await this.fetch(`/admin/${asset}`);
        if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
        // RFC 9239: text/javascript is canonical; the Static Assets binding
        // serves it. Accept either application/javascript or text/javascript.
        const contentType = response.headers.get('content-type');
        if (!/\bjavascript\b/i.test(contentType || '')) {
          throw new Error(`Expected JS content type, got ${contentType}`);
        }
      });
    }

    await this.test('Favicon serves correctly', async () => {
      const response = await this.fetch('/admin/favicon.jpg');
      if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
      const contentType = response.headers.get('content-type');
      if (!contentType.includes('image/')) throw new Error(`Expected image, got ${contentType}`);
    });
  }

  async validateCORSConfiguration() {
    await this.test('Admin routes have no CORS headers', async () => {
      const response = await this.fetch('/admin');
      if (response.headers.get('access-control-allow-origin') !== null) {
        throw new Error('Admin routes should not have CORS headers');
      }
    });

    await this.test('API CORS preflight reflects allow-listed Origin', async () => {
      // C3: CORS now requires an allow-listed Origin.
      const origin = this.baseUrl.startsWith('http://localhost') || this.baseUrl.startsWith('http://127.0.0.1')
        ? this.baseUrl
        : 'https://link.mackhaymond.co';
      const response = await this.fetch('/api/links', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      });
      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Expected 200/204, got ${response.status}`);
      }
      const corsOrigin = response.headers.get('access-control-allow-origin');
      if (!corsOrigin) throw new Error('API preflight should reflect Origin from the allow-list');
    });
  }

  async validateAPIEndpoints() {
    await this.test('API endpoint is reachable (returns 200 or 401, not 404)', async () => {
      const response = await this.fetch('/api/links');
      if (response.status === 404) throw new Error('API endpoint not found');
      if (response.status !== 401 && response.status !== 200) {
        throw new Error(`Expected 401 or 200, got ${response.status}`);
      }
    });
  }

  async validateBuildArtifacts() {
    // Sprint 1 (S1) wired up Cloudflare's Static Assets binding to serve
    // admin/dist directly. There's no on-disk artifact to introspect from
    // here; instead we fetch /admin and verify the SPA shell came through.
    await this.test('Admin SPA is served via Static Assets binding', async () => {
      const response = await this.fetch('/admin');
      if (response.status !== 200) throw new Error(`/admin returned ${response.status}, expected 200`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) throw new Error(`/admin content-type is "${contentType}", expected text/html`);
      const html = await response.text();
      if (!html.includes('<div id="root">')) throw new Error('/admin response missing React mount point (<div id="root">)');
      if (!html.includes('/admin/assets/')) throw new Error('/admin response missing /admin/assets/ references - build may have failed');
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Soft performance checks. These produce warnings, not failures.
  // ──────────────────────────────────────────────────────────────────

  async validatePerformance() {
    await this.warn('Admin route loads quickly', async () => {
      const start = Date.now();
      const response = await this.fetch('/admin', { redirect: 'manual' });
      const duration = Date.now() - start;
      if (response.status !== 200 && response.status !== 302) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      if (duration > 2000) {
        throw new Error(`Admin route took ${duration}ms (should be < 2000ms)`);
      }
    });

    if (!this.accessMode) {
      // In Access mode the response is the Access login HTML, which is
      // larger than our SPA shell - asserting a hard byte limit here would
      // be measuring Cloudflare's UI, not ours.
      await this.warn('Admin SPA shell is small', async () => {
        const response = await this.fetch('/admin');
        const html = await response.text();
        if (html.length > 10 * 1024) {
          throw new Error(`SPA shell HTML is ${Math.round(html.length / 1024)}KB (should be < 10KB)`);
        }
      });
    }
  }

  async runAllValidations() {
    this.log('🚀 Starting deployment validation...', 'header');
    this.log(`Testing against: ${this.baseUrl}`);

    try {
      this.accessMode = await this.detectAccessMode();
      this.log(
        this.accessMode
          ? '🛡️  Cloudflare Access detected in front of /admin and /api/* — running access-mode tests'
          : '🔓 No Cloudflare Access detected (workers.dev or localhost) — running direct-mode tests',
        'header',
      );

      await this.validateCommon();

      if (this.accessMode) {
        await this.validateAccessProtection();
      } else {
        await this.validateAdminPanelServing();
        await this.validateSPARouting();
        await this.validateAssetServing();
        await this.validateCORSConfiguration();
        await this.validateAPIEndpoints();
        await this.validateBuildArtifacts();
      }

      await this.validatePerformance();
    } catch (error) {
      this.log(`Validation failed with error: ${error.message}`, 'error');
      this.failed++;
    }

    this.log('', 'info');
    this.log('📊 Validation Summary:', 'header');
    this.log(`Mode: ${this.accessMode ? 'access' : 'direct'}`);
    this.log(`✅ Passed: ${this.passed}`);
    this.log(`❌ Failed: ${this.failed}`);
    this.log(`⚠️  Warnings: ${this.warnings}`);

    if (this.failed === 0) {
      this.log('🎉 All validations passed! Deployment is ready.', 'success');
      return true;
    } else {
      this.log('💥 Some validations failed. Please fix issues before deploying.', 'error');
      return false;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.argv[2] || DEFAULT_BASE_URL;
  const validator = new DeploymentValidator(baseUrl);
  validator.runAllValidations()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Validation script failed:', error);
      process.exit(1);
    });
}

export { DeploymentValidator };
