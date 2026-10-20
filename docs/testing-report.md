# Testing Report

## Execution status
This deliverable was generated as source code. Dependencies were not installed and no database, browser, migration, production build, or automated test suite was executed in the generation environment. The cases below are planned verification cases, not claims of passing execution.

| Test ID | Requirement | Preconditions | Steps | Expected result | Actual result | Status |
|---|---|---|---|---|---|---|
| OES-01 | Registration | API/database running | Register student with valid data | User is created PENDING; no token issued | Not run | NOT RUN |
| OES-02 | Authentication | Seeded active student | Login with correct password | Access token returned | Not run | NOT RUN |
| OES-03 | Eligibility | Active student and published exam | GET `/api/exams` | Only published eligible exams shown; answer keys absent | Not run | NOT RUN |
| OES-04 | One attempt | Published open exam | Start same exam twice | First creates attempt; second rejects/resumes only if active | Not run | NOT RUN |
| OES-05 | Autosave | Active attempt | Save answer then reload attempt | Saved answer restored | Not run | NOT RUN |
| OES-06 | Timeout | Attempt deadline expired | Retrieve/submit attempt after deadline | Server finalizes as TIMEOUT | Not run | NOT RUN |
| OES-07 | Intentional negative case | Active student token | Submit option ID belonging to another question | API returns 400; no invalid answer saved | Not run; negative test planned | NOT RUN |
| OES-08 | Intentional negative case | Submitted attempt | Try to edit answer | API returns conflict; stored answer remains unchanged | Not run; negative test planned | NOT RUN |

## Known limitations
- Faculty examination creation/editing, descriptive evaluation, administrator user management, email verification delivery, logout/revocation, refresh-token rotation, scheduled timeout worker, and full end-to-end suite are not yet implemented.
- Timer UI displays a local countdown derived from a server-issued deadline; server endpoints remain authoritative. The client should refresh attempt state when it reaches zero.
- Production-grade optimistic concurrency currently increments a version but does not require a client version precondition.
- The initial Prisma migration must be created by the developer using `npm run db:migrate`; generated migration files are environment-dependent.
