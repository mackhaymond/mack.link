import { describe, it, expect } from 'vitest';
import {
	timingSafeEqualHex,
	createPasswordHash,
	verifyPasswordHash,
	validatePasswordStrength,
} from '../src/password.js';

describe('Password utilities', () => {
	describe('timingSafeEqualHex', () => {
		it('returns true for equal strings', () => {
			expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
		});
		it('returns false for differing strings of same length', () => {
			expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
		});
		it('returns false for differing lengths', () => {
			expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
		});
		it('returns false for non-string inputs', () => {
			expect(timingSafeEqualHex(undefined, 'abc')).toBe(false);
			expect(timingSafeEqualHex('abc', null)).toBe(false);
		});
	});

	describe('createPasswordHash / verifyPasswordHash', () => {
		it('round-trips a strong password', async () => {
			const hash = await createPasswordHash('correct horse battery staple');
			expect(await verifyPasswordHash('correct horse battery staple', hash)).toBe(true);
		});
		it('rejects the wrong password', async () => {
			const hash = await createPasswordHash('correct horse battery staple');
			expect(await verifyPasswordHash('Tr0ub4dor&3', hash)).toBe(false);
		});
		it('produces different hashes for the same password (random salt)', async () => {
			const a = await createPasswordHash('correct horse battery staple');
			const b = await createPasswordHash('correct horse battery staple');
			expect(a).not.toBe(b);
		});
	});

	describe('validatePasswordStrength', () => {
		it('rejects short passwords', () => {
			expect(validatePasswordStrength('short').valid).toBe(false);
		});
		it('rejects known weak passwords', () => {
			expect(validatePasswordStrength('password').valid).toBe(false);
			expect(validatePasswordStrength('admin123').valid).toBe(false);
		});
		it('accepts strong passwords', () => {
			expect(validatePasswordStrength('a-strong-passphrase').valid).toBe(true);
		});
	});
});
