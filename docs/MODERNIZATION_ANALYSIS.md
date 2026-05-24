# mack.link modernization analysis

Independent, evidence-based modernization analysis as of May 2026. Picks up
mid-stride after PRs #37–#40 (audit remediation → Static Assets binding →
Cloudflare Access auth → native rate-limit + D1 Sessions API + CSP nonces +
email-based identity).

Scope: code layout, stack, structure. Constraints: stay on Cloudflare, stay
$0/month (Workers Paid `$5/mo` is the explicit boundary), don't break the
Cloudflare Access integration, no destructive D1 changes.

> **Trajectory note.** The "Sprint 2b prompt sits un-executed" line in the
> originating brief is stale — Sprint 2b shipped in PR #40 (`21f94c5`,
> on `main`). Everything that prompt proposed is in the tree: native
> `ratelimits` bindings (`worker/src/rateLimit.js`), D1 Sessions API in
> `worker/src/routes.js`, nonce-based CSP on the password prompt
> (`worker/src/securityHeaders.js`), `AUTHORIZED_USER` check removed,
> identity is the full email, and migration `006_owner_id_email.sql`
> renames historical `gh:*` `owner_id` rows. This analysis treats the
> Sprint 2b list as **done**, not pending.

---

## 1. Executive summary

The codebase is in **better shape than the brief implies**. Four sprints of
focused work have already shipped most of the obvious wins: Static Assets,
native rate-limit, D1 read replication, Access JWT, CSP nonces, multi-tenancy.
What's left is mostly **type safety** and **routing ergonomics**, not
architectural debt.

**Single biggest win**: ✅ **incremental TypeScript** (start with
`// @ts-check` headers + ambient types in `packages/shared`, then convert
files file-by-file). The existing JSDoc is already substantial — TS is
formalising what's there, not inventing it. ROI is permanent; risk is low
because it's reversible per-file.

**Next 2-3 wins (in order)**:

1. **Migrate `@cloudflare/vitest-pool-workers` 0.12.21 → 0.16.x** via
   Cloudflare's automated codemod. Clears the only known security advisory
   noise from PR #37 and unlocks Vitest 4.x. ~1 day.
2. **Adopt Hono** for routing. ~200 LOC of `withCors()` / try-catch /
   string-dispatch boilerplate goes away; Hono's RPC client unlocks
   end-to-end types between `worker/` and `admin/` once TS lands. ~2 days.
3. **Per-PR Worker name** for previews (`worker-pr-{N}` instead of the
   single shared `worker-staging` slot), with a `pull_request.closed`
   cleanup job. Keeps the shared staging D1 (avoids D1 quota). ~0.5 day.

**What NOT to do**:

- **Don't replace `worker/scripts/migrate.mjs` with `wrangler d1 migrations`.**
  The custom runner exists for a real reason — programmatic
  `PRAGMA table_info()` gating on ALTERs, env-var-driven backfills, the
  `006_owner_id_email.sql` rename. Wrangler's builtin can't do any of that.
  The prior thread's recommendation here was wrong.
- **Don't flag-day the TS migration.** Heavy JSDoc + `@ts-check` is the
  right path; a full rewrite is unforced risk.
- **Don't adopt Prisma on D1.** 216× the Drizzle bundle, 4× slower cold
  start, D1 adapter still Preview.
- **Don't migrate to per-PR D1 databases** until you regularly have 5+
  concurrent open PRs. Free plan caps at 10 D1 databases per account;
  cleanup-failure orphans will bite you before isolation pays back.

---

## 2. Current-state assessment

Honest critique. Adjective-free.

### What's good — don't touch

| File / area | Why it's good |
|---|---|
| `worker/src/db.js` | 4 helpers (`dbGet`/`dbAll`/`dbRun`/`dbBatch`), 60 LOC, parameterised everywhere. No string interpolation in production code. JSDoc on every function. |
| `worker/src/access.js` | RS256 JWKS verification with per-isolate 1h cache. Zero npm deps (Web Crypto + `atob`). 13 tests with an in-process RSA fixture (`worker/test/_helpers/access-fixture.js`). |
| `worker/src/rateLimit.js` | Native Cloudflare rate-limit binding wrapper; fail-open design; 4 explicit limit classes. Sub-ms in prod. |
| `worker/src/routes.js` D1 Session bookmark wiring | `handleAPIWithSession()` threads `x-d1-bookmark` header end-to-end. Read-your-writes consistency without polluting hot-path code. |
| `worker/src/securityHeaders.js` nonce-based CSP | Per-response random nonce, applied only to HTML responses that need it. No `'unsafe-inline'`. |
| `worker/src/logger.js` | Structured JSON, PII scrub via a custom replacer (4 tests). |
| `admin/src/hooks/useModalA11y.js` | Focus trap + Esc + dirty confirm + scroll lock + focus restore in 67 LOC. Hand-rolled but correct. (See § 5 for whether to replace with Radix.) |
| `admin/src/providers/QueryProvider.jsx` | Sensible defaults: no 4xx retry, exponential backoff capped at 30s, polling pauses on `document.hidden`. |
| `worker/test/*.test.js` | 14 files, 1,590 LOC, ~0.44 test:src ratio. Real `vitest-pool-workers` integration tests (multitenancy IDOR, cron, redirect race). |
| Sprint 1's `assets.run_worker_first: true` decision | Documented in PR description. Without it, the Static Assets binding eats `/` before the marketing-page handler runs. Catch this once, document it forever. |

### What's middling — could change but pick your battles

| Area | The issue |
|---|---|
| **Routing dispatch** (`worker/src/routes.js`, `routes/routerApi.js`) | Hand-rolled string-prefix `if/switch`. Currently fine — 16 API endpoints, all in two files. But every new route is a manual edit in two places (URL prefix in `routes.js`, handler dispatch in `routerApi.js`), and CORS / error wrapping / auth gating is ad-hoc per handler. This is what Hono fixes. |
| **Raw SQL in `worker/src/routes/routesLinks.js`** | 591 LOC, 20 SQL strings. All parameterised, but the same column list (`shortcode, url, description, redirect_type, ...`) is repeated across getAll / get / create / update. Adding a new `links` column is 4 edits across one file. |
| **`worker/src/analytics.js` `buildAnalyticsStatements()`** | Generates ~24 INSERT-OR-CONFLICT statements per click. Hand-stitched table/dimension matrix. Works, but unreadable; the type of code that gets broken every time someone adds a dimension. This is the strongest argument for Drizzle. |
| **`admin/src/components/CreateLinkForm.jsx` (493 LOC) + `EditLinkModal.jsx` (452 LOC)** | Hand-rolled form state per field, manual validation (`validateField()`), real-time + on-submit dual validation. Half the LOC is form bookkeeping. React Hook Form + Zod would cut this roughly in half. |
| **`admin/src/components/Analytics.jsx` (781 LOC)** | One file does charts, stat cards, date range, scope switching, breakdown rendering. Splittable, but not painful. |
| **JSDoc coverage is uneven** | `db.js`, `auth.js`, `access.js`, `validation.js`, `password.js`, `logger.js`, `rateLimit.js`, `utils.js`, `cors.js` are well-documented. `routes/routesLinks.js`, `analytics.js`, `routes/redirect.js`, `routes.js` are partial. Inconsistent. |
| **`packages/shared/`** | 3 import sites (all in `admin/src/`). Earning its keep — `API_ENDPOINTS` + `buildAnalyticsParams` + `createHttpClient` — but underused for a separate package. Worth keeping; will pay back when TS lands and the worker imports types from it too. |

### What's painful — should change

| Area | Why it hurts |
|---|---|
| **`@cloudflare/vitest-pool-workers@0.12.21` pin** | Documented in `SECURITY.md` as the source of 5 dev-only npm-audit advisories. Newer versions removed `defineWorkersProject`. **Cloudflare ships an automated codemod for the v3→v4 migration** (`npx jscodeshift -t https://unpkg.com/@cloudflare/vitest-pool-workers/dist/codemods/vitest-v3-to-v4.mjs --parser=ts vitest.config.js`). This is a 1-day fix that closes a documented advisory. |
| **Single shared staging slot for PR previews** | Two open PRs = the later one stomps the earlier. Reviewers can't trust the URL. `worker-staging.{subdomain}.workers.dev` is fine as a per-branch URL — change to `worker-pr-{N}` and isolation is automatic. |
| **No PR preview cleanup** | Staging slot stays live forever (currently fine because it's one slot). Once previews are per-PR, you need a `pull_request.closed` cleanup or the account fills with orphaned workers. |
| **Plain JavaScript everywhere except `packages/shared/`** | 21 worker files + 32 admin files (`.js` / `.jsx`), no `tsconfig.json` at the workspace root. The `users` / `links` / `analytics-context` object shapes are duplicated across worker + admin in implicit form. Every bug in this codebase that I can identify from the PR history (`mack.haymond` vs `mackhaymond`, the `gh:*` owner_id rename, the JSON parse / validation 400s, the H12 prefetch detection edge cases) would have been caught by a type checker. |
| **No error reporting** | `console.log` everywhere; Workers Observability captures it at 10% sampling. When a prod 500 hits, you find out when it bites you, not when it happens. Sentry Developer tier ($0, 5K errors/mo) closes this. |
| **`admin/src/index.css` has 250+ LOC of `.react-datepicker*` theming** | No actual react-datepicker dependency — the admin uses native `<input type="datetime-local">`. The CSS is dead. (Verified: zero `react-datepicker` references in `admin/src/`.) |
| **`admin/src/App.css` (42 LOC) is unused** | Legacy Vite template — `App.jsx` doesn't import it. Trivial delete. |
| **`docs/API.md` still references "GitHub OAuth Flow"** | Sprint 2b prompt called this out as `B4d`; the rename to "Cloudflare Access" wasn't done. (Verified the prompt's B4d wording; not in the merged PR #40 description either, so likely missed.) |
| **README.md still says "GitHub OAuth authentication" + "JWT with HttpOnly cookies"** | None of that is true post-Sprint 2a. Tech-stack section in README still lists "Authentication: GitHub OAuth API" and "Sessions: JWT with HttpOnly cookies." |
| **README CLI section says `npm run validate:local` runs 15 tests** | Actually 19 tests per the PR #37 description's gate (`19/19`). Off by 4. Minor, but symptomatic. |

---

## 3. Ranked recommendations

Sorted by expected value (concrete payoff ÷ effort × inverse risk), **not** by
ease. Items rejected and ranked low are at the bottom **with the reason**.

| # | Item | What it changes | Effort | Risk | Cost | Expected payoff |
|---|---|---|---|---|---|---|
| 1 | **Incremental TypeScript** (config + `packages/shared` first, then `worker/src/access.js` + `auth.js` + `db.js`, then leaves) | Adds `tsconfig.json`s with `allowJs: true`; converts `.js`→`.ts` file-by-file behind `// @ts-check` guards; ambient types in `@mack-link/shared` for `User`/`Link`/`AnalyticsContext` | 5-8 days spread over 2-3 weeks | Low (reversible per-file) | $0 | Eliminates the entire class of bugs the project has hit (`mack.haymond` vs `mackhaymond`, missing nullable handling, owner_id shape drift). Permanently codifies the JSDoc that's already there. Unlocks Hono RPC + Drizzle inference downstream. |
| 2 | **Migrate vitest-pool-workers 0.12.21 → 0.16.x** via Cloudflare's codemod | `npx jscodeshift -t .../codemods/vitest-v3-to-v4.mjs` rewrites `defineWorkersProject` → `cloudflareTest()` plugin; lifts Vitest to 4.1+ | 1 day | Low (codemod is official + scripted) | $0 | Closes the 5 dev-only `npm audit` advisories documented in `SECURITY.md`. Unlocks Vitest 4.x features (JSON snapshots, better watch mode). Removes the only PR-flagged "deferred" item from PR #37. |
| 3 | **Hono for the API router** | `worker/src/routes.js` + `routes/routerApi.js` collapse to ~80 LOC; CORS / security-headers / auth become declarative middleware (`app.use(cors())`, `app.use('/api/*', requireAuth)`); routes get typed params + `c.req.valid('json', schema)` validation | 2-3 days | Low-medium (Sprint 2a's `Cf-Access-Jwt-Assertion` handling must port verbatim — there's an existing test fixture so this is verifiable) | $0 (Hono adds ~14 KB gzipped to a ~135 KB Worker = 10% bundle growth, well under the 1 MB cap) | Eliminates ~200 LOC of `withCors()` + try/catch + string dispatch. Sets up Hono RPC client (`hc<typeof app>`) — Sprint 4 candidate. Cited Cloudflare-internal usage; 38.9M weekly npm downloads; official C3 template. |
| 4 | **Per-PR Worker name + cleanup workflow** | CI deploys to `worker-pr-{N}.{subdomain}.workers.dev` instead of the shared `worker-staging`; new `pull_request.closed` workflow runs `wrangler delete --name worker-pr-{N} --force` | 0.5 day | Low | $0 (Workers Free supports unlimited Worker names) | Concurrent PRs stop stomping each other. Stable per-PR URLs reviewers can bookmark. Pattern proven in `MCPJam/inspector` ([workflow](https://github.com/MCPJam/inspector/blob/main/.github/workflows/pr-mcp-preview.yml)). |
| 5 | **Sentry on Workers** via `@sentry/cloudflare` | One `Sentry.withSentry()` wrapper in `worker/src/index.js`; SENTRY_DSN as a secret | 0.5 day | Low | $0 (Developer tier: 5K errors/mo, well above any plausible load for this project) | Actual visibility into prod errors — Workers Observability at 10% sampling routinely misses tail-latency / low-volume issues. Closes the "find out when it bites you" gap. |
| 6 | **Per-workspace strict ESLint config + consolidate to root flat config** | Single `eslint.config.js` at root; per-workspace overrides via flat config's `files:` field; add `eslint-plugin-jsdoc` (enforces JSDoc on exports until TS migration completes) | 1 day | Low | $0 | Stops the worker/admin configs from drifting. Surfaces JSDoc gaps in the file inventory above (`routesLinks.js`, `analytics.js`). |
| 7 | **Drizzle ORM** | TS schema in `worker/src/db/schema.ts`; replace `dbGet`/`dbAll`/`dbRun`/`dbBatch` with Drizzle queries; `drizzle-kit generate` produces SQL; `wrangler d1 migrations apply` (or your existing `migrate.mjs`) applies them | 5-8 days | Medium (D1 has no real transactions — must use `db.batch()`; `drizzle-kit migrate` uses `BEGIN TRANSACTION` which D1 rejects, so apply must go through wrangler) | $0 (7.4 KB gzipped) | Eliminates the column-list-repetition pain in `routesLinks.js`; makes `analytics.js`'s 24-statement matrix readable; type-safe schema evolution. **Real argument:** the next person adding a `links` column won't have to hunt 4 callsites. **Real counter-argument:** ~10 tables is the low end where raw SQL is still defensible. **My take:** do this after TS but before adding meaningful new tables. |
| 8 | **React Hook Form + Zod for `admin/`** | `CreateLinkForm.jsx` + `EditLinkModal.jsx` (945 LOC combined) → ~500 LOC. Validation shifts from imperative `validateField()` to declarative Zod schemas. Schemas also exported from `@mack-link/shared` once TS lands. | 2 days | Low | $0 | Cuts the two largest admin files roughly in half. Shared Zod schemas server-validate the same input the form validates (single source of truth). |
| 9 | **Bundle-size budget on `admin/dist/`** | Re-introduce the check that Sprint 1 deleted, but at the admin level (post-Static-Assets, worker bundle is tiny and not the right target). Enforce per-chunk ≤300 KB, total ≤900 KB | 0.5 day | Low | $0 | Sprint 1 dropped the budget reasonably — the worker check was obsolete — but the admin SPA still ships ~700 KB. The risk is regression by accident (adding a chart library, etc.). |
| 10 | **Radix UI for `Dialog` / `Popover` / `Tabs` only** | Replace `useModalA11y.js` consumers (`CreateLinkForm`, `EditLinkModal`, `ConfirmationModal`, `MobileFiltersSheet`) with `@radix-ui/react-dialog`; mobile kebab menu uses `@radix-ui/react-popover`; tab switching uses `@radix-ui/react-tabs` | 2 days | Low-medium | $0 (~25 KB added, but `useModalA11y` deletes) | Stops re-implementing focus trap / Esc / scroll-lock semantics. Battle-tested a11y. Note: `useModalA11y.js` is actually well-written — this is a maintenance argument, not a correctness one. |
| 11 | **`docs/API.md` + `README.md` post-Access cleanup (Sprint 2b's B4d carry-over)** | Replace "GitHub OAuth Flow" / "JWT with HttpOnly cookies" wording with "Cloudflare Access" + pointer to `SECURITY.md` | 1 hour | Low | $0 | Stops misleading new contributors. |
| 12 | **Delete `admin/src/App.css` (unused) + dead `.react-datepicker*` CSS (~250 LOC) in `index.css`** | grep-verifiable; no react-datepicker dependency | 30 min | Low | $0 | Trivial, but ~290 LOC of dead CSS shouldn't ship in the SPA bundle. |
| 13 | **PR + issue templates in `.github/`** | `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug,feature}.md` | 1 hour | Low | $0 | Cosmetic, but the project ships PRs the size of #37 (65 items) — a template would have surfaced the deferred items earlier. |
| 14 | **Hono RPC client (`hc<typeof app>`) in `admin/`** | Drop hand-maintained `admin/src/services/api.js`; replace with typed RPC client generated from worker route types | 1-2 days | Low (after #1 + #3 land) | $0 | End-to-end type safety; `packages/shared` shrinks to just helpers. |
| 15 | **Workers Tracing destinations (Honeycomb / Baselime free tier)** | Add `observability.traces.destinations` in `wrangler.jsonc` | 1 hour | Low | $0 on Baselime/Axiom/Grafana Cloud free; **paid on Cloudflare side as of 2026-03-01** if you exceed the 10M events/mo Workers Paid included quota (you won't on this project) | Real distributed traces beyond `console.log` — pairs well with #5 (Sentry). |

### Ranked LOW (rejected with reason)

| Item | Why rejected |
|---|---|
| **Replace `worker/scripts/migrate.mjs` with `wrangler d1 migrations`** | The custom runner exists for legitimate reasons: programmatic `PRAGMA table_info()` gating (002, 003, 005), env-var-driven backfills (003), the `006_owner_id_email.sql` rename (entirely JS, no SQL counterpart). Wrangler's builtin can't do any of these. Migrating means writing a "thin wrapper" around wrangler that re-implements the same checks — same complexity, less control, no payoff. **Disagree with prior thread.** |
| **Per-PR D1 databases** | Free plan caps at 10 D1 databases per account. With cleanup-failure orphans this overflows fast. Real cost on Paid is fine, but the project's hard constraint is $0/mo. Shared staging D1 + per-PR Worker name (item #4) is the right balance. Defer until you regularly have 5+ open PRs. |
| **Flag-day TypeScript migration** | Heavy existing JSDoc means incremental is strictly cheaper. No upside to forcing a single big-bang PR. |
| **Prisma on D1** | 216× the Drizzle bundle (~600 KB gzipped Prisma engine vs 7.4 KB Drizzle), 4× slower cold start, D1 adapter still in Preview. Footgun on Workers. |
| **Tailwind v3 → v4 migration** | **Already done.** `admin/package.json` is on `tailwindcss@4.1.12` + `@tailwindcss/vite@4.1.12`. The prior thread's list had this; it's stale. |
| **Move to Bun / pnpm / Turborepo / Nx** | Three-workspace npm config is fine. Bun complicates the wrangler runtime story (Workers run workerd, not Bun). Turborepo / Nx are for 10+ packages, not 3. **Flattening to a single package** is also wrong — the worker/admin split is justified by the deployment model. Keep npm workspaces. |
| **PWA / offline admin SPA** | Admin is auth-gated by Access; offline means a stale token and no useful UI. Not worth the service-worker complexity. |
| **i18n** | One user (the owner). No. |
| **Workers Analytics Engine** | $5/mo Workers Paid. Out of scope per cost constraint. Workers Logs + Sentry covers the actual need. |
| **Component-library extraction (`@mack-link/ui`)** | Premature — there's only one consumer. |
| **Containerised local dev** | `npm run dev:ai` works in 10 seconds. No payoff. |
| **GitHub semver release tags** | URL shortener, one user, no API consumers other than the admin SPA in the same repo. Versioning has no audience. |

---

## 4. Where the prior thread's recommendation holds vs falls short

Prior recommendation: **TS + Hono + Drizzle + `wrangler d1 migrations` +
vitest integration tests + per-PR Worker previews.**

| Item | Verdict | Why |
|---|---|---|
| **TS** | ✅ Hold | Right call. Incremental, not flag-day (the prior thread didn't specify; I do). Sequence: `tsconfig` + `@mack-link/shared` types first; then worker leaves (`access.js`, `auth.js`, `db.js`); then admin services; then components. |
| **Hono** | ✅ Hold | Right call. CF-internal usage + C3 templates + 38.9M weekly downloads. The Sprint 2a Access JWT handling has an existing fixture (`worker/test/_helpers/access-fixture.js`) that survives the port; this is the highest-risk move and that fixture neutralises it. |
| **Drizzle** | ⚠️ Hold-with-caveat | Right call, **but sequence after TS** (the type inference is the whole point) and **don't trust `drizzle-kit migrate`** — D1 rejects its `BEGIN TRANSACTION`. Generate SQL with `drizzle-kit generate`, apply via your existing `migrate.mjs` (or `wrangler d1 migrations apply`). At 10 tables the win is marginal; at 15+ it's real. Schedule it for after #1+#3, before any new analytics table. |
| **`wrangler d1 migrations`** | ❌ **Reject** | **Disagree.** Your custom runner does things wrangler can't (programmatic ALTERs, env-var-driven backfills, the 006 rename). Migrating to wrangler means re-implementing those in a wrapper — same complexity, less control. **Keep `migrate.mjs`.** Optionally rename its tracking table from `migrations` to `d1_migrations` so a future hybrid setup is easier, but that's cosmetic. |
| **vitest integration tests** | ⚠️ Hold-with-caveat | You **already have these** (14 test files including `redirect.test.js`, `links-multitenancy.test.js`, `cron.test.js`, `access.test.js`). The action item is **upgrade `@cloudflare/vitest-pool-workers` to 0.16.x via codemod** (item #2 above), not "add integration tests." |
| **Per-PR Worker previews** | ✅ Hold (current setup is shared staging, not per-PR) | Right call. Move from `--name worker-staging` to `--name worker-pr-{N}`. Keep the shared staging D1 (per-PR D1 hits Free-plan quota of 10 dbs). Add `pull_request.closed` cleanup. Pattern: [MCPJam/inspector workflow](https://github.com/MCPJam/inspector/blob/main/.github/workflows/pr-mcp-preview.yml). |

---

## 5. Things the prior thread didn't think of

In rough priority order.

1. **The `vitest-pool-workers` codemod exists** and is officially shipped by
   Cloudflare ([workers-sdk PR #11632](https://github.com/cloudflare/workers-sdk/pull/11632)):
   ```bash
   npx jscodeshift -t https://unpkg.com/@cloudflare/vitest-pool-workers/dist/codemods/vitest-v3-to-v4.mjs --parser=ts worker/vitest.config.js
   ```
   PR #37 deferred this with the reasoning that "0.13+ removes
   `defineWorkersProject`." That reasoning is correct but obsolete — the
   codemod handles the rewrite. Closing the deferred-advisory item is
   ~1 day, not the weeks the deferral implied.

2. **No error reporting at all.** Sentry's Developer tier (5K errors/mo,
   free indefinitely for personal projects) closes this with one
   `Sentry.withSentry()` wrapper. Workers Observability sampling at 10%
   reliably misses low-volume issues — which is exactly the failure mode
   you want to know about.

3. **The single shared staging slot has been silently degrading the
   review experience.** Two open PRs racing to deploy means one of them
   sees the other's code. The fix is one CI yaml line (`--name
   worker-pr-${{ github.event.pull_request.number }}` instead of the
   implicit `worker-staging`) plus a `pull_request.closed` cleanup job
   — but the issue isn't visible from CI status, only from clicking the
   preview URL after a second PR opens. **The prior thread couldn't
   catch this because they never clicked a preview URL.** (This thread
   is doing exactly that in the bootstrap section below.)

4. **`docs/API.md` and `README.md` still describe pre-Sprint-2a auth.**
   README says "GitHub OAuth authentication" and lists "JWT with HttpOnly
   cookies" in the tech stack. `docs/API.md` references "GitHub OAuth
   Flow." Sprint 2b's B4d called this out for `API.md`; it didn't ship
   (verified: `docs/API.md` still has the OAuth section per the file
   listing). Cosmetic but new-contributor-confusing.

5. **README's `validate:local` count is wrong** (says "15 tests"; PR #38
   landed the count at 19). Symptom of doc drift that suggests a CI step
   that re-generates / validates README numbers would earn its keep.

6. **`admin/src/App.css` is dead** (App.jsx doesn't import it; it's
   leftover from Vite scaffolding). 42 LOC.

7. **`admin/src/index.css` has ~250 LOC of `.react-datepicker*` styling
   for a dependency that isn't used.** Grep `admin/src/` for
   `react-datepicker` returns zero hits — the admin uses native
   `<input type="datetime-local">`. The CSS rules ship to every visitor
   for no reason.

8. **The `users` table is provisioned but never reconciled.** `worker/src/users.js`
   does `INSERT ... ON CONFLICT(id) DO UPDATE` on every authenticated
   request. That's `O(requests-per-user)` D1 writes for what is effectively
   a one-time event. With `~10 link rows in prod` and one user this is
   $0 cost forever — but it's the wrong shape if the project ever opens
   to multiple users. Either cache the "user provisioned" check in KV
   (1 read vs 1 write per request) or move it to first-login only.

9. **Reserved-paths metadata round-trip.** `useReservedPaths()` fetches
   `/api/meta/reserved-paths` on every form open. The list is bounded
   and changes only when `worker/src/reservedPaths.js` changes —
   bundle it into the admin SPA at build time (Vite `define` or an
   imported JSON), or cache at the React Query level with
   `staleTime: Infinity`. Currently it's just network noise.

10. **The Sprint 2a fixture for Access JWT verification** is the most
    valuable test asset in the repo (`worker/test/_helpers/access-fixture.js`
    + 13 tests in `access.test.js`). When you port routing to Hono (item #3),
    keep this fixture verbatim — Hono's middleware will call the same
    `authenticateRequest()` and the JWT tests survive unchanged.

11. **No GitHub PR / issue templates.** PRs the size of #37 (65 items)
    benefit from a structured template that surfaces "deferred items"
    explicitly. Currently you have to read the PR description prose
    to find what was deferred.

12. **No supply-chain hygiene.** `npm audit --production` runs in
    Sprint 1's CI conceptually but the actual workflow doesn't fail
    on dev advisories (documented in `SECURITY.md`). Worth adding
    `--audit-level=high` as a soft gate so new transitive deps don't
    silently bring in known-bad versions. (Stays $0; just a flag flip.)

13. **`packages/shared/` has only 3 import sites and zero worker
    imports.** This is fine today, but the structural reason it exists
    (shared API contracts) is wasted while the worker doesn't import
    from it. Once TS lands, the schema types defined in `shared`
    should be imported by both sides — that's when the package starts
    earning its keep instead of just paying rent.

14. **The admin SPA bundles `chart.js` + `react-chartjs-2`** for one
    component (`Analytics.jsx`). Lazy-loaded today (good), but worth
    revisiting whether a smaller chart library (`recharts` is bigger;
    `uplot` is smaller and faster) would let the analytics view load
    in <100ms. Low priority.

15. **D1 Sessions API bookmark is set on every API response** (`routes.js:107-109`),
    but the admin SPA's React Query client doesn't echo it back on
    subsequent reads — Sprint 2b shipped the worker side but the admin
    side never reads `x-d1-bookmark` from a response and sends it back
    on the next request. So the read-replication win the bookmark
    enables is partly unrealised. Cheap fix (`createHttpClient` already
    has request/response interceptors via the shared package).

16. **The `image.jpg` file at the repo root** (38 KB) appears to be an
    orphan — not referenced from any markdown or HTML. Probably a
    Slack-paste leftover. Either move to `docs/img/` if used, or delete.

---

## 6. Suggested sprint sequencing

Each sprint sized at ~3-7 days. Dependencies called out. Parallelisable
sprints noted.

### Sprint 3 — Type-safety foundation (5-7 days)

Independent. Can land before everything else.

- Add root `tsconfig.json` (composite project)
- `packages/shared/`: lift `User`, `Link`, `LinkInput`, `AnalyticsContext`,
  `AnalyticsBreakdown` types from JSDoc into `src/types.ts`
- Add `worker/tsconfig.json` + `admin/tsconfig.json` with `allowJs: true`,
  `checkJs: false`, `strict: true`
- Convert worker leaves (no internal deps): `worker/src/access.js`,
  `worker/src/auth.js`, `worker/src/db.js`, `worker/src/cors.js`,
  `worker/src/securityHeaders.js`, `worker/src/rateLimit.js`,
  `worker/src/logger.js`, `worker/src/utils.js`
- Convert `worker/src/validation.js` (well-JSDoc'd, no deps)
- All ESLint + tests pass continuously

**Out of scope this sprint**: routes, analytics aggregations, admin SPA.

### Sprint 4 — Test infra + CI ergonomics (3-4 days)

Parallel with Sprint 3.

- Apply Cloudflare codemod for `vitest-pool-workers` 0.12 → 0.16
- Bump Vitest to 4.1
- Per-PR Worker name in CI (`--name worker-pr-${{ pr.number }}`)
- Cleanup workflow on `pull_request.closed`
- Update README's "validate:local 15 tests" → correct count
- README + `docs/API.md` post-Access cleanup (Sprint 2b B4d carry-over)
- Delete `admin/src/App.css`
- Delete dead `.react-datepicker*` CSS in `admin/src/index.css`
- Delete or relocate root `image.jpg`
- Add Sentry on Workers (`@sentry/cloudflare`)

### Sprint 5 — Hono migration (3-5 days)

**Depends on**: Sprint 3 (TS types make Hono's `Bindings` generic worth
its salt).

- Convert remaining worker files to TS (routes + analytics + index)
- Replace `worker/src/routes.js` + `routes/routerApi.js` with Hono
- Port `authenticateRequest` to Hono middleware (same fixture-based
  tests pass)
- CORS, security-headers, rate-limit become declarative middleware
- Keep the routes/* handler files; just rewire dispatch
- Validate all existing tests still pass
- Bundle size: target stays under 200 KB gzipped Worker upload

### Sprint 6 — Drizzle + form refactor (5-8 days, parallelisable into two)

**Depends on**: Sprint 5 (Hono + TS).

**Sprint 6a — Drizzle** (worker side):

- Define `worker/src/db/schema.ts` for all 8 tables
- Replace `dbGet`/`dbAll`/`dbRun`/`dbBatch` callsites with Drizzle queries
- Generate SQL with `drizzle-kit generate`; apply via existing
  `worker/scripts/migrate.mjs` (NOT `drizzle-kit migrate`)
- Refactor `worker/src/analytics.js::buildAnalyticsStatements` —
  this is where Drizzle pays back the most
- `worker/src/routes/routesLinks.js` shrinks materially as column
  lists stop being repeated

**Sprint 6b — React Hook Form + Zod** (admin side, can run in parallel):

- Convert `admin/src/` to TS file-by-file
- `CreateLinkForm.jsx` + `EditLinkModal.jsx` rebuilt on RHF + Zod;
  schemas exported from `@mack-link/shared`
- Reserved-paths metadata bundled at build time (Sprint 7 candidate
  if pulled out)

### Sprint 7 — Hono RPC + final polish (3-5 days)

**Depends on**: Sprint 5 + Sprint 6b.

- Export `AppType` from worker; consume in `admin/src/services/api.ts`
  via `hc<AppType>('/')`
- Drop the hand-maintained `admin/src/services/api.js` (renamed `.ts`)
- D1 Sessions API bookmark round-trip in admin (`http.ts` interceptors)
- Bundle-size budget on `admin/dist/`
- Radix UI Dialog / Popover / Tabs for the four modal consumers
  (replaces `useModalA11y.js`)
- PR + issue templates
- Workers Tracing destination wired to Baselime free tier

### Parallelism summary

```
S3 (TS foundation)  ────────┬─→ S5 (Hono)  ──→ S6a (Drizzle) ──┐
                            │                                    ├─→ S7 (RPC + polish)
S4 (test infra + cleanup) ──┘                                    │
                                            S6b (RHF+Zod) ──────┘
```

S3 + S4 are independent and can run truly parallel. S5 needs S3. S6a/S6b
need S5. S7 needs both S6 branches.

Total: 5 sprints, **22-32 days** of focused engineering, all stays $0/mo,
all reversible per-sprint.

---

## 7. The "if you only do one thing" answer

**Incremental TypeScript** (Sprint 3 above).

Defence:

- **Catches the entire class of bugs the project has actually hit.** The
  `mack.haymond` vs `mackhaymond` identity mismatch (post-PR #39),
  the `gh:*` owner_id rename (Sprint 2b B4b), the validation 400-vs-500
  shape issues from PR #37's H20, the empty-string vs `NULL` TTL handling
  in Sprint 1's S2 — every one is a type error that would not have shipped
  with `strict: true` enforced. **Every other recommendation on this
  list either depends on TS or is a smaller win than TS provides.**
- **It's reversible.** Per-file conversion behind `allowJs: true` means
  any single file can be rolled back without cascading damage.
- **The codebase is already 70% of the way there.** Substantial JSDoc on
  `db.js`, `auth.js`, `access.js`, `validation.js`, `password.js`,
  `logger.js`, `rateLimit.js`, `utils.js`, `cors.js` already provides
  shadow types. TS formalises what's there; it doesn't invent new
  semantics the code doesn't already have.
- **It unlocks #3 (Hono RPC) and #7 (Drizzle inference) — the two
  biggest downstream wins.** Without TS, Hono is just a routing library
  and Drizzle is just a query builder; with TS, both deliver type-safe
  schema evolution and end-to-end API contracts.
- **Cost is bounded and small.** Heavy JSDoc + small file count means
  5-8 engineer-days realistic. No deployment risk (TS compiles to JS;
  Workers don't care). No bundle-size impact (types are erased).

The runner-up — "migrate vitest-pool-workers" — is faster and closes a
documented advisory, so do it in parallel. But if forced to pick *one*,
it's TS.

---

## 8. Open questions for the user

Each materially changes the recommendations.

1. **Will this ever be multi-user?**
   - If yes: items #8 (RHF + Zod with shared schemas) and #7 (Drizzle)
     move up; user provisioning gets re-shaped (item #8 in §5); a
     proper user-management page becomes Sprint 8.
   - If no (current state): the multi-tenancy code in `worker/src/users.js`
     and `links.owner_id` filtering is over-engineered for an audience
     of one. The infrastructure is fine; just don't add more.

2. **Do you ever want to publish the API for external consumers?**
   - If yes: adopt `chanfana` or `@hono/zod-openapi` in Sprint 5 to
     auto-generate an OpenAPI spec; documentation cost flips from
     "manual `docs/API.md` upkeep" to "tested + always-correct".
   - If no: skip OpenAPI; the only consumer is the admin SPA in this
     repo, which gets typed via Hono RPC.

3. **Is the per-PR-isolation pain real, or are you usually working with
   one branch at a time?**
   - If you have ≥2 PRs open concurrently more than monthly: item #4
     (per-PR Worker name + cleanup) becomes urgent — schedule in
     Sprint 4.
   - If you typically have ≤1 PR open at a time: the shared staging
     slot is fine; spend that 0.5 day on Sentry instead (item #5).

4. **Are you OK with a non-zero monthly cost for observability if the
   free tiers prove insufficient?**
   - If yes: keep open the option to upgrade Workers Tracing destinations
     (Honeycomb / Grafana Cloud paid) and Sentry beyond free tier.
   - If no: cap at Sentry Developer + Workers Logs + Baselime free
     forever; revisit only if a real user complaint surfaces something
     the free tiers can't diagnose.

5. **Are the four open `feat-*` local branches still alive, or are they
   dead?** `git branch -a` shows `feat-redesign-ui-AJmdC`,
   `feat-redesign-ui-v3azL`, `feat-visual-redesign-Oo3oO`,
   `feat/admin-mobile-ui`. Nothing on `origin` for the first three;
   pruning would tidy the local repo. Cosmetic but the kind of clutter
   that compounds.

6. **Is the URL shortener ever going to absorb other personal-tool
   responsibilities** (analytics dashboard for other projects,
   feature-flag service, …)? If yes, the monorepo justifies itself
   harder, `packages/shared/` gets fuller, and Sprint 7's Hono RPC
   pattern becomes the template for cross-app contracts. If no, the
   current size is the asymptote.

7. **Is there appetite for moving any read paths to KV** (Workers Logs
   shows the redirect handler is the hot path — D1 read latency
   variance vs KV's globally-replicated reads is a meaningful win at
   any scale)? Sprint 2b's D1 Sessions API helps, but KV-fronted
   redirect would be the asymptotic answer. Not on the recommendation
   list because it's an architectural shift the brief didn't ask for.

---

## Appendix: methodology

This document was produced by:

1. Reading PR descriptions for #37 (audit remediation, 65 items),
   #38 (Sprint 1: Static Assets + cron + previews),
   #39 (Sprint 2a: Cloudflare Access), and verifying #40 (Sprint 2b)
   was actually merged (it was: commit `21f94c5` on `main`).
2. Reading the un-executed `Sprint 2b prompt` for context only — its
   contents are now reflected in the codebase.
3. Firing **9 parallel subagents** (3 explore over codebase / admin /
   CI, 5 librarian over Hono / Drizzle / per-PR previews /
   wrangler-migrations / vitest+observability, 1 librarian on TS
   migration cancelled after 22 minutes when other agents had
   already covered the same ground). All agents cited sources;
   citations are preserved inline above where they support a claim.
4. Direct reads of `worker/src/`, `admin/src/`, `worker/wrangler.jsonc`,
   `.github/workflows/ci.yml`, and the current git state.
5. No Oracle consultation — the parallel agents already pressure-tested
   the prior thread's recommendation in their individual reports; their
   conclusions were consistent enough that an Oracle pass would have
   been redundant.

Total elapsed: ~6 minutes of parallel agent execution + write-up.

---

*End of analysis.*
