# SPEC.md — Pulse Surveys Implementation Specification

> This document precedes all application implementation commits.
> It is the authoritative reference for data model, API contracts, and test requirements.

---

## 1. Architecture Overview

```
Browser (React + Vite :5173)
        │
        │  HTTP/JSON  (X-User-Id header on every request)
        ▼
NestJS API (:3000)
  ├── AuthGuard          resolves X-User-Id → CurrentUser { id, organizationId, role }
  ├── RolesGuard         enforces MANAGER / MEMBER restrictions per endpoint
  ├── SurveysModule      survey CRUD, response submission, summary aggregation
  └── TypeORM            parameterised queries, every write scoped to organizationId
        │
        │  TCP :5432
        ▼
PostgreSQL (Docker)
  └── single "pulse" database
```

**Tenant isolation is enforced at the service layer**, not at the database (no row-level security policies). Every repository method that reads or writes organization-owned data accepts `organizationId` as an explicit argument and includes it in the `WHERE` clause. The value always comes from `CurrentUser.organizationId`, which is read from the database user record by the auth guard — never from the request body or query string.

The frontend communicates with the backend via a Vite dev-server proxy (`/api → http://localhost:3000`). There are no cookies, no sessions, and no external identity providers.

---

## 2. Data Model

### 2.1 organizations

| Column      | Type                    | Constraints           |
|-------------|-------------------------|-----------------------|
| id          | uuid                    | PRIMARY KEY, default gen_random_uuid() |
| name        | varchar(255)            | NOT NULL, UNIQUE      |
| createdAt   | timestamptz             | NOT NULL, default now() |

### 2.2 users

| Column         | Type                    | Constraints                              |
|----------------|-------------------------|------------------------------------------|
| id             | uuid                    | PRIMARY KEY, default gen_random_uuid()   |
| organizationId | uuid                    | NOT NULL, FK → organizations.id          |
| name           | varchar(255)            | NOT NULL                                 |
| email          | varchar(255)            | NOT NULL, UNIQUE                         |
| role           | enum('MANAGER','MEMBER')| NOT NULL                                 |
| createdAt      | timestamptz             | NOT NULL, default now()                  |

**Index:** `(organizationId)` — used by member-count queries and by the auth guard lookup.

### 2.3 surveys

| Column         | Type         | Constraints                                        |
|----------------|--------------|----------------------------------------------------|
| id             | uuid         | PRIMARY KEY, default gen_random_uuid()             |
| organizationId | uuid         | NOT NULL, FK → organizations.id                    |
| title          | varchar(255) | NOT NULL                                           |
| createdAt      | timestamptz  | NOT NULL, default now()                            |

**Index:** `(organizationId)` — used by the active-survey and summary endpoints.

### 2.4 questions

| Column     | Type                       | Constraints                              |
|------------|----------------------------|------------------------------------------|
| id         | uuid                       | PRIMARY KEY, default gen_random_uuid()   |
| surveyId   | uuid                       | NOT NULL, FK → surveys.id ON DELETE CASCADE |
| text       | varchar(1000)              | NOT NULL                                 |
| type       | enum('RATING','YES_NO')    | NOT NULL                                 |
| orderIndex | smallint                   | NOT NULL                                 |

**Application-layer constraint:** the service rejects a `createSurvey` request if the supplied `questions` array has more than 3 items. This is enforced in NestJS before the INSERT, not as a DB trigger.

**Index:** `(surveyId, orderIndex)` — preserves question display order.

### 2.5 responses

| Column    | Type        | Constraints                                          |
|-----------|-------------|------------------------------------------------------|
| id        | uuid        | PRIMARY KEY, default gen_random_uuid()               |
| surveyId  | uuid        | NOT NULL, FK → surveys.id                            |
| userId    | uuid        | NOT NULL, FK → users.id                              |
| weekKey   | varchar(8)  | NOT NULL — format: `YYYY-Www` e.g. `2026-W38`        |
| createdAt | timestamptz | NOT NULL, default now()                              |

**Critical constraint:** `UNIQUE (surveyId, userId, weekKey)` — enforces one submission per member per survey per ISO week at the database level. The service layer checks for an existing row first and returns HTTP 409 before the constraint is exercised, but the constraint is the final safety net.

**Index:** `(surveyId, weekKey)` — used by the summary aggregation query.

### 2.6 response_answers

| Column      | Type         | Constraints                                             |
|-------------|--------------|----------------------------------------------------------|
| id          | uuid         | PRIMARY KEY, default gen_random_uuid()                   |
| responseId  | uuid         | NOT NULL, FK → responses.id ON DELETE CASCADE            |
| questionId  | uuid         | NOT NULL, FK → questions.id                              |
| ratingValue | smallint     | NULL — present only when question.type = 'RATING'        |
| yesNoValue  | boolean      | NULL — present only when question.type = 'YES_NO'        |

**Constraints:**
- `UNIQUE (responseId, questionId)` — one answer per question per response.
- `CHECK (ratingValue IS NULL OR (ratingValue >= 1 AND ratingValue <= 5))` — enforces valid rating range.
- `CHECK (NOT (ratingValue IS NOT NULL AND yesNoValue IS NOT NULL))` — exactly one value column may be populated.

---

## 3. Weekly Window Decision

**Choice: ISO 8601 calendar weeks (YYYY-Www)**

`weekKey` is computed server-side from the submission timestamp using ISO week arithmetic. Examples:
- 2026-09-14 (Sunday) → `2026-W37`
- 2026-09-15 (Monday) → `2026-W38`

**Why ISO weeks over a rolling 7-day window:**

| Concern | ISO week | Rolling 7-day |
|---|---|---|
| Determinism | Every member in the same organization sees the same "week" boundary regardless of when they submitted last week | Two members submitting on different days could have different personal windows |
| Aggregation | The summary query groups by `weekKey` with a simple equality filter | Requires per-user window calculation; complicates the aggregation SQL |
| Business meaning | "This week" maps to Mon–Sun, which matches how managers think about weekly cadences | Feels like an engineering artefact, not a business concept |
| Simplicity | `weekKey` is a computed varchar stored on insert; no date arithmetic needed at query time | Requires storing the submission timestamp and computing windows dynamically |

**ISO week starts on Monday** (ISO 8601 standard). The server derives `weekKey` at response submission time and stores it; no recalculation is ever needed.

---

## 4. Tenancy Strategy

**Approach: application-layer scoping**

Row-level security (RLS) policies were considered and rejected for this slice because:
- RLS requires database users or session variables to be set per request, adding connection-pool complexity.
- Application-layer scoping is simpler to reason about, audit, and test.
- The assignment explicitly states any isolation approach is acceptable; the choice must be documented (here it is).

**Rules, enforced in code:**

1. The `AuthGuard` reads `X-User-Id` from the request header, looks up the user record by that ID in the database, and attaches `CurrentUser { id, organizationId, role }` to the request object. If no matching user is found, it returns `401`.

2. Every service method that touches a survey, question, response, or answer accepts `organizationId: string` as a parameter. It is always passed as `currentUser.organizationId` from the controller — never extracted from request body or URL params.

3. Survey ownership is verified on every cross-entity operation: before submitting a response, the service confirms `survey.organizationId === currentUser.organizationId`. A mismatch returns `404` (not `403`, to avoid leaking the existence of resources in other orgs).

4. The summary denominator (member count) is computed as `COUNT(*) FROM users WHERE organizationId = :orgId AND role = 'MEMBER'` — scoped to the same org as the survey.

5. The seed script bypasses the guard (it runs at startup, not over HTTP). All other data access goes through the guard.

---

## 5. Local Identity

> **⚠ Divergence from AGENTS.md**
>
> AGENTS.md §2 specifies: *"Issue a stateless JWT from a seeded-user login endpoint."*
>
> This implementation uses an `X-User-Id` header instead of a JWT. The divergence is a deliberate, scoped trade-off for a local-only demo and is documented here and in SOLUTION.md §Trade-offs. The security properties that matter (organizationId always derived from the DB, never from the client) are fully preserved regardless of the token mechanism. Replacing the header with a real JWT requires only swapping the `AuthGuard` — no service or entity code changes.

**Mechanism: `X-User-Id` request header**

There are no passwords, no JWTs, no sessions, and no external identity providers. This is intentional for local development simplicity.

**Flow:**

1. The React login screen calls `GET /auth/users` to retrieve the list of seeded users (id, name, email, role, organizationName).
2. The user selects a name from a dropdown. The selected user's `id` is stored in component state (not localStorage — no persistence needed for a local demo).
3. Every subsequent API call from the frontend includes the header `X-User-Id: <selected-user-id>`.
4. The NestJS `AuthGuard` intercepts every protected route, reads the header, queries `users WHERE id = :id`, and populates `request.currentUser`.
5. The `RolesGuard` checks `currentUser.role` against the `@Roles(...)` decorator on the handler.

**`CurrentUser` shape:**
```typescript
interface CurrentUser {
  id: string;           // UUID
  organizationId: string; // UUID — always from DB, never from client
  role: 'MANAGER' | 'MEMBER';
}
```

**Why not JWT for local dev:**
- JWTs require a secret, a signing step, and expiry handling — all unnecessary friction for a local demo where the "auth" is just picking a user from a list.
- The `X-User-Id` approach is transparent, easy to test with curl, and trivially replaced with real JWT auth in production.

---

## 6. API Contracts

### 6.1 `GET /auth/users`

| Field | Value |
|---|---|
| Auth required | No |
| Role | Any (unauthenticated) |

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "Alice Manager",
    "email": "alice@acme.example",
    "role": "MANAGER",
    "organizationName": "Acme"
  }
]
```

**Purpose:** Populates the login dropdown. Returns all seeded users. No filtering.

---

### 6.2 `GET /auth/me`

| Field | Value |
|---|---|
| Auth required | Yes (`X-User-Id` header) |
| Role | MANAGER or MEMBER |

**Response 200:**
```json
{
  "id": "uuid",
  "name": "Alice Manager",
  "role": "MANAGER",
  "organizationId": "uuid",
  "organizationName": "Acme"
}
```

**Error cases:**
- `401` — `X-User-Id` header missing or user not found in database.

**Purpose:** Called immediately after login to determine which screen to render (manager summary vs member survey).

---

### 6.3 `GET /surveys/active`

| Field | Value |
|---|---|
| Auth required | Yes |
| Role | MANAGER or MEMBER |
| Org scoping | `WHERE survey.organizationId = currentUser.organizationId` |

**Response 200:**
```json
{
  "id": "uuid",
  "title": "Weekly Pulse — Week 38",
  "questions": [
    { "id": "uuid", "text": "How energised do you feel?", "type": "RATING", "orderIndex": 0 },
    { "id": "uuid", "text": "Did you have a 1:1 this week?", "type": "YES_NO", "orderIndex": 1 }
  ]
}
```

**Error cases:**
- `401` — no valid `X-User-Id`.
- `404` — no survey exists for this organization.

**Notes:** Returns the most recently created survey for the organization. "Active" is not a status flag in this slice — every survey is considered active. If multiple surveys exist, the most recent (`ORDER BY createdAt DESC LIMIT 1`) is returned.

---

### 6.4 `POST /surveys`

| Field | Value |
|---|---|
| Auth required | Yes |
| Role | MANAGER only |
| Org scoping | `organizationId` is set from `currentUser.organizationId`, never from request body |

**Request body:**
```json
{
  "title": "Weekly Pulse — Week 38",
  "questions": [
    { "text": "How energised do you feel?", "type": "RATING" },
    { "text": "Did you have a 1:1 this week?", "type": "YES_NO" }
  ]
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "title": "Weekly Pulse — Week 38",
  "organizationId": "uuid",
  "questions": [
    { "id": "uuid", "text": "How energised do you feel?", "type": "RATING", "orderIndex": 0 },
    { "id": "uuid", "text": "Did you have a 1:1 this week?", "type": "YES_NO", "orderIndex": 1 }
  ]
}
```

**Error cases:**
- `401` — no valid `X-User-Id`.
- `403` — authenticated user has role MEMBER.
- `400` — `questions` array is empty or has more than 3 items; invalid question type; missing required fields.

---

### 6.5 `POST /surveys/:id/responses`

| Field | Value |
|---|---|
| Auth required | Yes |
| Role | MEMBER only |
| Org scoping | Survey must belong to `currentUser.organizationId` |

**Request body:**
```json
{
  "answers": [
    { "questionId": "uuid", "ratingValue": 4 },
    { "questionId": "uuid", "yesNoValue": true }
  ]
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "surveyId": "uuid",
  "userId": "uuid",
  "weekKey": "2026-W38",
  "createdAt": "2026-09-20T10:00:00.000Z"
}
```

**Error cases:**
- `401` — no valid `X-User-Id`.
- `403` — authenticated user has role MANAGER.
- `404` — survey `:id` does not exist within `currentUser.organizationId`.
- `409` — a response from this user for this survey already exists in the current ISO week (`UNIQUE(surveyId, userId, weekKey)` would be violated). Response body: `{ "message": "You have already submitted a response for this survey this week." }`.
- `400` — answer for an unknown `questionId`; `ratingValue` outside 1–5; both `ratingValue` and `yesNoValue` supplied for one answer; required answer missing for a question.

**Server-side logic:**
1. Compute `weekKey = currentISOWeek()` (e.g. `2026-W38`).
2. Check for existing response: `SELECT id FROM responses WHERE surveyId = :sid AND userId = :uid AND weekKey = :wk`.
3. If found → return `409`.
4. Validate each answer against its question's type.
5. Insert `responses` row, then insert `response_answers` rows in a single transaction.

---

### 6.6 `GET /surveys/:id/summary`

| Field | Value |
|---|---|
| Auth required | Yes |
| Role | MANAGER only |
| Org scoping | Survey must belong to `currentUser.organizationId` |

**Query parameter (optional):** `weekKey=2026-W38`. Defaults to the current ISO week if omitted.

**Response 200:**
```json
{
  "surveyId": "uuid",
  "title": "Weekly Pulse — Week 38",
  "weekKey": "2026-W38",
  "completionCount": 2,
  "memberCount": 3,
  "completionRate": 0.6667,
  "questions": [
    {
      "questionId": "uuid",
      "text": "How energised do you feel?",
      "type": "RATING",
      "count": 2,
      "average": 4.0
    },
    {
      "questionId": "uuid",
      "text": "Did you have a 1:1 this week?",
      "type": "YES_NO",
      "yesCount": 1,
      "noCount": 1
    }
  ]
}
```

**Error cases:**
- `401` — no valid `X-User-Id`.
- `403` — authenticated user has role MEMBER.
- `404` — survey `:id` does not exist within `currentUser.organizationId`.

---

## 7. Summary Computation

All aggregation is performed in a single PostgreSQL query, not in Node application code. This avoids loading raw answer rows into memory and keeps the computation close to the data.

**Member count sub-query:**
```sql
SELECT COUNT(*) AS member_count
FROM users
WHERE organization_id = :orgId
  AND role = 'MEMBER'
```

**Response count for the week:**
```sql
SELECT COUNT(DISTINCT r.id) AS completion_count
FROM responses r
WHERE r.survey_id = :surveyId
  AND r.week_key = :weekKey
```

**Per-question rollup (single query using conditional aggregation):**
```sql
SELECT
  q.id                                        AS question_id,
  q.text,
  q.type,
  COUNT(ra.id)                                AS answer_count,
  AVG(ra.rating_value)                        AS rating_average,
  COUNT(ra.id) FILTER (WHERE ra.yes_no_value = TRUE)  AS yes_count,
  COUNT(ra.id) FILTER (WHERE ra.yes_no_value = FALSE) AS no_count
FROM questions q
LEFT JOIN response_answers ra ON ra.question_id = q.id
LEFT JOIN responses r         ON r.id = ra.response_id
                              AND r.week_key = :weekKey
WHERE q.survey_id = :surveyId
GROUP BY q.id, q.text, q.type, q.order_index
ORDER BY q.order_index
```

**Completion rate:**
- Computed in the NestJS service layer (not SQL) as `completionCount / memberCount`.
- If `memberCount = 0`, return `completionRate: 0` to avoid division by zero.
- Round to 4 decimal places.

**Notes:**
- `LEFT JOIN` ensures questions with zero answers still appear in the result.
- The `FILTER` clause is standard PostgreSQL syntax for conditional aggregation.
- `rating_average` will be `null` for YES_NO questions and vice versa; the service maps null fields to undefined in the response JSON.

---

## 8. React Scope

The frontend consists of three views rendered conditionally based on authentication state. No routing library is required.

### 8.1 State machine

```
App state: { currentUser: CurrentUser | null, view: 'login' | 'member' | 'manager' }

null currentUser         → render LoginScreen
MEMBER role              → render MemberSurveyScreen
MANAGER role             → render ManagerSummaryScreen
```

### 8.2 LoginScreen

- Calls `GET /auth/users` on mount to populate a `<select>` dropdown.
- Each `<option>` displays `"{name} ({organizationName}) — {role}"`.
- A "Log in" button calls `GET /auth/me` with the selected user's id as `X-User-Id`, then sets `currentUser` in App state.
- No password field. No form validation beyond requiring a selection.

### 8.3 MemberSurveyScreen

- On mount: calls `GET /surveys/active`.
- Renders each question:
  - `RATING` → five radio buttons labelled 1–5 (or equivalent number inputs).
  - `YES_NO` → two radio buttons: "Yes" and "No".
- "Submit" button: calls `POST /surveys/:id/responses`.
  - On `201`: shows a success message ("Response submitted for week 2026-W38").
  - On `409`: shows "You have already submitted a response this week."
  - On any other error: shows a generic error message.
- A "Log out" button clears `currentUser` and returns to LoginScreen.

### 8.4 ManagerSummaryScreen

- On mount: calls `GET /surveys/active` to get the survey id and title, then calls `GET /surveys/:id/summary`.
- Renders:
  - Survey title and current week key.
  - Completion count, member count, and completion rate as a percentage.
  - For each question:
    - `RATING`: "Average: {average} ({count} responses)"
    - `YES_NO`: "Yes: {yesCount} / No: {noCount}"
- A "Log out" button clears `currentUser` and returns to LoginScreen.
- No submission controls. Read-only.

### 8.5 Shared API client

A single `apiClient.ts` module wraps `fetch`. It:
- Prepends `/api` to every path (resolved to `:3000` by the Vite proxy).
- Injects the `X-User-Id` header from a module-level variable set at login.
- Throws a typed error on non-2xx responses, including the status code and parsed message body.

---

## 9. Test Strategy

All tests live in `backend/src/**/*.spec.ts` and run with Jest (`npm test`). No browser tests.

### 9.1 Tenant Isolation — 4 Security Regression Tests

These four tests must exist and must assert a non-200 response. A 200 on any of them is a data breach.

| # | Test name | Setup | Action | Expected |
|---|---|---|---|---|
| T1 | Cross-org summary access | Create survey in Org A. Authenticate as MANAGER in Org B. | `GET /surveys/:orgA-survey-id/summary` | `404` |
| T2 | Cross-org response submission | Create survey in Org A. Authenticate as MEMBER in Org B. | `POST /surveys/:orgA-survey-id/responses` with valid body | `404` |
| T3 | Active survey list isolation | Create surveys in both Org A and Org B. Authenticate as MEMBER in Org A. | `GET /surveys/active` | Response contains only Org A's survey. Org B's survey id does not appear anywhere in the response body. |
| T4 | Summary denominator isolation | Org A has 2 members, Org B has 10 members. Org A survey has 1 response. | `GET /surveys/:orgA-survey-id/summary` as Org A MANAGER | `memberCount = 2`, not 12 or 10. `completionRate = 0.5`. |

### 9.2 Authorization Tests

| Test name | Setup | Action | Expected |
|---|---|---|---|
| Member cannot view summary | Authenticate as MEMBER | `GET /surveys/:id/summary` | `403` |
| Manager cannot submit response | Authenticate as MANAGER | `POST /surveys/:id/responses` | `403` |
| Unauthenticated request rejected | No `X-User-Id` header | Any protected endpoint | `401` |
| Unknown user id rejected | `X-User-Id: non-existent-uuid` | Any protected endpoint | `401` |

### 9.3 Response Rule Tests

| Test name | Setup | Action | Expected |
|---|---|---|---|
| First submission succeeds | MEMBER, no prior response | `POST /surveys/:id/responses` | `201`, response body contains `weekKey` |
| Second submission same week | MEMBER, one prior response in current week | `POST /surveys/:id/responses` again | `409` with descriptive message |
| Rating out of range | MEMBER, valid survey | Submit `ratingValue: 6` | `400` |
| Rating zero rejected | MEMBER, valid survey | Submit `ratingValue: 0` | `400` |
| Wrong answer type rejected | MEMBER, RATING question | Submit `yesNoValue: true` for a RATING question | `400` |

### 9.4 Summary Correctness Tests

| Test name | Setup | Action | Expected |
|---|---|---|---|
| Rating average | 2 responses: ratings 3 and 5 | `GET /surveys/:id/summary` | `average: 4.0`, `count: 2` |
| Yes/no counts | 3 responses: yes, yes, no | `GET /surveys/:id/summary` | `yesCount: 2`, `noCount: 1` |
| Zero responses | Survey with no responses | `GET /surveys/:id/summary` | `completionCount: 0`, `completionRate: 0` |
| Zero members | Org with 0 members (edge case) | `GET /surveys/:id/summary` | `memberCount: 0`, `completionRate: 0` (no divide-by-zero) |
| Questions with no answers appear | Survey with 2 questions, only 1 answered | `GET /surveys/:id/summary` | Both questions present in response; unanswered question shows `count: 0` |

---

## 10. Known Gaps and Trade-offs

### Intentionally excluded from this slice

| Gap | Reason |
|---|---|
| JWT authentication | Unnecessary complexity for a local demo. `X-User-Id` is transparent and trivially replaced with real auth in production. |
| Survey activation / deactivation status | Adds a lifecycle state machine with no benefit for the demo. "Most recent survey" is a sufficient proxy for "active". |
| Multiple active surveys per org | Out of scope — the spec says one survey per org is sufficient for the demo flow. |
| Survey editing after creation | Complicates rollup logic (answers reference immutable question types). Not required. |
| Pagination on any endpoint | All datasets are small in the demo. Not required. |
| Migrations | `synchronize: true` is used in development. Production would require TypeORM migrations. |
| Input sanitisation beyond class-validator | class-validator covers the DTO layer. SQL injection is prevented by TypeORM parameterised queries. |
| Rate limiting | Not relevant for a local demo. |
| Audit logging | Out of scope. |
| Logo / image storage | Covered as a design-only note in SOLUTION.md (Task 3). No implementation. |
| Soft deletes | Not required. Hard deletes cascade via FK constraints. |
| User management endpoints | Users are seeded; no CRUD API for users is needed. |

### Known limitations worth noting in the video demo

- The `X-User-Id` header is trivially forgeable. In production this would be replaced by a signed JWT or a session cookie validated server-side.
- `synchronize: true` drops and recreates columns on schema changes; it would never be used in a production database.
- The seed script runs on every startup. It is idempotent (uses `upsert` / `INSERT ... ON CONFLICT DO NOTHING`), so re-running the server does not duplicate seed data.
- ISO week boundary: if a member submits on Sunday of week W and the organization's week is considered to start Monday, the member will be in week W while the following Monday opens week W+1. This is expected ISO 8601 behaviour and is documented in SPEC.md section 3.
