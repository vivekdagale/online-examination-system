# Module 1 — Authentication and User Management
Owner: Friend

Implements Argon2id password hashing, registration (student/faculty only), login, active-account enforcement, faculty approval enforcement, and signed JWT access tokens. Administrator self-registration is prohibited by DTO validation.

This initial foundation does not yet include email verification delivery, refresh-token rotation, logout revocation, admin user-management endpoints, or rate limiting. Those are required before public deployment.
