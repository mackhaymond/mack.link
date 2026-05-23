import { describe, it, expect } from 'vitest';
import { getConfig, isDevBypassEligible, requireJwtSecret } from '../src/config.js';

describe('Auth config', () => {
	describe('isDevBypassEligible', () => {
		it('is true only when both AUTH_DISABLED=true and ENVIRONMENT=development', () => {
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true', ENVIRONMENT: 'development' })).toBe(true);
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true' })).toBe(false);
			expect(isDevBypassEligible({ ENVIRONMENT: 'development' })).toBe(false);
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true', ENVIRONMENT: 'production' })).toBe(false);
			expect(isDevBypassEligible({})).toBe(false);
		});

		it('is case-insensitive on values', () => {
			expect(isDevBypassEligible({ AUTH_DISABLED: 'TRUE', ENVIRONMENT: 'DEVELOPMENT' })).toBe(true);
		});
	});

	describe('requireJwtSecret', () => {
		it('throws in production when JWT_SECRET is missing', () => {
			expect(() => requireJwtSecret({})).toThrow(/JWT_SECRET is required/);
			expect(() => requireJwtSecret({ AUTH_DISABLED: 'true' })).toThrow(/JWT_SECRET is required/);
		});

		it('returns the configured secret when present', () => {
			expect(requireJwtSecret({ JWT_SECRET: 'prod-secret' })).toBe('prod-secret');
		});

		it('returns a deterministic dev fallback in dev bypass mode', () => {
			const secret = requireJwtSecret({ AUTH_DISABLED: 'true', ENVIRONMENT: 'development' });
			expect(typeof secret).toBe('string');
			expect(secret.length).toBeGreaterThan(0);
		});
	});

	describe('getConfig', () => {
		it('does not surface a JWT secret fallback unless dev-eligible', () => {
			expect(getConfig({}).jwtSecret).toBeUndefined();
			expect(getConfig({ AUTH_DISABLED: 'true' }).jwtSecret).toBeUndefined();
		});

		it('parses ALLOWED_ORIGINS and ALLOWED_REDIRECT_URIS as comma-separated lists', () => {
			const cfg = getConfig({
				ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
				ALLOWED_REDIRECT_URIS: 'https://a.example.com/cb',
			});
			expect(cfg.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
			expect(cfg.allowedRedirectUris).toEqual(['https://a.example.com/cb']);
		});
	});
});
