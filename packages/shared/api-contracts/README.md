# Shared API Contract

- Authentication identity is established by a signed JWT and revalidated against the active `User` record for protected requests.
- `req.user.id` is the sole student identity source for examination endpoints; student IDs in request bodies are never used for authorization.
- All API paths are prefixed `/api`.
- Student endpoints: `GET /exams`, `GET /exams/:examId`, `POST /exams/:examId/start`, `GET /attempts/:attemptId`, `POST /attempts/:attemptId/questions/:questionId/answer`, `POST /attempts/:attemptId/questions/:questionId/flag`, `POST /attempts/:attemptId/activity`, `POST /attempts/:attemptId/submit`, `GET /results/me`.
- Authentication endpoints: `POST /auth/register`, `POST /auth/login`.
- Standard failures use HTTP 400 validation/business errors, 401 unauthenticated, 403 role/account restriction, 404 unavailable resource, and 409 conflicting attempt state.
- Student question responses include option IDs/text only; `isCorrect` is never included in student question queries.
