# Verification notes

- `npm test`: 23 checks passed.
- `npm run build`: Firebase browser bundle builds successfully.
- `npm run format:check`: source formatting passed.
- `npm audit --omit=dev`: 0 known vulnerabilities at delivery.
- Node application and Firebase Functions entrypoints import successfully.
- Public browser checks passed at 1440 px desktop and 390 px mobile widths: six slides, arrows, navigation, lazy gallery/lightbox, two-field feedback success/error handling, and login configuration state.
- Dashboard browser checks passed using a test Auth adapter and API fixtures: inert markup rendering, delete/cancel, signed Cloudinary upload requests, photo selection/upload progress/registration, retry without duplicate upload, slider upload and URL modes, order editing, responsive layout, and logout. No JavaScript exceptions were observed.

The Node verification runtime was Node 24; deployment supports Node 22 or later. Tests use injected Firebase doubles and intercepted Cloudinary HTTP fixtures; no live Firebase credentials or Cloudinary API secret were supplied. Run the README launch smoke check against your own Firebase project before official publication.

The vulnerable `uuid` dependency under `gaxios` is overridden with version 11.1.1. Its CommonJS `v4` API, used by gaxios, was checked; the dependency audit is clean.
