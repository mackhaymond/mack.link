import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { getAnalyticsStatements } from '../src/analytics.js';

describe('Analytics', () => {
	describe('getAnalyticsStatements', () => {
		it('should generate statements for a basic request', async () => {
			const headers = new Map([
				['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
				['Referer', 'https://example.com/page'],
			]);
			
			const mockRequest = {
				url: 'http://localhost:8787/test',
				headers: {
					get: (key) => headers.get(key) || null,
				},
				cf: {
					country: 'US',
					city: 'San Francisco',
					region: 'CA',
					timezone: 'America/Los_Angeles',
				},
			};

			const statements = await getAnalyticsStatements(env, mockRequest, 'test', '', null);

			expect(statements).toBeInstanceOf(Array);
			expect(statements.length).toBeGreaterThan(0);

			// Check for essential statement types
			const hasDayStatement = statements.some(s => 
				s.sql.includes('analytics_day') && s.bindings.includes('test')
			);
			const hasCountryAgg = statements.some(s => 
				s.sql.includes('analytics_agg') && s.bindings.includes('country')
			);
			const hasGlobalCounter = statements.some(s => 
				s.sql.includes('counters') && s.bindings.includes('analytics:_all:totalClicks')
			);

			expect(hasDayStatement).toBe(true);
			expect(hasCountryAgg).toBe(true);
			expect(hasGlobalCounter).toBe(true);
		});

		it('should handle UTM parameters', async () => {
			const headers = new Map([
				['User-Agent', 'Mozilla/5.0'],
			]);
			
			const mockRequest = {
				url: 'http://localhost:8787/test?utm_source=google&utm_medium=cpc&utm_campaign=summer',
				headers: {
					get: (key) => headers.get(key) || null,
				},
				cf: {
					country: 'US',
				},
			};

			const statements = await getAnalyticsStatements(env, mockRequest, 'test', '', null);

			const hasUtmSource = statements.some(s => 
				s.bindings.includes('utm_source') && s.bindings.includes('google')
			);
			const hasUtmMedium = statements.some(s => 
				s.bindings.includes('utm_medium') && s.bindings.includes('cpc')
			);
			const hasUtmCampaign = statements.some(s => 
				s.bindings.includes('utm_campaign') && s.bindings.includes('summer')
			);

			expect(hasUtmSource).toBe(true);
			expect(hasUtmMedium).toBe(true);
			expect(hasUtmCampaign).toBe(true);
		});

		it('should filter bot traffic appropriately', async () => {
			const headers = new Map([
				['User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
			]);
			
			const mockRequest = {
				url: 'http://localhost:8787/test',
				headers: {
					get: (key) => headers.get(key) || null,
				},
				cf: {
					country: 'US',
				},
			};

			const statements = await getAnalyticsStatements(env, mockRequest, 'test', '', null);

			// Analytics should still generate for bots (filtering happens at redirect level)
			expect(statements).toBeInstanceOf(Array);
			expect(statements.length).toBeGreaterThan(0);
		});

		it('should parse device type correctly', async () => {
			const testCases = [
				{ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', expected: 'mobile' },
				{ ua: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)', expected: 'tablet' },
				{ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', expected: 'desktop' },
			];

			for (const testCase of testCases) {
				const headers = new Map([
					['User-Agent', testCase.ua],
				]);
				
				const mockRequest = {
					url: 'http://localhost:8787/test',
					headers: {
						get: (key) => headers.get(key) || null,
					},
					cf: { country: 'US' },
				};

				const statements = await getAnalyticsStatements(env, mockRequest, 'test', '', null);
				const hasDevice = statements.some(s => 
					s.bindings.includes('device') && s.bindings.includes(testCase.expected)
				);

				expect(hasDevice).toBe(true);
			}
		});

		it('should return empty array on error', async () => {
			const mockRequest = null; // Invalid request

			const statements = await getAnalyticsStatements(env, mockRequest, 'test', '', { error: () => {} });

			expect(statements).toEqual([]);
		});
	});
});

