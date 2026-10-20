# Module 2 — Online Examination and Auto Submission
Owner: Vivek Ravindra Dagale

Source: `apps/backend/src/examinations/` and the examination workflow in `apps/frontend/app/page.tsx`. Supports eligible exam listing, attempt creation/resume, server deadline, answer persistence, flags, activity logs, manual/timeout finalization, objective scoring, and published result retrieval. Requires Module 1's verified identity contract and shared Prisma schema.

Limitations and unverified work are listed in `docs/testing-report.md`. Mock authentication is not enabled in production or in this package; test suites should use a test-only guard override.
