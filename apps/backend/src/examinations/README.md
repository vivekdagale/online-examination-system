# Module 2 — Examination and Auto Submission
Owner: Vivek Ravindra Dagale

Implements eligible exam retrieval, safe question payloads, persistent attempts, instruction acknowledgement, server deadlines, answer save/restore, flagging, activity logs, objective evaluation, timeout/manual finalization, and published-result retrieval.

The verified-faculty workspace uses the same `Exam`, `Question`, `Option`, `ExamAttempt`, `StudentAnswer`, and `Result` records for faculty-owned exam authoring, safe draft deletion, publishing/closing, attempt review, descriptive evaluation, and result publication. Faculty API methods enforce ownership and require an active, approved faculty profile. MCQ marks are calculated on submission and descriptive marks are added during evaluation.

Requires shared `User` model and `JwtGuard` from Module 1. The `req.user.id` identity is verified server-side. Never accept student ID from request payloads.

Run from root: `npm --workspace apps/backend run start:dev`.
Standalone mock auth is not enabled in this build; tests should override the guard with a test provider rather than adding a production bypass.
