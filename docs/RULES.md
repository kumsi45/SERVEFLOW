# SERVEFLOW Rules

1. Stop after each phase and wait for user approval.
2. Do not build features unless explicitly approved by the user.
3. When application code is approved, keep a single entry point at `src/main.tsx`.
4. Keep all routing centralized in `src/app/router`.
5. Keep business logic in `src/core`.
6. Keep feature modules locked until their phase is approved.
7. Do not modify previous phases unless the user explicitly asks.

## Current Phase

Active phase: Phase 3.

Allowed:

- Ordering system implementation.
- Customer cart and checkout UI.
- Authenticated customer order RPCs.
- Ordering documentation.

Blocked:

- Kitchen dashboard implementation.
- Admin implementation.
- Super admin implementation.
- Changes to approved Phase 2 QR menu functionality unless explicitly requested.
