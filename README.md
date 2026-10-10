# සඟබෝ පැහැසර · Sanghabodhi College Media Unit

The official SCMU website built on the original Teacher’s Day white, gold and deep-blue design. Node.js/Express serves HTML, CSS, vanilla JavaScript and the API; Firebase Authentication verifies staff credentials, Firestore stores content, and Firebase Storage holds uploaded photographs.

## Included

- Home: decorative Sinhala gold heading, six illustrative starter slides, autoplay, arrows, dots, pause, swipe, keyboard controls and reduced-motion support; introduction, highlights, gallery preview and the special event **ගුරු අභිවන්දනා 2k26** at **8:00 a.m. Sri Lanka time**.
- Gallery: paginated, lazy-loaded photographs, keyboard/swipe lightbox and albums grouped by their exact Facebook album URL. Each linked album has “View more on Facebook”.
- Contact: configurable official social channels, YouTube, `sangabopahasara@gmail.com`, and a private feedback form with **Name and Message only**.
- Head board: President, Secretary, V.President, V.Secretary and Treasurer, with optional photograph and WhatsApp/Facebook/LinkedIn/email SVG links. Empty positions stay hidden.
- Events: once-per-browser pop-up for the latest new event and a persistent, paginated notification list. Optional images.
- Live: a viewer appears only when an Admin publishes an exact YouTube or public Facebook video URL. Includes a direct platform link if embedding is unavailable.
- Staff workspace: accounts, feedback, photographs, slider ordering, events, live status, board, maintenance and IP blocks, subject to roles below.

## Roles

| Capability                                                  | Admin | Teacher | Student |
| ----------------------------------------------------------- | ----- | ------- | ------- |
| Add gallery photographs or image URLs                       | Yes   | Yes     | Yes     |
| View gallery uploader and time                              | Yes   | Yes     | No      |
| Add slider photographs or URLs                              | Yes   | Yes     | No      |
| View private feedback                                       | Yes   | Yes     | No      |
| Delete feedback or photographs; edit captions/order/albums  | Yes   | No      | No      |
| Create/edit/delete/disable accounts; change roles/passwords | Yes   | No      | No      |
| Manage board, events, live, maintenance and IP blocks       | Yes   | No      | No      |

**Specification assumption:** Teachers can read feedback as requested in the role description. `GET /api/messages` permits Admin and Teacher; deletion is Admin-only. Students can add gallery images but cannot change the homepage slider. Roles are lowercase in Firestore. “Gmail login” means an SCMU Firebase Email/Password account using a Gmail address, with a separate SCMU password; the site does not request a Google account password.

## 1. Create Firebase services

1. Open [Firebase Console](https://console.firebase.google.com/) and create/select your project. Register a **Web app** in Project settings and copy its configuration.
2. Create **Cloud Firestore**, using the **default database** in production mode. Select a region close to Sri Lanka, such as `asia-south1`. The application creates collections when you add content.
3. Enable **Storage**, record the exact bucket name, and set a billing budget. Cloud Storage for Firebase requires the Blaze plan under Firebase’s current billing policy; see the [official Storage billing FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
4. Under **Authentication → Sign-in method**, enable **Email/Password** (not email-link login). Add your production domain and `localhost` to Authorized domains if needed. Enable email enumeration protection and a password policy with a minimum of 12 characters for new accounts.
5. Create your first staff Email/Password user in Authentication → Users. Use a unique SCMU password. A Gmail address is supported; its Google password should be different.
6. For a local or non-Google host, obtain a service account key through Project settings → Service accounts. Keep it outside the repository or in the host’s encrypted secret manager. On Firebase Functions use the runtime service account instead of a downloaded key.
7. Give the backend service account access to Firebase Authentication, Firestore and the configured Storage bucket. Custom-token signing on a Google-managed runtime may additionally require `iam.serviceAccounts.signBlob` / Service Account Token Creator on the signing service account. Follow the [custom-token setup guide](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

Install Node **22 or newer** and dependencies:

```sh
npm ci
cp .env.example .env
```

Fill `.env` with your project’s actual client configuration, bucket name and **one** Admin credential option. Generate the rate-limit secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `PUBLIC_SITE_URL` to the actual origin, without a trailing path. Keep `TRUST_PROXY=0` for a directly exposed Node server. Only use `TRUST_PROXY=1` behind a known single proxy which overwrites forwarded headers; see deployment notes. Browser Firebase configuration is public by design; Admin keys and `RATE_LIMIT_SALT` never leave the server.

The server uses Firebase’s Email/Password REST endpoint before establishing the browser Firebase session. If restricting the web API key, allow Identity Toolkit and Secure Token APIs and account for requests from the backend: browser-only HTTP-referrer restrictions would reject server login. Do not restrict the key to unrelated APIs.

Deploy rules using the supplied CLI (after login/project selection):

```sh
npx firebase login
npx firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,firestore:indexes,storage
```

Accept Firebase’s request to enable **Storage rules access to Firestore**. The rules read `users` and `_uploads` from the default database. Direct client Firestore access is denied; all content and feedback go through Express. Storage rules allow only an authorised account’s permitted, exact-path upload; public photographs are displayed through Firebase download-token URLs.

Bootstrap the first Admin, then start:

```sh
npm run admin -- --email your-admin@gmail.com
npm start
```

Visit `http://localhost:3000` and `/login/index.html`. The bootstrap script also adopts an existing Firebase account or repairs a disabled/incomplete account profile:

```sh
npm run admin -- --email existing-user@gmail.com --role teacher
```

It is a trusted operator tool, not a public endpoint. The dashboard prevents self-lockout and removal/demotion/disablement of the last active administrator. New accounts are created in Firebase Auth **and** Firestore; passwords are never stored in Firestore or logs. Existing accounts with the original `admin: true` claim are adopted on first verified access.

## 2. Add official content

1. Sign in as Admin. Add the five board positions, authorised photos and optional contacts.
2. Add gallery photos by **file or HTTPS URL**, with an optional caption, album title and exact Facebook album link. Uploads accept JPEG/PNG/WebP/GIF up to 10 MB. SVG files are deliberately excluded.
3. Add **5–7 homepage slides**, with order numbers. The supplied local education photos are clearly marked as illustrative until replaced; they are not representations of real SCMU events. Optional `npm run seed:slider` copies the six illustrative photos into your Storage bucket and Firestore only if the slider is empty.
4. Fill `SOCIAL_FACEBOOK`, `SOCIAL_TIKTOK` and `SOCIAL_INSTAGRAM` in the host environment. Unknown links are disabled, rather than guessed. The supplied YouTube channel is already set. Confirm `SCHOOL_WEBSITE` and replace the existing landscape `public/assets/scmu-logo.svg` with the approved logo or set `LOGO_URL`.
5. Publish event notices and live broadcasts only when ready. A new event ID is shown once on that browser; cleared local storage or another device can show it again. The Teacher’s Day section date is configurable through `EVENT_DATE`; the default is `2026-10-06T08:00:00+05:30`, and displayed timestamps use `Asia/Colombo`.

Photos provided by URL remain on their original host; file uploads use Firebase Storage. Deleting a URL-based post does not delete the original external file. Each published upload keeps its owned `storagePath`; only owned uploads can be removed. Existing Cloudinary URLs remain usable as external URLs, but this version has no Cloudinary dependency or credentials.

## 3. Deployment

### Vercel

Import this GitHub repository into Vercel. Use Node **22.x**, and keep the supplied `vercel.json` legacy Node build/routing configuration; the framework preset can be **Other**. The `postinstall` script bundles the Firebase browser SDK. Add `.env.example` values through Vercel’s environment settings, use `NODE_ENV=production`, the deployment’s `PUBLIC_SITE_URL`, and a trusted proxy hop count appropriate to your deployment (normally `TRUST_PROXY=1` for a single Vercel edge proxy). Store Admin JSON/private key as an encrypted server environment variable.

**All routes go to `api/index.js`, which exports Express.** Do not publish `public/` as an independent static output or add filesystem routes before the catch-all: those would bypass HTML maintenance and login-IP checks. Upload bytes travel directly to Firebase Storage, avoiding Vercel’s function payload limits. With preview deployments, set the preview’s origin separately or list exact approved preview origins in `ALLOWED_ORIGINS`.

After deploying, test `/api/health`, `/login/index.html`, feedback, a file upload and maintenance mode. Health reports configuration presence, not a full Firebase connectivity check.

### Heroku / Render / Railway / other Node host

Set the same server environment variables. Build with `npm ci` (or `npm ci --omit=dev`) and run `npm start`. The existing `Procfile` declares `web: npm start`; the server listens on the host’s `PORT`. Use the platform’s HTTPS endpoint/custom domain and trust only its documented proxy hops. Prevent direct untrusted access around that proxy. No uploaded files or application data are kept on local disk, so instances may be ephemeral.

### Firebase Hosting + Cloud Functions

Use the existing `firebase.json` and `firebase.functions.js`. The `web` function is a second-generation Node 22 function in `asia-south1`, using Application Default Credentials.

1. Select your Firebase project: `npx firebase use YOUR_PROJECT_ID`.
2. Put **non-secret** web configuration, `FB_STORAGE_BUCKET`, `FB_USE_ADC=true`, `NODE_ENV=production`, `PUBLIC_SITE_URL` and the tested proxy-hop count in the Functions environment for that project (for example `.env.YOUR_PROJECT_ID` locally; it is ignored by git).
3. Keep `RATE_LIMIT_SALT` in Secret Manager, using `npx firebase functions:secrets:set RATE_LIMIT_SALT`. It is declared on the function. No downloaded Admin key is needed on Firebase. Confirm the runtime account permissions described above.
4. Deploy: `npx firebase deploy --only firestore,storage,functions,hosting`.

Hosting points at the intentionally empty `hosting/` directory and rewrites **every request** to `web`. Keep it that way: copying HTML into the Hosting static directory would bypass server checks. Function deployment ignores local `.env*`; Firebase CLI loads supported project-specific non-secret values into the deployed function environment. Measure the actual proxy chain for your Hosting/Functions setup and verify that two devices report different correct client IPs in the dashboard before enabling IP blocking. Never set trust proxy to `true` or accept forwarded IPs from arbitrary direct clients.

Firebase can require billing for Functions and Storage. Deployment is not performed automatically by this codebase.

## Security and operations

- Staff API calls verify Firebase ID tokens **with revocation checks**, then load the current Firestore role. Disabling/demoting an account takes effect without waiting for old custom claims to expire. Storage rules also read the current profile.
- Ten server-verified invalid credentials within a 15-minute attempt window block that IP’s staff access until an Admin unblocks it. Successful authorised login resets the window. Provider outages do not count as wrong passwords; concurrent guesses are serialised with a Firestore lease. Manual blocks support IPv4 and IPv6 and cannot block the caller’s current address.
- Blocks cover this site’s staff HTML and protected APIs. They do not block the public website and do not firewall Google’s public Firebase Auth endpoints. Network-level policies and the correctly configured trusted proxy remain the host’s responsibility. Shared school networks share an IP; unblock legitimate staff through another authorised network or Firebase Console if necessary.
- Feedback has a persistent Firestore limit of 5 submissions per IP per 15 minutes. A process-local API burst limit complements it. Configure any host-level rate limits to suit traffic.
- Maintenance serves public HTML with HTTP 503 and blocks unauthenticated public content/submissions; staff login and authenticated dashboard API calls remain usable. An already open page may need refreshing; turning maintenance off restores normal requests.
- User content is inserted with `textContent`, HTTPS URLs are validated, and CSP forbids inline scripts. Embeds are limited to YouTube and Facebook. Origin checks protect browser writes. Credentials and environment files are not served.
- Files require a server-issued 30-minute permit tied to role, account, collection, path, MIME and size. The backend checks Storage metadata and the binary image signature before registering content. Published upload registration is idempotent. Abandoned uploads are cleaned separately.
- A partly failed Auth/Firestore account update leaves the account disabled; retry from the dashboard or repair it with the bootstrap script. Concurrent account changes and last-admin protection use Firestore transactions.
- Run `npm run cleanup:uploads` to **preview** orphaned files older than 24 hours, then `npm run cleanup:uploads -- --apply` to remove them. Run during low traffic. Configure Firestore TTL on `_uploads.expiresAt`, `_rateLimits.expiresAt`, and `_loginAttempts.windowUntil` to reclaim transient documents; TTL must not be applied to `blockedIPs`.
- Back up Firestore, keep dependencies patched, review staff access, and use only photographs/contact details approved for publication. `docs/assets.md` records font/image licences.
- If real Admin or provider secrets were previously committed, rotate/revoke them in their provider console; replacing `.env.example` does not erase git history.

## Firestore data

All timestamps are Firestore `Timestamp` values; the API serialises them to ISO strings. No client can write these collections directly.

| Collection / document         | Fields                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `messages/{id}`               | `name`, `message`, `createdAt`                                                                                                  |
| `gallery/{id}`                | `imageUrl`, `caption`, `postedBy` (UID), `createdAt`; optional `albumTitle`, `facebookAlbumUrl`, `postedByEmail`, `storagePath` |
| `slider/{id}`                 | `imageUrl`, `order`; additional `caption`, `postedBy`, `postedByEmail`, `createdAt`, `storagePath`                              |
| `users/{uid}`                 | `email`, `role`, `createdAt`; additional `displayName`, `disabled`, internal `operationId`                                      |
| `popups/{id}`                 | `title`, `message`, `imageUrl`, `createdAt`; optional `storagePath`                                                             |
| `live/current`                | `platform`, `url`, `isLive`; derived `embedUrl`                                                                                 |
| `settings/site`               | `maintenanceMode`                                                                                                               |
| `blockedIPs/{sha256(ip)}`     | canonical `ip`, `reason`, `blockedAt`                                                                                           |
| `mediaHeads/{position-slug}`  | `role`, `name`, `whatsapp`, `facebook`, `linkedin`, `gmail`, `photoUrl`; optional `storagePath`, `createdAt`                    |
| `_uploads/{ticket}`           | upload owner, collection, path, content type/size, expiry, consumption and published document reference                         |
| `_loginAttempts/{sha256(ip)}` | failure count, window, nonce and lease                                                                                          |
| `_rateLimits/{HMAC}`          | private feedback quota and expiry                                                                                               |
| `_system/accounts`            | serialised account-mutation lease                                                                                               |

The supplied Firestore indexes use the automatic single-field indexes. Paginated collections are sorted by timestamp and document ID; gallery/feedback/accounts/events/IP lists use opaque cursors. Older manually created documents without `createdAt` should be backfilled before listing.

## API

Send JSON for writes. Staff requests need `Authorization: Bearer <Firebase ID token>`. Errors use `{ "error": { "code": "...", "message": "..." } }`. Collections return `{ items, nextCursor }` (slider/board have no cursor). Use `?limit=24&cursor=...`; limits are 1–100. Upload registration takes **either** `ticketId` from the upload flow **or** an HTTPS image URL.

| Method / route                                                  | Access / action                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/config`, `GET /api/health`                            | Public safe configuration and presence status                                                  |
| `GET /api/auth/status`                                          | Checks the requesting IP block                                                                 |
| `POST /api/auth/login`                                          | Server verifies `{email,password}`, counts failures, returns short-lived Firebase custom token |
| `GET /api/admin/me`, `GET /api/admin/stats`                     | Any active staff; stats filtered by role                                                       |
| `POST /api/messages`                                            | Public `{name,message}`; private, rate-limited feedback                                        |
| `GET /api/messages`, `DELETE /api/messages/:id`                 | Admin/Teacher read; Admin delete                                                               |
| `GET /api/gallery`, `POST /api/gallery`                         | Public read; any staff adds `{ticketId OR imageUrl, caption?, albumTitle?, facebookAlbumUrl?}` |
| `PATCH /api/gallery/:id`, `DELETE /api/gallery/:id`             | Admin edits caption/album metadata or removes                                                  |
| `GET /api/slider`, `POST /api/slider`                           | Public read; Admin/Teacher adds `{ticketId OR imageUrl, order, caption?}`                      |
| `PATCH /api/slider/:id`, `DELETE /api/slider/:id`               | Admin changes caption/order or removes                                                         |
| `POST /api/uploads/ticket`                                      | Role-appropriate staff requests `{collection, contentType, size}` before SDK Storage upload    |
| `GET/POST /api/accounts`                                        | Admin lists/creates `{email,password,displayName?,role}`                                       |
| `PATCH/DELETE /api/accounts/:uid`                               | Admin edits email/name/password/role/disabled or deletes                                       |
| `GET/POST /api/popups`                                          | Public read; Admin creates `{title,message,ticketId OR imageUrl?}`                             |
| `PATCH/DELETE /api/popups/:id`                                  | Admin edits text or deletes event                                                              |
| `GET/PUT /api/live`                                             | Public read; Admin sets `{platform,url,isLive}`                                                |
| `GET/PUT /api/settings`                                         | Public maintenance status; Admin sets `{maintenanceMode}`                                      |
| `GET/POST /api/blocked-ips`, `DELETE /api/blocked-ips/:ip`      | Admin list/block `{ip,reason}`/unblock (URL-encode IPv6)                                       |
| `GET /api/media-heads`, `PUT/DELETE /api/media-heads/:position` | Public read; Admin sets/removes fixed board positions                                          |

Public/Student gallery JSON omits uploader, email and posted timestamp. Admin/Teacher dashboard requests retrieve them. Public photo URLs and board contacts are intentionally public.

## Source and checks

```text
server.js, api/index.js, firebase.functions.js    Node host entry points
lib/                                             API, config, validation, Firebase services
public/                                          Home/Gallery/Contact, styles, fonts, assets
public/login/index.html                          Firebase staff sign-in
public/admin/index.html                          Role-filtered dashboard
client/firebase.js                               Locally bundled browser SDK
scripts/                                         Build, bootstrap, starter slides, cleanup
firestore.rules, storage.rules, firebase.json     Firebase security and deployment
vercel.json, Procfile                            Other host deployment
.env.example                                    Placeholder-only configuration
```

```sh
npm run build
npm test
npm run format:check
npm run test:rules
npx playwright install chromium
npm run test:browser
```

API/unit tests inject test-only services and cover role restrictions, privacy, validation, account changes, upload ownership, maintenance and IP blocking. Rules tests run against the **demo-scmu** Firestore/Storage emulators and test both allowed and denied requests plus real Firestore transactions. The bundled Firebase CLI 14 requires a compatible JDK (JDK 17 works for these emulators). Browser tests use an injected Firebase SDK fixture solely in test code and cover mobile/desktop UI and role dashboards. Tests never log into a real project or publish live content.

Before a public launch, verify actual credentials, Storage/Firestore IAM/rules, Firebase Auth and the host’s forwarded IP behavior on a staging deployment. The source is deployment-ready, but no live Firebase project is configured by these files.
