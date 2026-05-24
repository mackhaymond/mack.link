import { describe, it, expect } from 'vitest';
import { parseUA } from '../src/analytics.js';

const fixtures = [
	{
		name: 'Brave on macOS',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Brave/120',
		expect: { device: 'desktop', os: 'macos' },
	},
	{
		name: 'Vivaldi on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Vivaldi/6.4.3160.42',
		expect: { device: 'desktop', os: 'windows' },
	},
	{
		name: 'Samsung Internet on Android',
		ua: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
		expect: { device: 'mobile', os: 'android' },
	},
	{
		name: 'Headless Chrome',
		ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
		expect: { device: 'desktop', os: 'linux' },
	},
	{
		name: 'iPhone Safari',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
		expect: { device: 'mobile', os: 'ios' },
	},
	{
		name: 'iPad',
		ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
		expect: { device: 'tablet', os: 'ios' },
	},
	{
		name: 'Edge on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
		expect: { device: 'desktop', os: 'windows' },
	},
	{
		name: 'empty UA',
		ua: '',
		expect: { device: 'desktop', browser: 'other', os: 'other' },
	},
];

describe('parseUA (M6)', () => {
	for (const f of fixtures) {
		it(`handles ${f.name}`, () => {
			const r = parseUA(f.ua);
			for (const [k, v] of Object.entries(f.expect)) {
				expect(r[k], `key=${k} for ${f.name}`).toBe(v);
			}
		});
	}
});
