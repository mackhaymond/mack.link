import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: {
					configPath: './wrangler.jsonc',
				},
				miniflare: {
					bindings: {
						AUTH_DISABLED: 'true',
						ENVIRONMENT: 'development',
						JWT_SECRET: 'test-secret-for-vitest',
						SESSION_ALLOW_INSECURE_COOKIES: 'true',
						ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:8787',
						ALLOWED_REDIRECT_URIS: 'http://localhost:5173/admin/auth/callback,http://localhost:8787/admin/auth/callback',
					},
				},
			},
		},
	},
});

