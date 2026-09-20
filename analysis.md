# Assignment Analysis

## 1. Business Requirements

- Organizations run weekly pulse surveys with up to 3 questions each.
- Questions are one of two types: rating (1–5) or yes/no.
- Managers can create and manage surveys scoped to their own organization.
- Members can submit exactly one response per active week per survey.
- The system must produce a 7-day (or calendar-week) summary per survey, including:
  - Total completion count and completion rate (completions ÷ member count in that org).
  - Per-question rollups: average + count for ratings; yes-count and no-count for yes/no.
- Seed data must cover at least two organizations with at least one Manager and one Member each, to demonstrate isolation.

---

## 2. Invariants

- **One response per member per survey per active week.** A second submission attempt must be rejected, not silently overwritten.
- **Surveys belong to exactly one organization** and may not be moved between orgs.
- **Users belong to exactly one organization.** Cross-org membership is not permitted.
- **A survey has at most 3 questions.**
- **Question type is immutable after creation** (implied: rollup logic depends on it).
- **Rating values must be in the range 1–5.**
- **Yes/no answers must be strictly boolean/binary.**
- **The summary denominator is the number of members in the organization at query time** (not at survey creation time — the assignment does not distinguish, so simplest is current count).

---

## 3. Authorization Rules

| Action | Manager | Member |
|---|---|---|
| Create a survey | ✅ (own org only) | ❌ |
| View a survey | ✅ (own org) | ✅ (own org) |
| Submit a response | ❌ (implicit — not mentioned) | ✅ (own org, once per week) |
| View the weekly summary | ✅ (own org) | ❌ |
| Access another org's data | ❌ | ❌ |

Every request must be scoped by the authenticated user's `organizationId`. A Manager in Acme cannot see Globex surveys even if they know the survey ID.

---

## 4. Tenancy Boundaries

- Every entity that belongs to an organization (surveys, responses, users) carries an `organizationId` foreign key.
- All queries must filter by the calling user's `organizationId` — application-layer scoping is acceptable per the assignment.
- No shared state (e.g., a "global surveys" table without org scoping) is permitted.
- The auth mechanism (even a simple header or seeded token) must resolve `organizationId` before any data access; it must not be caller-supplied as a raw query parameter without server-side validation.
- Completion rate denominator must count only members of the same organization.

---

## 5. Database Constraints

- `organizations`: primary key `id`.
- `users`: primary key `id`; foreign key `organization_id → organizations.id`; `role` constrained to `('manager', 'member')`.
- `surveys`: primary key `id`; foreign key `organization_id → organizations.id`.
- `questions`: primary key `id`; foreign key `survey_id → surveys.id`; `type` constrained to `('rating', 'yes_no')`; a check or application-layer guard limiting count ≤ 3 per survey.
- `responses`: primary key `id`; foreign keys `survey_id → surveys.id`, `user_id → users.id`; **unique constraint on `(user_id, survey_id, week_identifier)`** — this is the single most important constraint, as it enforces the one-submission-per-week invariant at the database level.
- `answers`: primary key `id`; foreign keys `response_id → responses.id`, `question_id → questions.id`; `rating_value` check `1–5` or null; `yes_no_value` boolean or null; unique on `(response_id, question_id)`.

---

## 6. Minimum API Surface

Six endpoints cover the full assignment:

1. `POST /auth/login` — accepts a user identifier (e.g. seeded username), returns a token or sets a session. Keeps local auth simple.
2. `POST /surveys` — Manager creates a survey with questions. Scoped to their org.
3. `GET /surveys/active` — Member (or Manager) retrieves the current active survey for their org.
4. `POST /surveys/:id/responses` — Member submits a response. Enforces the one-per-week invariant.
5. `GET /surveys/:id/summary` — Manager retrieves the 7-day rollup (completion rate + per-question aggregates).
6. *(Optional, can be seed-only)* Survey creation can be entirely seed-driven; if so, endpoint 2 can be omitted for the demo.

---

## 7. Minimum UI

Three screens cover both required flows:

1. **Login screen** — a dropdown or list of seeded users (name + org shown). Selecting one "logs in." No password needed locally.
2. **Member survey screen** — shows the active survey's questions with input controls (1–5 star/slider for rating, Yes/No toggle for boolean). A Submit button posts the response. Shows a confirmation or "already submitted this week" message on repeat visit.
3. **Manager summary screen** — shows the survey name, completion count and rate, and a per-question breakdown (average + count for ratings; yes/no counts for boolean). Read-only.

Navigation between 2 and 3 can be role-gated: after login, redirect to the appropriate screen.

---

## 8. Testing Strategy

The invariants that need explicit tests, and why:

- **One response per member per survey per week** — this is the core business rule and the most likely failure mode. Test both the happy path (first submission succeeds) and the rejection path (second attempt in the same week returns an error). A unit test on the service layer plus a DB-level uniqueness test (attempting to insert a duplicate directly) covers both the application guard and the constraint.
- **Cross-org data isolation** — test that a user from Org A cannot retrieve surveys, responses, or summaries belonging to Org B, even with a valid token. This is a security invariant; silent failure here is a data breach.
- **Completion rate calculation** — test that the denominator is the member count of the org, not total users, and that a 0-member org does not produce a divide-by-zero.
- **Rating range validation (1–5)** — test that a value of 0 or 6 is rejected.
- **3-question limit** — test that adding a 4th question to a survey is rejected.
- **Manager/Member role enforcement** — test that a Member cannot hit the summary endpoint and a Manager cannot submit a response (if that restriction is enforced).

These are worth testing explicitly because each one maps directly to a named invariant; a regression in any of them is a correctness failure, not just a UX issue.

---

## Proposed Implementation

The smallest coherent implementation is a single NestJS monorepo with three modules — `auth`, `surveys`, and `organizations` — backed by a single PostgreSQL database using TypeORM with application-layer org scoping (no row-level security, stated and justified in SOLUTION.md). Auth is a stateless JWT issued against seeded users with no external IdP. The React frontend is a Vite app with three screens (login, member submit, manager summary) using plain fetch calls and React state — no Redux, no router beyond two conditional renders. Seed data covers Acme (1 manager, 2 members, 1 survey) and Globex (1 manager, 1 member, 1 survey), making isolation demonstrable without any UI configuration. The `(user_id, survey_id, week_identifier)` unique constraint lives in the database and is mirrored by a service-layer check that returns a clean 409. Summary aggregation runs as a single SQL query with conditional aggregation rather than in-memory loops. This stack satisfies every requirement, every invariant, and both UI flows with no extraneous moving parts.
