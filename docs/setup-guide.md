# Setup Guide

## Development seed accounts
All three accounts use the development-only password `ChangeThis123!` by default:
- `admin@oes.local` (ADMIN)
- `faculty@oes.local` (FACULTY, verified and approved for demo)
- `student@oes.local` (STUDENT)

Override with `SEED_DEV_PASSWORD`, `SEED_ADMIN_EMAIL`, `SEED_FACULTY_EMAIL`, and `SEED_STUDENT_EMAIL` before running seed. Do not use these credentials outside local development.

## Commands
From repository root:
```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```
If Prisma Client is not generated, run `npm --workspace apps/backend run prisma:generate`. Open frontend at port 3000; API at port 4000; Swagger at `/api/docs`.

## Troubleshooting
- Database connection failure: confirm Docker container is healthy and `.env` `DATABASE_URL` matches the compose credentials.
- Port busy: change `PORT` for backend or start Next.js with `-p <port>` and update `FRONTEND_URL`.
- Login says account inactive: seed demo accounts or have an administrator activate the account through the database in development.
- Registration does not sign in automatically: newly registered accounts start PENDING by design.
- Prisma schema changed: generate client and create/apply a migration before starting the app.
