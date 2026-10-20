# Module Ownership

## Module 1 — Authentication and User Management (Friend)
Owns `apps/backend/src/auth/**`, identity-related Prisma models (`User`, `StudentProfile`, `FacultyProfile`, `RefreshToken`), account lifecycle, and authentication UI under `apps/frontend/app` login/registration flow.

## Module 2 — Examination and Auto Submission (Vivek Ravindra Dagale)
Owns `apps/backend/src/examinations/**`, `Exam`, `ExamEligibility`, `Question`, `Option`, `ExamAttempt`, `StudentAnswer`, `Result`, `ExamActivityLog`, `ExamSession`, and student examination UI in `apps/frontend/app/page.tsx`.

## Shared integration files
- `prisma/schema.prisma`
- `apps/backend/src/common/**`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/auth/jwt.guard.ts` interface
- `packages/shared/api-contracts/**`
- root package scripts and environment example

Coordinate changes to shared files in a pull request before merging. Do not create a second user table or a second authentication system. Contributors must commit using their own Git identities; do not rewrite authorship.
