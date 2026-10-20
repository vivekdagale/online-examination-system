# Integration Guide

1. Agree on the `User.id`, `User.role`, `User.status` contract and JWT claims (`sub`, `role`, `email`).
2. Module 1 validates identity and account status. Module 2 receives the backend-verified user via `JwtGuard`; it never trusts a client-provided student ID.
3. Keep the shared Prisma schema in the repository root. Generate Prisma Client after schema changes.
4. Use feature branches: `feature/auth-user-management` and `feature/examination-autosubmit`.
5. Before merge: run Prisma migration, backend tests, frontend build, and inspect the API contract.
6. Module 2 standalone mock identity is intentionally not enabled by default. For automated tests, use a test-only guard override; never set mock auth in production. `ALLOW_MOCK_AUTH` is reserved and must not be used as a production bypass.
