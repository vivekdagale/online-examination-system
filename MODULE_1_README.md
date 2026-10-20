# Module 1 — Authentication and User Management
Owner: Friend

Source: `apps/backend/src/auth/` plus shared User/Profile schema and root integration files. Uses Argon2id password hashing, pending account registration, JWT login, and account/role checks. Requires the shared Prisma schema and database. See `docs/setup-guide.md` and `docs/integration-guide.md`.

Limitations: email verification delivery, refresh-token rotation/revocation, rate limiting, and admin CRUD/approval endpoints need completion before production use.
