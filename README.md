# Pulse Surveys

A minimal multi-tenant pulse survey platform built with NestJS, PostgreSQL, and React.

Organizations run lightweight weekly surveys. Members submit one response per week.
Managers view aggregated summaries. Data is strictly isolated between organizations.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20.19 or later
- [Docker](https://www.docker.com/) (for PostgreSQL)

---

## Quick Start

### 1. Start the database

```bash
docker compose up -d
```

This starts a PostgreSQL instance on `localhost:5432` with:
- Database: `pulse`
- User: `pulse`
- Password: `pulse`

### 2. Install and run the backend

```bash
cd backend
npm install
npm run start:dev
```

The API listens on http://localhost:3000

### 3. Install and run the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The UI is served at http://localhost:5173

---

## Seeded Users

The backend seeds two organizations on startup:

| Name         | Email                    | Role    | Org    |
|--------------|--------------------------|---------|--------|
| Alice Manager | alice@acme.example      | MANAGER | Acme   |
| Bob Member   | bob@acme.example         | MEMBER  | Acme   |
| Carol Member | carol@acme.example       | MEMBER  | Acme   |
| Dave Manager | dave@globex.example      | MANAGER | Globex |
| Eve Member   | eve@globex.example       | MEMBER  | Globex |
| Frank Member | frank@globex.example     | MEMBER  | Globex |

Log in by selecting a user from the dropdown on the login screen. No password required locally.

---

## Running Tests

```bash
cd backend

# Unit tests
npm test

# Integration + E2E tests (requires Postgres running)
npm run test:integration
```

---

## Project Structure

```
ChangeLogicAssignmentSubmission/
├── AGENTS.md                        # AI agent constraints and instructions
├── PLAYBOOK.md                      # Codex-authored prompt playbook (execution order)
├── SPEC.md                          # Implementation specification (committed before code)
├── SOLUTION.md                      # Design notes, trade-offs, AWS design, AI workflow
├── README.md
├── docker-compose.yml               # PostgreSQL service
├── ai-logs/                         # Exported Kiro session transcripts
│
├── backend/                         # NestJS API (port 3000)
│   ├── jest.integration.json        # Jest config for integration + e2e tests
│   └── src/
│       ├── app.module.ts            # Root module — global AuthGuard + RolesGuard
│       ├── main.ts                  # Bootstrap, ValidationPipe, CORS
│       ├── data-source.ts           # TypeORM CLI data source (migrations)
│       ├── seed.ts                  # Seed script — 2 orgs, 6 users, 2 surveys
│       ├── auth/
│       │   ├── auth.controller.ts   # GET /auth/me, GET /auth/users
│       │   ├── auth.guard.ts        # X-User-Id → CurrentUser (401 if missing/unknown)
│       │   ├── auth.service.ts
│       │   ├── auth.module.ts
│       │   ├── auth.guard.spec.ts   # Unit tests for AuthGuard
│       │   ├── current-user.decorator.ts
│       │   ├── current-user.interface.ts
│       │   ├── public.decorator.ts  # @Public() — bypasses AuthGuard
│       │   ├── roles.decorator.ts   # @Roles(...) — sets required role metadata
│       │   └── roles.guard.ts       # Role enforcement (403 on mismatch)
│       ├── common/
│       │   └── iso-week.ts          # currentISOWeek() utility
│       ├── entities/
│       │   ├── organization.entity.ts
│       │   ├── user.entity.ts       # UserRole enum: MANAGER | MEMBER
│       │   ├── survey.entity.ts
│       │   ├── question.entity.ts   # QuestionType enum: RATING | YES_NO
│       │   ├── response.entity.ts   # UNIQUE(survey_id, user_id, week_key)
│       │   └── response-answer.entity.ts
│       ├── migrations/
│       │   └── 1726790400000-InitialSchema.ts
│       └── surveys/
│           ├── surveys.controller.ts
│           ├── surveys.service.ts
│           ├── surveys.module.ts
│           ├── dto/
│           │   ├── create-survey.dto.ts
│           │   └── submit-response.dto.ts
│           ├── surveys.service.spec.ts       # Unit tests — survey CRUD
│           ├── surveys.response.spec.ts      # Unit tests — response submission
│           ├── surveys.summary.spec.ts       # Unit tests — summary aggregation
│           ├── surveys.integration.spec.ts   # Integration tests — isolation, auth, rules
│           └── surveys.e2e.spec.ts           # E2E — full cycle + cross-tenant negatives
│
└── frontend/                        # React + Vite UI (port 5173)
    └── src/
        ├── main.tsx                 # App root — conditional render by role
        ├── types.ts                 # Shared TypeScript interfaces
        ├── api.ts                   # fetch wrapper — injects X-User-Id header
        ├── UserSelector.tsx         # Always-visible user dropdown
        ├── MemberScreen.tsx         # Survey form — RATING buttons, YES/NO buttons
        └── ManagerScreen.tsx        # Summary view — completion + per-question rollups
```

---

## Design Notes

See [SOLUTION.md](./SOLUTION.md) for trade-offs, known gaps, AWS design, and AI workflow.
