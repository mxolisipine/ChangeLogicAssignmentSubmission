# Change Logic — Senior Full Stack Engineer (AI Native) Assignment
## Kiro Prompt Playbook

This file contains one focused Kiro prompt per commit/stage from the Weekend Implementation README.
Use each prompt in order. Review every output before moving to the next step.

---

## Stage 1 — Analysis (pre-code, no commit)

### Prompt — Stage 1: Analyse the assignment

```
Please read assignment.md.

Do NOT write any code.

Identify and list:
1. Business requirements — what the system must do.
2. Invariants — rules that must never be violated (e.g. one submission per member per week).
3. Authorization rules — who can do what (Manager vs Member).
4. Tenancy boundaries — how Acme data is kept separate from Globex data.
5. Database constraints — the unique and foreign-key constraints that enforce correctness.
6. Minimum API surface — the smallest set of endpoints that satisfies the assignment.
7. Minimum UI — the smallest React screens that satisfy the assignment.
8. Testing strategy — which invariants must have explicit tests and why.

End with a single paragraph proposing the smallest, most coherent implementation that satisfies all requirements without overbuilding.

Do not generate code, file stubs, or directory trees yet.
```

---

## Stage 2 — AGENTS.md (Commit 1 prep)

### Prompt — Stage 2: Draft AGENTS.md

```
Based on analysis.md, create a file called AGENTS.md.

It must contain the following sections exactly:

1. Assignment Goal — one concise paragraph.
2. Technology Constraints — TypeScript, NestJS, PostgreSQL, React. No external identity providers. No paid cloud services.
3. Tenancy Rules — organization is always derived from the server-side user lookup. The client never supplies an organizationId that is trusted.
4. Roles — MANAGER and MEMBER. List what each role can and cannot do.
5. Response Rules — one submission per member per survey per week, enforced by a UNIQUE(surveyId, userId, weekKey) database constraint. weekKey format: YYYY-Www (e.g. 2026-W38).
6. API Rules — list the 6 endpoints from the spec. For each: method, path, who can call it, and the key authorization check.
7. Testing Expectations — tenant isolation tests, authorization tests, response rule tests, and summary correctness tests must all exist. List the 4 security regression tests explicitly.
8. Simplicity Guidance — a short list of things NOT to build (OAuth, email, microservices, design system, etc.).

Do not write any application code. Only produce AGENTS.md.
```

---

## Commit 1

**Message:** `chore: initialize repository and Kiro instructions`

### Prompt — Commit 1: Scaffold the repository

```
Scaffold the project repository. Do not implement application logic yet.

Create the following structure:

pulse-surveys/
├── AGENTS.md            (already written — do not modify)
├── README.md            (brief: what the project is, how to run it locally)
├── .gitignore           (Node, dist, .env, postgres data)
├── docker-compose.yml   (postgres service only, port 5432, named volume)
├── backend/
│   ├── package.json     (NestJS, TypeORM, pg, class-validator, class-transformer — pinned versions)
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts      (NestJS bootstrap, port 3000)
│       └── app.module.ts
└── frontend/
    ├── package.json     (React + Vite, pinned versions)
    ├── tsconfig.json
    └── src/
        └── main.tsx

Rules:
- All dependencies must use exact pinned versions (no ^ or ~).
- Do not add OAuth, Auth0, Cognito, or any external identity library.
- Do not implement any feature logic — this commit is structure only.
- Verify the backend compiles with `tsc --noEmit` before finishing.
```

---

## Commit 2

**Message:** `docs: add implementation specification`

### Prompt — Commit 2: Write SPEC.md

```
Produce a file called SPEC.md. Do NOT write any application code.

The spec must cover:

1. Architecture overview — React → NestJS → PostgreSQL, with tenant isolation happening at the service layer.
2. Data model — full schema for: Organization, User (with role enum), Survey, Question (with type enum), Response, ResponseAnswer. Include all constraints, especially UNIQUE(surveyId, userId, weekKey).
3. Weekly window decision — use ISO calendar weeks (YYYY-Www). Document why this was chosen over rolling 7-day windows.
4. Tenancy strategy — application-layer isolation. Every query that touches organization-owned data is scoped by currentUser.organizationId derived from the database, never from the client.
5. Local identity — X-User-Id header resolved by a NestJS guard to a CurrentUser object: { id, organizationId, role }. No passwords, no JWTs.
6. API contracts — for each of the 6 endpoints, specify: HTTP method, path, request shape, response shape, authorization rule, and error cases (403 vs 404 vs 409).
7. Summary computation — completion count, completion rate, rating average + count, yes/no counts. All aggregated in PostgreSQL, not in Node.
8. React scope — user selector dropdown, member survey screen, manager summary screen. No routing library required; conditional rendering is fine.
9. Test strategy — list specific test cases for: tenant isolation (4 security tests), authorization, response rules, summary correctness.
10. Known gaps and trade-offs — note what is intentionally excluded and why.

This document must exist and be committed BEFORE any application implementation commits.
After producing SPEC.md, stop. Do not generate code.
```

---

## Commit 3

**Message:** `feat: add multi-tenant data model and seed data`

### Prompt — Commit 3: Data model, migrations, and seed

```
Implement the database layer based on SPEC.md. No API or UI code yet.

Tasks:
1. Create TypeORM entities for: Organization, User, Survey, Question, Response, ResponseAnswer.
   - Use UUIDs for all primary keys.
   - Add the UNIQUE(surveyId, userId, weekKey) constraint on the Response entity.
   - Add CHECK constraints: ratingValue must be 1–5 when type is RATING.
   - User.role must be the enum: MANAGER | MEMBER.
   - Question.type must be the enum: RATING | YES_NO.
   - Question.position is an integer, max 3 questions per survey enforced at the service layer (not DB constraint).

2. Create a TypeORM migration that builds the full schema from scratch.

3. Create a seed script (backend/src/seed.ts) that inserts:
   - Organization: Acme (id: acme-org)
   - Organization: Globex (id: globex-org)
   - Users:
     - Alice — MANAGER — Acme
     - Bob   — MEMBER  — Acme
     - Carol — MEMBER  — Acme
     - Dave  — MANAGER — Globex
     - Eve   — MEMBER  — Globex
     - Frank — MEMBER  — Globex
   - One active survey per organization for the current ISO week (2026-W38).
   - 2–3 questions per survey (mix of RATING and YES_NO).
   - Use predictable, hardcoded UUIDs so tests can reference them directly.

4. Verify the migration runs clean against a fresh PostgreSQL instance using docker-compose.

Do not implement guards, services, controllers, or UI.
```

---

## Commit 4

**Message:** `feat: implement auth guard and identity resolution`

### Prompt — Commit 4: Local identity guard and CurrentUser

```
Implement local identity resolution. No survey or response logic yet.

Tasks:
1. Create backend/src/auth/current-user.decorator.ts — a NestJS parameter decorator that extracts CurrentUser from the request.

2. Create backend/src/auth/auth.guard.ts — a NestJS guard that:
   - Reads the X-User-Id header from the incoming request.
   - Looks up the user in the database (including their organizationId and role).
   - Attaches { id, organizationId, role } to request.user as CurrentUser.
   - Returns HTTP 401 if the header is missing.
   - Returns HTTP 401 if the user ID does not exist in the database.

3. Register the guard globally in AppModule so every route is protected by default.

4. Create GET /me endpoint that returns the CurrentUser for the authenticated user. This is useful for the React app to bootstrap.

5. Write a unit test for the guard:
   - Valid X-User-Id returns the correct CurrentUser.
   - Missing header returns 401.
   - Unknown user ID returns 401.

Important rules:
- The guard must derive organizationId from the database. It must NEVER read organizationId from a request header, query param, or body.
- Do not implement JWT, sessions, or passwords.
```

---

## Commit 5

**Message:** `feat: add SurveysModule with creation and retrieval endpoints`

### Prompt — Commit 5: Survey management endpoints

```
Implement survey creation and retrieval. Base this on SPEC.md.

Tasks:
1. SurveysModule with SurveysController and SurveysService.

2. POST /surveys — Manager only.
   - Body: { title: string, questions: Array<{ text: string, type: "RATING"|"YES_NO", position: number }> }
   - The organizationId is taken from currentUser.organizationId. Ignore any organizationId in the request body.
   - Validate: max 3 questions, position values are unique, type is valid.
   - Returns the created survey with its questions.
   - Returns 403 if the current user is a MEMBER.

3. GET /surveys/active — Member or Manager.
   - Returns the survey where organizationId = currentUser.organizationId AND activeFrom <= now AND activeUntil >= now.
   - Returns 404 if no active survey exists for the user's organization.

4. GET /surveys/:id — Member or Manager.
   - Returns the survey only if survey.organizationId = currentUser.organizationId.
   - Returns 404 (not 403) if the survey belongs to a different organization. Do not reveal its existence.

Rules:
- Business logic must live in SurveysService, not in the controller.
- The controller must be thin: validate input, call service, return result.
- Do not implement response submission or summary in this commit.
```

---

## Commit 6

**Message:** `feat: add member survey response flow`

### Prompt — Commit 6: Response submission

```
Implement response submission for members. Base this on SPEC.md.

Tasks:
1. POST /surveys/:id/responses — Member only.

Request body:
{
  "answers": [
    { "questionId": "uuid", "ratingValue": 4 },
    { "questionId": "uuid", "yesNoValue": true }
  ]
}

Enforce all of the following. Return the correct HTTP status for each failure:
- 403 if the current user is a MANAGER.
- 404 if survey does not belong to currentUser.organizationId.
- 409 if the member has already submitted a response for this survey in the current ISO week.
- 422 if any questionId does not belong to the survey.
- 422 if a RATING answer has ratingValue outside 1–5.
- 422 if a YES_NO answer has ratingValue instead of yesNoValue (or vice versa).
- 422 if not all survey questions are answered.

2. weekKey computation — compute the ISO week key (YYYY-Www) server-side. Do not accept it from the client.

3. Persist a Response row and one ResponseAnswer row per question in a single database transaction. If any part fails, roll back the entire submission.

4. On success, return HTTP 201 with the response ID and weekKey.

Rules:
- The uniqueness check is enforced by the UNIQUE(surveyId, userId, weekKey) database constraint. Catch the constraint violation and return 409.
- Do not implement the summary endpoint in this commit.
```

---

## Commit 7

**Message:** `feat: add GET /surveys/:id/summary with SQL aggregation`

### Prompt — Commit 7: Weekly summary endpoint

```
Implement the survey summary endpoint. Base this on SPEC.md.

Tasks:
1. GET /surveys/:id/summary — Manager only.

Authorization:
- 403 if the current user is a MEMBER.
- 404 if the survey does not belong to currentUser.organizationId.

Query parameter (optional): week — ISO week key (YYYY-Www). Defaults to the current ISO week if not provided.

Response shape:
{
  "surveyId": "uuid",
  "week": "2026-W38",
  "completion": {
    "count": 2,
    "totalMembers": 3,
    "rate": 0.6667
  },
  "questions": [
    {
      "id": "uuid",
      "text": "How confident are you?",
      "type": "RATING",
      "average": 4.5,
      "count": 2
    },
    {
      "id": "uuid",
      "text": "Do you feel supported?",
      "type": "YES_NO",
      "yes": 2,
      "no": 0
    }
  ]
}

Rules:
- All aggregation must happen in PostgreSQL (SQL GROUP BY, AVG, COUNT). Do not load all responses into Node and compute in JavaScript.
- totalMembers = count of users with role MEMBER in the survey's organization.
- completion count = count of distinct members who submitted a response for this survey in the given week.
- rate = completion count / totalMembers, rounded to 4 decimal places.
- For RATING questions: return average (rounded to 2 decimal places) and count of responses.
- For YES_NO questions: return yes count and no count.
```

---

## Commit 8

**Message:** `feat: security and authorization tests`

### Prompt — Commit 8: Security and authorization tests

```
Write the test suite for tenant isolation and authorization. Do not add new features.

Use Jest + Supertest against a running NestJS app (integration tests, not unit tests).
Seed data is already available from the seed script (use the hardcoded UUIDs).

Required test cases — implement every one:

TENANT ISOLATION
1. Acme Manager (Alice) → GET /surveys/:globex-survey-id → must return 404.
2. Acme Manager (Alice) → POST /surveys with an attempt to set organizationId to Globex → the created survey must belong to Acme, not Globex.
3. Acme Member (Bob) → POST /surveys/:globex-survey-id/responses → must return 404.
4. Acme Manager (Alice) → GET /surveys/:globex-survey-id/summary → must return 404.

AUTHORIZATION
5. Member (Bob) → POST /surveys → must return 403.
6. Member (Bob) → GET /surveys/:id/summary → must return 403.
7. Manager (Alice) → POST /surveys/:id/responses → must return 403.

RESPONSE RULES
8. Member (Bob) submits a response → 201 created.
9. Member (Bob) submits a second response for the same survey in the same week → 409 conflict.
10. Member (Bob) submits a response with ratingValue = 6 → 422.
11. Member (Bob) submits a response referencing a questionId that belongs to a different survey → 422.

SUMMARY CORRECTNESS
12. After Bob and Carol both submit responses, Alice's summary shows:
    - completion count = 2
    - totalMembers = 2 (Carol is the only other member; adjust if 3 members exist)
    - correct rating average
    - correct yes/no counts.

Add comments in each test explaining which invariant is being verified and why.
```

---

## Commit 9

**Message:** `feat: add member survey UI`

### Prompt — Commit 9: Member React UI

```
Implement the member-facing React UI. Keep it minimal and functional.

Screens and behaviour:

1. User selector (top of page, always visible):
   - A <select> dropdown listing all seeded users with their name, role, and organization.
   - Selecting a user sets the X-User-Id header for all subsequent API calls.
   - Default to no user selected; show a prompt to select a user.

2. Member screen (shown when the selected user has role MEMBER):
   - Fetch GET /surveys/active on mount.
   - Display the survey title and each question in order.
   - For RATING questions: render 5 clickable buttons labelled 1–5.
   - For YES_NO questions: render two buttons labelled Yes and No.
   - A Submit button at the bottom. Disabled until all questions are answered.
   - On submit: POST /surveys/:id/responses with the answers array.
   - On 201 success: show "Response submitted successfully." and disable the form.
   - On 409 conflict: show "You have already submitted this week."
   - On any other error: show the error message.

3. Manager screen (shown when the selected user has role MANAGER):
   - This will be added in the next commit. For now, show a placeholder: "Manager summary coming soon."

Rules:
- Use fetch with the X-User-Id header. Do not use axios or any HTTP library.
- Do not add a routing library. Use conditional rendering based on user role.
- No CSS framework. Plain CSS or inline styles are fine; the UI does not need to look polished.
- TypeScript throughout. No implicit any.
```

---

## Commit 10

**Message:** `feat: add manager survey summary UI`

### Prompt — Commit 10: Manager React UI

```
Implement the manager-facing summary screen. Replace the placeholder from Commit 9.

Manager screen (shown when the selected user has role MANAGER):
- On mount, fetch GET /surveys/active to get the active survey for the manager's organization.
- Then fetch GET /surveys/:id/summary.
- Display:
  - Survey title
  - Week (e.g. "Week: 2026-W38")
  - Completion section:
    - "X / Y members completed"
    - Completion rate as a percentage (e.g. "66.7%")
  - For each question:
    - Question text
    - If RATING: "Average: X.XX — Responses: N"
    - If YES_NO: "Yes: N — No: N"
- If no active survey exists, show: "No active survey for your organization."
- Add a Refresh button that re-fetches the summary.

Rules:
- Keep it in the same App.tsx / component structure from Commit 9. No new routing.
- Use fetch with X-User-Id header. No additional libraries.
- TypeScript throughout. No implicit any.
- The two-organization demo must work: switching the user selector between Alice (Acme) and Dave (Globex) must show different surveys and different summary data.
```

---

## Commit 11

**Message:** `test: add end-to-end pulse survey flow`

### Prompt — Commit 11: End-to-end test

```
Write an end-to-end test that verifies the complete happy path for one full cycle.
Use Jest + Supertest. Do not use a browser or Cypress.

The test must execute the following steps in order, using the real HTTP API:

1. Bob (Acme Member) calls GET /surveys/active → receives Acme's active survey.
2. Bob submits POST /surveys/:id/responses with one valid answer per question.
3. Bob calls POST /surveys/:id/responses again → receives 409 (duplicate submission check).
4. Alice (Acme Manager) calls GET /surveys/:id/summary for the same week.
5. Assert that Alice's summary shows:
   - completion count ≥ 1 (Bob submitted)
   - the rating average matches what Bob submitted
   - the yes/no counts match what Bob submitted

Also add a cross-tenant negative test in the same file:
6. Dave (Globex Manager) calls GET /surveys/:acme-survey-id/summary → 404.
7. Eve (Globex Member) calls POST /surveys/:acme-survey-id/responses → 404.

Add a comment block at the top of the test file explaining what the test proves
and why the sequence matters (the duplicate submission check must come after a real submission).
```

---


## Final Checklist Prompt (optional, pre-submission)

### Prompt — Pre-submission self-review

```
Review the entire repository against the following checklist. For each item, state PASS or FAIL with a one-line reason.

REPOSITORY
- TypeScript used throughout (backend and frontend)
- NestJS backend
- PostgreSQL database
- React frontend
- Runs locally with docker-compose and npm scripts only
- No external identity provider dependency
- No paid cloud service dependency

BACKEND
- Two organizations (Acme, Globex)
- Manager role implemented
- Member role implemented
- Survey creation (Manager only)
- Max 3 questions per survey enforced
- Rating questions (1–5) implemented
- Yes/No questions implemented
- One response per member per week enforced
- Weekly summary endpoint implemented
- Completion count correct
- Completion rate correct
- Rating average correct
- Yes/No counts correct

SECURITY
- organizationId derived from server-side user lookup (not client input)
- Cross-tenant survey access returns 404
- Cross-tenant response submission returns 404
- Cross-tenant summary access returns 404
- Manager/Member authorization tested

FRONTEND
- User selector works
- Member sees active survey
- Member can submit survey
- Member cannot submit twice
- Manager sees summary with correct data
- Switching between Acme and Globex users shows different data

AI WORKFLOW
- AGENTS.md exists and was committed before implementation
- SPEC.md exists and was committed before implementation
- At least one AI correction/rejection documented in SOLUTION.md
- ai-logs/ directory exists

DOCUMENTATION
- README.md with local setup instructions
- SOLUTION.md with all required sections
- AWS design documented
- Logo storage design documented

GIT
- ~ 13 to 15 Meaningful commits
- No single giant "initial implementation" commit
- Commits reflect actual progression

If any item FAILs, fix it before submitting.
```
