# Online Examination System (OES)

A TypeScript monorepo for a college OES with separately owned Authentication/User Management (Module 1) and Examination/Auto Submission (Module 2).

## Stack
- Next.js App Router, React, TypeScript, Tailwind CSS
- NestJS REST API, validation, JWT authorization
- PostgreSQL 16, Prisma ORM
- Docker Compose

## Prerequisites
Node.js 20.11–22.x, npm 10+, and Docker Desktop or Docker Engine with Compose. Ports 3000, 4000 and 5433 must be available.

## Quick start
Run these commands from the repository root:

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000. Sign in as `admin@oes.local` with the development password `ChangeThis123!` to open the admin dashboard at `/admin`. API Swagger docs are at http://localhost:4000/api/docs and health check at http://localhost:4000/api/health.
An active faculty account approved by an administrator is redirected to the faculty workspace at `/faculty`.
An active student account is redirected to the student workspace at `/student`, where in-progress attempts can be resumed and published results are shown.

The seed creates development administrator, faculty, and student accounts only when their email variables are not already present. Credentials are documented in `docs/setup-guide.md`; change them before any shared deployment. Seed accounts are development-only.

## Workspaces
- `apps/backend`: NestJS API and Prisma integration
- `apps/frontend`: Next.js user interface
- `packages/shared`: shared integration contract
- `prisma`: canonical database schema and migration history
- `docs`: architecture, API, ownership, setup, and test report

## Module ZIPs
The three ZIP files in the repository root are generated packaging deliverables. The module ZIPs include the relevant module source, shared contract, schema reference, and module README. The complete ZIP includes the integrated monorepo.

## Security and verification notes
This is a college-project foundation, not a claim of production certification. Run tests and builds in your environment before submission. Email verification delivery, refresh-token rotation, production mail provider, and full browser end-to-end tests require deployment-specific configuration. Browser tab-switch events are audit signals, not proof of misconduct.
