# Architecture

The system is a monorepo with a Next.js frontend, NestJS REST API, and a single PostgreSQL database managed by Prisma. Module 1 owns user identity, account status, and JWT authentication. Module 2 consumes the validated `req.user` populated by the backend guard and owns exam attempts, answer persistence, deadline enforcement, activity logs, and result lifecycle.

## Request flow
1. Frontend sends a bearer access token.
2. `JwtGuard` verifies signature/expiry and re-reads active user from PostgreSQL.
3. Controller enforces role and delegates to the module service.
4. Prisma executes queries/transactions.
5. Student DTOs omit option answer keys.

## Integrity controls
- Unique `(examId, studentId)` attempt constraint (one attempt by default).
- Unique `(attemptId, questionId)` answer constraint.
- Transactional attempt creation and finalization.
- Server-owned deadline timestamp and timeout check.
- Attempt owner checks on answer/flag/activity endpoints.
- Question and option relations validate submitted IDs.

## Production hardening still required
Implement refresh-token rotation and revocation, email verification delivery and token storage, API rate limiting, faculty exam authoring/evaluation controllers, scheduled timeout worker, CSP and deployment secret management before a public production launch.
