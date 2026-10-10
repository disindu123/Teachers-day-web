# Verification · SCMU official website

Validated on 10 October 2026 using Node 24.19.0. Node 22+ is supported.

- `npm run build`: Firebase Auth/Storage browser bundle built; all five page entrypoints and their imports resolved.
- `npm test`: 29 passing API/service/runtime tests. Coverage includes the role matrix, feedback/privacy, revocation and disabled accounts, URL validation, maintenance, IP blocks, ten-attempt login protection, concurrency, account recovery, last-admin protection, owned uploads and idempotent registration.
- `npm run test:rules`: 7 passing integration scenarios using the demo Firestore and Storage emulators. Direct Firestore access is denied; valid upload permits work; overwrites, wrong roles, owners, MIME/size, missing, consumed and expired permits fail. Actual Firestore transactions and pagination are exercised.
- `npm run test:browser`: 13 passing scenarios with Chromium 153. Desktop (1440 px) and mobile (390 px), slideshow controls, event dialog/notifications, live/board visibility, feedback, grouped albums, lazy images/lightbox, role dashboards, sign-in/logout, file-input publishing, account creation/role editing/delete/cancel, all-role event photo publishing and homepage updates and no hardcoded fallback, moving underline, reduced motion, IP unblock and maintenance/live switches.
- `npm run format:check`: source formatting checked.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at verification time.
- `git diff --check`: no whitespace errors. The deployment entrypoints load in ESM without CommonJS `require(esm)` support.

API/service tests inject doubles. Browser tests replace the Firebase SDK with a **test-only** adapter and run the actual Express routes against an in-memory store; external video/image responses are intercepted. Browser file-upload verification checks UI progress and permit registration, while Storage rules are checked separately against the real local emulator. No bypass, sample login, or test account is enabled in production.

No live Firebase project, credentials or hosting deployment was tested. Before launch, follow the README to verify actual IAM, Auth, Firestore/Storage rules, uploaded photographs and the host’s true client-IP forwarding on staging. Firebase rules deployment is essential; a local passing test does not install rules in the real project.

The previous `.env.example` contained Admin/provider secret values. This revision replaces them with placeholders; revoke/rotate previously exposed credentials, including those in git history.
