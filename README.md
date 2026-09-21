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
pulse-surveys/
├── backend/          NestJS API (port 3000)
│   └── src/
│       ├── main.ts
│       └── app.module.ts
├── frontend/         React + Vite UI (port 5173)
│   └── src/
│       └── main.tsx
├── docker-compose.yml
└── README.md
```

---

## Design Notes

See [SOLUTION.md](./SOLUTION.md) for trade-offs, known gaps, AWS design, and AI workflow.
