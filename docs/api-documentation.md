# API Documentation

Swagger/OpenAPI: `http://localhost:4000/api/docs`.

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | API health |
| POST | `/api/auth/register` | Public | Register student/faculty (pending status) |
| POST | `/api/auth/login` | Public | Obtain short-lived access token |
| GET | `/api/auth/admin/stats` | Admin | Database-backed user, registration, verification, and exam statistics |
| GET | `/api/auth/admin/users` | Admin | List users; optional `search`, `role`, and `status` query filters |
| GET | `/api/auth/admin/pending-users` | Admin | List pending registrations (legacy-compatible endpoint) |
| PATCH | `/api/auth/admin/users/:userId/approve` | Admin | Approve registration and faculty verification atomically |
| PATCH | `/api/auth/admin/users/:userId/reject` | Admin | Reject registration and faculty verification atomically |
| PATCH | `/api/auth/admin/users/:userId/activate` | Admin | Approve a pending registration or reactivate a disabled account |
| PATCH | `/api/auth/admin/users/:userId/deactivate` | Admin | Disable an active non-admin account |
| GET | `/api/faculty/dashboard` | Verified faculty | Faculty-specific statistics and owned exams |
| GET | `/api/faculty/exams` | Verified faculty | List owned exams with questions and correct answers |
| POST | `/api/faculty/exams` | Verified faculty | Create a draft with ordered MCQ/descriptive questions |
| PATCH | `/api/faculty/exams/:examId` | Exam owner | Save a draft or edit a not-yet-open published exam with no attempts |
| DELETE | `/api/faculty/exams/:examId` | Exam owner | Delete a draft with no attempts |
| PATCH | `/api/faculty/exams/:examId/publish` | Exam owner | Publish after schedule and question-mark validation |
| PATCH | `/api/faculty/exams/:examId/close` | Exam owner | Close a published exam |
| GET | `/api/faculty/attempts` | Verified faculty | List attempts/submissions only for owned exams; optional `examId` |
| PATCH | `/api/faculty/attempts/:attemptId/evaluate` | Exam owner | Grade every descriptive answer and calculate final score |
| GET | `/api/student/dashboard` | Student | Eligible exams, attempt progress, counts, and published results only |
| GET | `/api/exams` | Student | Eligible published exams |
| GET | `/api/exams/:examId` | Student | Safe exam metadata/instructions |
| POST | `/api/exams/:examId/start` | Student | Start or resume one attempt; body `{ "acknowledge": true }` |
| GET | `/api/attempts/:attemptId` | Attempt owner / authorized role | Resume attempt; answer key excluded |
| POST | `/api/attempts/:attemptId/questions/:questionId/answer` | Student owner | Save `{ "selectedIds": [], "textAnswer": "..." }` |
| POST | `/api/attempts/:attemptId/questions/:questionId/flag` | Student owner | Set `{ "flagged": true }` |
| POST | `/api/attempts/:attemptId/activity` | Student owner | Log visibility/focus event |
| POST | `/api/attempts/:attemptId/submit` | Student owner | Finalize attempt idempotently |
| GET | `/api/results/me` | Student | Published results only |
| POST | `/api/results/:resultId/publish` | Exam-owning faculty/admin | Publish evaluated result |

The admin dashboard is available at `/admin` after administrator sign-in. The faculty workspace is available at `/faculty` after verified faculty sign-in. The student workspace is available at `/student` after student sign-in. Results remain private until the exam owner publishes them. In-progress attempts can be resumed; submitted attempts cannot be reopened. Overdue attempts are auto-submitted by the backend deadline worker and are also finalized when a student next loads their dashboard.

Protected routes require a valid JWT access token. Request DTOs reject unexpected fields. Business errors return structured NestJS HTTP errors. Faculty endpoints additionally enforce active, approved faculty status and examination ownership.
