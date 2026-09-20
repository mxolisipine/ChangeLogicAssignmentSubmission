# AGENTS.md — AI Agent Instructions for Multi-Tenant Pulse Surveys

## 1. Assignment Goal

Build a minimal, production-quality slice of a multi-tenant SaaS pulse survey platform. The system allows organizations to run lightweight weekly surveys, lets Members submit one response per week, and lets Managers view aggregated summaries. The goal is a clean, coherent vertical slice that demonstrates senior-level judgment across backend data modelling, authorization, and a small React UI — not a feature-complete product.

---

## 2. Technology Constraints

- **Language:** TypeScript throughout — backend and frontend.
- **Backend framework:** NestJS.
- **Database:** PostgreSQL. Use TypeORM for schema definition and queries.
- **Frontend framework:** React. Use Vite as the build tool.
- **Authentication:** Local only. Issue a stateless JWT from a seeded-user login endpoint. No external identity providers (no Auth0, Cognito, Firebase Auth, or similar).
- **Infrastructure:** Runs entirely on localhost. No paid cloud services, no Docker requirement (though a docker-compose for Postgres is acceptable).
- **No additional frameworks or libraries** should be introduced unless they are standard companions to the above (e.g. `@nestjs/jwt`, `pg`, `react-router-dom`).

---

## 3. Tenancy Rules

- Every user record in the database has an `organizationId` column.
- On every authenticated request, the server resolves the calling user from the JWT, then reads `organizationId` from that user record.
- **The client never supplies an `organizationId` that is trusted.** Any `organizationId` present in a request body or query string is ignored; the server always uses the value from the database user record.
- Every database query that touches surveys, responses, answers, or member counts must include a `WHERE organization_id = :orgId` clause (or TypeORM equivalent) using the server-resolved value.
- A user from organization A must never be able to read or write data belonging to organization B, even if they supply a valid survey or response ID belonging to B.

---

## 4. Roles

There are exactly two roles: `MANAGER` and `MEMBER`.

### MANAGER can:
- Create a survey (with up to 3 questions) for their own organization.
- View any survey belonging to their organization.
- View the weekly summary for any survey in their organization (completion count, completion rate, per-question rollups).

### MANAGER cannot:
- Submit a response to a survey.
- Access surveys, responses, or summaries belonging to another organization.
- Elevate their own role or manage users.

### MEMBER can:
- View the active survey for their organization.
- Submit one response per active week per survey.

### MEMBER cannot:
- View the weekly summary for any survey.
- Create or modify surveys.
- Submit more than one response per survey per week.
- Access any data belonging to another organization.

---

## 5. Response Rules

- A Member may submit **exactly one response** per survey per active week.
- "Active week" uses ISO week format: `YYYY-Www` (e.g. `2026-W38`). A rolling 7-day window is also acceptable; state the choice in SOLUTION.md.
- The uniqueness of a submission is enforced at the **database level** by a `UNIQUE(user_id, survey_id, week_key)` constraint on the `responses` table. This is the primary enforcement mechanism.
- The service layer must also check for an existing response before inserting and return HTTP `409 Conflict` with a descriptive message if one is found. This gives the client a clean error before hitting the DB constraint.
- `week_key` is a computed, server-side value derived from the current date at submission time. The client does not supply it.
- A second submission attempt must be **rejected**, not silently overwritten or merged.

---

## 6. API Rules

| # | Method | Path | Callable by | Key authorization check |
|---|---|---|---|---|
| 1 | `POST` | `/auth/login` | Anyone (unauthenticated) | Looks up user by username in seed data; returns signed JWT containing `userId`. No password required locally. |
| 2 | `POST` | `/surveys` | MANAGER only | JWT must resolve to a user with role `MANAGER`. Survey is created with `organizationId` taken from the server-side user record, never from the request body. |
| 3 | `GET` | `/surveys/active` | MANAGER or MEMBER | JWT required. Returns only surveys where `organization_id` matches the calling user's org. |
| 4 | `POST` | `/surveys/:id/responses` | MEMBER only | JWT must resolve to a user with role `MEMBER`. Server verifies the survey's `organization_id` matches the caller's org. Server enforces the one-per-week rule via `UNIQUE(user_id, survey_id, week_key)`. |
| 5 | `GET` | `/surveys/:id/summary` | MANAGER only | JWT must resolve to a user with role `MANAGER`. Server verifies the survey's `organization_id` matches the caller's org before returning aggregated data. |
| 6 | `GET` | `/auth/me` | Any authenticated user | Returns the calling user's `id`, `name`, `role`, and `organizationId`. Used by the frontend to determine which screen to render after login. |

---

## 7. Testing Expectations

Tests must exist for the following categories. Do not skip any category.

### Tenant Isolation (security regression tests — all four must exist)

1. **Cross-org survey access:** A MANAGER from Org A calls `GET /surveys/:id/summary` using a survey ID that belongs to Org B. The server must return `403 Forbidden` or `404 Not Found`. A `200` response here is a data breach.
2. **Cross-org response submission:** A MEMBER from Org A calls `POST /surveys/:id/responses` using a survey ID that belongs to Org B. The server must return `403` or `404`.
3. **Cross-org active survey listing:** A MEMBER from Org A calls `GET /surveys/active`. The response must contain only surveys belonging to Org A — no Org B surveys may appear.
4. **Summary denominator isolation:** The completion rate returned by `GET /surveys/:id/summary` must use only the member count of the survey's own organization as the denominator — not the total user count across all organizations.

### Authorization Tests

- A MEMBER calling `GET /surveys/:id/summary` must receive `403 Forbidden`.
- A MANAGER calling `POST /surveys/:id/responses` must receive `403 Forbidden`.
- An unauthenticated request to any protected endpoint must receive `401 Unauthorized`.

### Response Rule Tests

- A MEMBER submitting a response for the first time in a week must receive `201 Created`.
- The same MEMBER submitting a second response to the same survey in the same week must receive `409 Conflict`.
- The `UNIQUE(user_id, survey_id, week_key)` constraint must be verified to exist in the database schema.

### Summary Correctness Tests

- A survey with two rating responses (`3` and `5`) must return an average of `4.0` and a count of `2`.
- A survey with three yes/no responses (`yes`, `yes`, `no`) must return `yes: 2`, `no: 1`.
- A survey with zero responses must return `completionCount: 0` and `completionRate: 0`.
- An organization with zero members must not produce a divide-by-zero error; return `completionRate: 0` or `null`.

---

## 8. Simplicity Guidance

Do **not** build any of the following. They are out of scope and will waste time:

- OAuth, OpenID Connect, SSO, or any external authentication provider.
- Email sending, password reset flows, or email verification.
- Microservices, message queues, or event buses.
- A design system, component library (Material UI, Chakra, Ant Design, etc.), or CSS framework beyond minimal utility classes.
- An admin panel or user management UI.
- Pagination, filtering, or sorting on any endpoint.
- Survey versioning, survey editing after creation, or soft deletes.
- File uploads or image handling (that is Task 3, design-only).
- Real-time features (WebSockets, SSE, polling).
- Rate limiting, audit logging, or observability tooling.
- Docker multi-stage builds or Kubernetes configuration.
- End-to-end browser tests (Playwright, Cypress). Unit and integration tests are sufficient.
- More than three React screens (login, member submit, manager summary).
