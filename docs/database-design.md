# Database Design

`prisma/schema.prisma` is the canonical schema.

- User: identity, role, status, password hash.
- StudentProfile / FacultyProfile: role-specific attributes and approval.
- Exam: schedule, duration, marks, publication and creator.
- ExamEligibility: optional explicit allow-list; when no eligibility rows exist, the exam is available to all active students.
- Question / Option: question content, marks, options, and internal correct-answer key.
- ExamAttempt: unique per exam/student, deadline, state, submission reason, session metadata.
- StudentAnswer: unique per attempt/question, response, flag, version, evaluation fields.
- Result: objective/descriptive totals and publication status.
- ExamActivityLog: focus/visibility and attempt audit signals.
- ExamSession: one active server-side session record per attempt.
- Announcement, AuditLog, RefreshToken: integration foundations.

Historical attempts restrict deletion of exams/users to avoid destroying results. Option keys are only selected in server-side evaluation queries and excluded from student response selects.
