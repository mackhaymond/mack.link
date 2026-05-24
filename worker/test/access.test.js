import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifyAccessJwt, _resetJwksCacheForTests } from '../src/access.js';
import { TEAM_DOMAIN, POLICY_AUD, generateKeypair, buildJwks, mintJwt, stubJwksFetch } from './_helpers/access-fixture.js';

describe('verifyAccessJwt (A1)', () => {
	let keypair;
	let jwks;
	let stub;

	beforeEach(async () => {
		_resetJwksCacheForTests();
		keypair = await generateKeypair();
		jwks = buildJwks(keypair.publicJwk);
		stub = stubJwksFetch(jwks);
	});

	afterEach(() => {
		stub.restore();
		_resetJwksCacheForTests();
	});

	it('accepts a valid signed JWT and returns its claims', async () => {
		const token = await mintJwt(keypair.privateKey);
		const payload = await verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD);
		expect(payload.email).toBe('user@example.com');
		expect(payload.sub).toBe('sub-test-1');
		expect(payload.iss).toBe(TEAM_DOMAIN);
		expect(payload.aud).toEqual([POLICY_AUD]);
	});

	it('throws on malformed JWT (not 3 parts)', async () => {
		await expect(verifyAccessJwt('not.a-jwt', TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/malformed jwt/);
	});

	it('throws when alg is not RS256', async () => {
		// Hand-craft a header with alg=HS256
		const headerB64 = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'test-key-1' }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const payloadB64 = btoa(JSON.stringify({ iss: TEAM_DOMAIN, aud: [POLICY_AUD] }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const token = `${headerB64}.${payloadB64}.signaturebytes`;
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/unsupported alg: HS256/);
	});

	it('throws when kid is not in JWKS', async () => {
		const token = await mintJwt(keypair.privateKey, { kid: 'unknown-key' });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/kid not found/);
	});

	it('throws on invalid signature (tampered payload)', async () => {
		const token = await mintJwt(keypair.privateKey);
		const parts = token.split('.');
		// Re-encode payload with a swapped email - sig no longer matches
		const tamperedPayload = btoa(JSON.stringify({ iss: TEAM_DOMAIN, aud: [POLICY_AUD], email: 'evil@example.com', exp: Math.floor(Date.now() / 1000) + 600 }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
		await expect(verifyAccessJwt(tampered, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/signature invalid/);
	});

	it('throws on expired JWT (exp in past)', async () => {
		const past = Math.floor(Date.now() / 1000) - 60;
		const token = await mintJwt(keypair.privateKey, { exp: past });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/expired/);
	});

	it('throws when iss does not match teamDomain', async () => {
		const token = await mintJwt(keypair.privateKey, { iss: 'https://attacker.cloudflareaccess.com' });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/iss mismatch/);
	});

	it('throws when aud does not include policyAud', async () => {
		const token = await mintJwt(keypair.privateKey, { aud: ['wrong-aud-123'] });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/aud mismatch/);
	});

	it('throws when aud is missing entirely', async () => {
		const token = await mintJwt(keypair.privateKey, { aud: null });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/missing aud/);
	});

	it('throws when nbf is in the future', async () => {
		const future = Math.floor(Date.now() / 1000) + 3600;
		const token = await mintJwt(keypair.privateKey, { nbf: future });
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD)).rejects.toThrow(/nbf in future/);
	});

	it('accepts aud as a string (not just array) per RFC 7519', async () => {
		const token = await mintJwt(keypair.privateKey, { aud: POLICY_AUD });
		const payload = await verifyAccessJwt(token, TEAM_DOMAIN, POLICY_AUD);
		expect(payload.email).toBe('user@example.com');
	});

	it('caches JWKS: 3 verifies within TTL = exactly 1 fetch', async () => {
		const t1 = await mintJwt(keypair.privateKey);
		const t2 = await mintJwt(keypair.privateKey, { email: 'user2@example.com' });
		const t3 = await mintJwt(keypair.privateKey, { email: 'user3@example.com' });
		await verifyAccessJwt(t1, TEAM_DOMAIN, POLICY_AUD);
		await verifyAccessJwt(t2, TEAM_DOMAIN, POLICY_AUD);
		await verifyAccessJwt(t3, TEAM_DOMAIN, POLICY_AUD);
		expect(stub.counter.calls).toBe(1);
	});

	it('throws if teamDomain or policyAud is missing', async () => {
		const token = await mintJwt(keypair.privateKey);
		await expect(verifyAccessJwt(token, '', POLICY_AUD)).rejects.toThrow(/teamDomain/);
		await expect(verifyAccessJwt(token, TEAM_DOMAIN, '')).rejects.toThrow(/policyAud/);
	});
});
