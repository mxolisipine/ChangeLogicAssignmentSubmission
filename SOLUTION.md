# SOLUTION.md — Design Notes, Trade-offs, and AI Workflow

---

## 1. Authentication: X-User-Id Header vs JWT (AGENTS.md Divergence)

**What AGENTS.md says:** §2 specifies *"Issue a stateless JWT from a seeded-user login endpoint."*

**What was implemented:** An `X-User-Id` request header. The frontend sends the selected user's UUID; the NestJS `AuthGuard` reads it, queries the database for the matching user record, and attaches `CurrentUser { id, organizationId, role, name }` to the request. No JWT is issued or validated.

**Why the divergence was made:**

JWTs require a secret, a signing step, expiry handling, and a token-exchange endpoint. For a local demo where "authentication" is literally picking a user from a dropdown, that is all friction with zero security benefit. The `X-User-Id` header gives the same observable behaviour from the frontend's perspective — send an identity claim, get a scoped response back — with far less infrastructure.

**What is preserved regardless of mechanism:**

The critical invariant from AGENTS.md §3 is fully upheld: *the client never supplies an `organizationId` that is trusted.* Whether the incoming identity claim is a UUID header or a JWT, the guard always discards it after looking up the user in the database, and `organizationId` is read exclusively from the DB row. The tenancy boundary is enforced at the service layer, not at the token layer.

**Migration path to JWT (one file change):**

Replacing the header with a real JWT requires only rewriting `AuthGuard.canActivate()` to verify and decode a `Bearer` token instead of reading the `X-User-Id` header. No service, entity, DTO, or controller code changes. The `CurrentUser` interface and the entire authorization/tenancy logic remain unchanged.

---

## 2. Weekly Window: ISO Weeks

**Choice made:** ISO 8601 calendar weeks (`YYYY-Www`, e.g. `2026-W38`).

**Why not rolling 7-day windows:** ISO weeks are deterministic across all members of an organization — everyone's "week" starts on Monday and ends on Sunday, regardless of when they individually last submitted. A rolling window would mean two members have different personal submission windows, which complicates the completion-rate denominator and makes the summary confusing to managers. Full rationale is in SPEC.md §3.

---

## 3. Tenancy Strategy: Application-Layer Scoping

**Choice made:** Application-layer `WHERE organization_id = :orgId` clauses on every query that touches org-owned data. Row-Level Security (RLS) was considered and rejected.

**Why not RLS:** RLS requires either multiple DB roles (one per org) or session-variable injection per request, both of which add connection-pool complexity that is disproportionate for this slice. Application-layer scoping is easier to audit (the scope is visible in the TypeScript code), easier to test (mock the repo), and straightforward to verify.

**How cross-org access is blocked:** The `organizationId` on every service method comes from `currentUser.organizationId`, which is resolved by the guard from the DB. A survey looked up with `WHERE id = :id AND organization_id = :orgId` returns `null` for a cross-org request, and the service throws `404` — not `403` — to avoid leaking that the resource exists. This satisfies the AGENTS.md §3 requirement that *"a user from organization A must never be able to read or write data belonging to organization B."*

---

## 4. Known Gaps and Intentional Exclusions

| Item | Status | Reason |
|---|---|---|
| JWT authentication | Replaced with X-User-Id header | See §1 above |
| Summary endpoint (`GET /surveys/:id/summary`) | Implemented — SQL aggregation via `DataSource.query` | Completion count, rate, rating average, yes/no counts all computed in PostgreSQL |
| React frontend | Implemented — user selector, member survey form, manager summary screen | Three screens, conditional rendering, no routing library |
| End-to-end tests | Implemented — `surveys.e2e.spec.ts` covers the full happy-path cycle and cross-tenant negative cases | 16 integration + e2e tests passing |
| Survey activation/deactivation | Not implemented | "Most recent survey" is the active one — sufficient for the demo |
| Migrations in production | `synchronize: false` with explicit migration file | Dev uses the migration runner; prod would use the same |
| Rate limiting, audit logging | Not implemented | Out of scope per AGENTS.md §8 |
| Pagination | Not implemented | Out of scope per AGENTS.md §8 |

---

## 5. AWS Production Design (Task 3 — Design Only)

### Deployment architecture

- **App tier:** ECS Fargate (containerised NestJS). Stateless — scales horizontally. ALB in front with HTTPS termination.
- **Database:** Amazon RDS for PostgreSQL (Multi-AZ for HA). The same TypeORM migrations run against RDS on deploy via a one-off ECS task.
- **Frontend:** S3 + CloudFront. Vite produces a static bundle; CloudFront serves it globally with cache headers. No backend involvement in serving HTML/JS/CSS.
- **Secrets:** AWS Secrets Manager for DB credentials. If the `X-User-Id` header is replaced with JWT authentication in production (see §1), the signing secret would also be stored here. ECS task role reads secrets at startup — no secrets in environment variables or Docker images.

### Organization logo storage (cost and security)

- Logos are stored in a private S3 bucket. Objects are never publicly accessible.
- The backend issues short-lived (15 min) **S3 pre-signed URLs** when the frontend needs to display a logo. The pre-signed URL is scoped to the exact object key (`logos/{orgId}/logo.{ext}`), so one org cannot guess or use another org's URL.
- CloudFront with an Origin Access Control (OAC) policy sits in front of the S3 bucket. This means bandwidth costs stay at CloudFront's egress rate (cheaper than S3 direct) and the backend never proxies the binary data — it just generates and returns the pre-signed URL.
- Upload path: the frontend calls a backend endpoint that returns a pre-signed **PUT** URL. The browser uploads directly to S3, bypassing the backend entirely for the binary transfer.

### Tenancy, security, and scaling priorities (first three)

1. **Row-level isolation** — move from application-layer scoping to PostgreSQL RLS policies backed by a `current_setting('app.organization_id')` session variable set per connection. This removes the risk of a missing `WHERE` clause silently leaking data.
2. **JWT with short expiry + refresh tokens** — replace the `X-User-Id` header with signed JWTs (15 min access token, 7 day refresh token stored in an httpOnly cookie). Eliminates the trivial impersonation risk of the current header.
3. **Connection pooling** — PgBouncer or RDS Proxy between ECS and RDS. Each Fargate task currently holds its own connection pool; at scale this exhausts RDS's `max_connections`. A pooler makes the connection count independent of replica count.

---

## 6. AI Workflow (Task 4)

### Tools used

Two AI tools were used in combination:

- **Codex** — used to decompose the assignment brief into a structured prompt playbook. The assignment tasks were analysed and fleshed out into discrete, commit-sized prompts with explicit instructions, constraints, and acceptance criteria. The output was committed as `PLAYBOOK.md`, which defines the full sequence of 11 prompts (Stage 1 through Commit 11) and the order in which they should be executed.

- **Kiro** (VS Code extension, powered by Claude) — used to execute every prompt from `PLAYBOOK.md` in sequence. Kiro generated code, ran commands, fixed compilation errors, and committed each stage. All application code, tests, configuration, and documentation in this repository was produced through Kiro.

### How tasks were broken down

The `PLAYBOOK.md` prompt playbook defines the full execution order. Work was decomposed into discrete commit-sized stages:

1. Analysis (no code) — read the assignment and identify requirements, invariants, authorization rules, and test strategy.
2. `AGENTS.md` — machine-readable instructions constraining Kiro's behaviour throughout the project.
3. Repository scaffold — `package.json`, `tsconfig.json`, `docker-compose.yml`, stub entry points.
4. `SPEC.md` — authoritative design document committed before any application code.
5. Database layer — TypeORM entities, migration, seed script with hardcoded UUIDs.
6. Identity resolution — `AuthGuard`, `RolesGuard`, `X-User-Id` header pattern.
7. Survey CRUD — `POST /surveys`, `GET /surveys/active`, `GET /surveys/:id`.
8. Response submission — `POST /surveys/:id/responses` with ISO week key and DB transaction.
9. Summary endpoint — `GET /surveys/:id/summary` with raw SQL aggregation.
10. Integration tests — isolation, authorization, response rules, summary correctness.
11. React frontend — user selector, member survey form, manager summary screen.
12. E2E test — full happy-path cycle plus cross-tenant negatives.

### What was delegated to Kiro vs retained by the developer

**Delegated to Kiro:** file generation, NestJS boilerplate, SQL query construction, test scaffolding, TypeScript interface definitions, dependency version lookup, git commands, compilation verification.

**Retained by the developer:** architectural decisions (X-User-Id vs JWT, application-layer vs RLS, ISO weeks vs rolling window), the `SPEC.md` content as the authoritative contract, prompt authoring and sequencing in `PLAYBOOK.md`, review of every generated file before committing, validation against the running database.

### How AI output was reviewed and validated

Every generated file was read before committing. Tests were run before any commit that touched application logic. When tests failed, the failure message was used to diagnose the root cause before attempting a fix — incremental patching without diagnosis was explicitly avoided. The integration test suite (`npm run test:integration`) was run against the live Postgres instance to confirm correctness at the HTTP layer before marking any backend stage complete.

### What was corrected or rejected

- **TypeORM 1.x `select` and `relations` syntax**: Kiro generated array syntax (`['field']`, `['relation']`) which TypeORM 1.0 rejects. Fixed to object syntax (`{ field: true }`) after the first test run surfaced the type errors.
- **`@JoinColumn` names using camelCase**: Kiro used camelCase property names (e.g. `organizationId`) in `@JoinColumn({ name: ... })` instead of the DB column names (`organization_id`). This caused TypeORM to generate invalid SQL at runtime. Fixed by adding explicit `name: 'snake_case'` to every `@Column`, `@CreateDateColumn`, and `@JoinColumn` decorator across all six entities.
- **`APP_GUARD` dependency injection**: Kiro registered `AuthGuard` with `useClass` at the `APP_GUARD` token, which created a second instance without `UserRepository` resolved. Fixed to `useExisting`, which reuses the instance already constructed by `AuthModule`.
- **`@IsUUID()` on `questionId`**: The seed IDs (e.g. `dddddddd-0000-0000-0000-000000000001`) are not UUID v4 format — the version nibble is `0`, not `4`. The `@IsUUID()` decorator rejected them silently, causing integration tests to fail with 400 instead of the expected 422 or 201. Fixed to `@IsString()` + `@IsNotEmpty()`.
- **ISO week boundary test**: A test asserted that 2026-09-14 (a Monday — the opening day of W38) was in W37. The test was wrong; the `currentISOWeek()` function was correct. Fixed the test assertion after the failure identified the date had been misidentified as a Sunday.
- **`select: { id: true }` partial select causing undefined fields**: TypeORM 1.x returned `undefined` for fields omitted from a partial `select` in some query paths. Removed the partial select — full row load is simpler and correct.
- **`start:dev` script calling `ts-node` as a global**: `node` was not on the system PATH when npm spawned child processes, causing `'node' is not recognized` errors. Fixed all npm scripts to call `node node_modules/ts-node/dist/bin.js` using the full local path.
- **`passport`, `passport-jwt`, `@nestjs/passport`, `@nestjs/jwt` in `package.json`**: These were scaffolded from the initial template and were never imported anywhere in the source. Removed in a dedicated refactor commit after a review flagged them as misleading dead dependencies that inflated the audit surface.
- **`questionRepository` injected but unused**: Kiro injected `@InjectRepository(Question)` into `SurveysService` even though no method used it — question persistence is handled by TypeORM's cascade on `Survey.questions`. Removed in the same refactor commit.

### What would be done differently next time

- Pin TypeORM 1.x API idioms (object `select`, object `relations`, snake_case `@JoinColumn`) in `AGENTS.md` from the start, so Kiro generates them correctly on the first attempt rather than requiring a post-test correction pass.
- Add explicit column name mapping conventions to `AGENTS.md` so the entity/DB mismatch is caught at generation time rather than at integration test runtime.
- Run `tsc --noEmit` after each file generation step, not only before committing.
- Include a `PLAYBOOK.md`-style prompt structure from the outset — decomposing the work into explicit, ordered, commit-sized prompts before writing any code proved to be the highest-leverage preparation step in this workflow.

### Session transcripts

The full conversation between the developer and Kiro is saved in `ai-logs/` in the repository. Each exchange is logged as it was conducted, with no post-hoc editing.
