import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '../src/logger.js';

describe('Logger PII scrubbing (M14)', () => {
	it('redacts known secret keys', () => {
		expect(scrubSecrets('authorization', 'Bearer abc')).toBe('[REDACTED]');
		expect(scrubSecrets('Cookie', 'sess=xyz')).toBe('[REDACTED]');
		expect(scrubSecrets('Set-Cookie', 'sess=xyz')).toBe('[REDACTED]');
		expect(scrubSecrets('password', 'hunter2')).toBe('[REDACTED]');
		expect(scrubSecrets('JWT_SECRET', 'shhh')).toBe('[REDACTED]');
		expect(scrubSecrets('x-dev-auth', '1')).toBe('[REDACTED]');
	});

	it('leaves benign keys untouched', () => {
		expect(scrubSecrets('shortcode', 'gh')).toBe('gh');
		expect(scrubSecrets('clientIP', '1.2.3.4')).toBe('1.2.3.4');
	});

	it('redacts credential params in URLs', () => {
		const out = scrubSecrets('url', 'https://example.com/foo?session=abc&password=p&keep=ok');
		expect(out).toContain('session=REDACTED');
		expect(out).toContain('password=REDACTED');
		expect(out).toContain('keep=ok');
	});

	it('truncates URLs at 2KB', () => {
		const long = 'https://example.com/' + 'a'.repeat(3000);
		const out = scrubSecrets('url', long);
		expect(out.length).toBeLessThan(long.length);
		expect(out).toContain('truncated');
	});
});
