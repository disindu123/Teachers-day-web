# ගුරු අභිවන්දනා 2k26

Teacher's Day celebration website for **Sri Sanghabodhi National College, Nittambuwa**, presented by **SCMU — Media Unit of Sanghabodhi College**.

**Stack:** Node.js/Express, Firebase Admin SDK, Firestore, Firebase Storage, Firebase Email/Password Authentication, HTML, CSS, and vanilla JavaScript.

## Features

- Responsive white, gold, and deep blue design with self-hosted Google Fonts; Poppins/Montserrat English type and Abhaya Libre/Noto Sans Sinhala type.
- Six bundled slider images, autoplay, arrows, dots, pause, touch/keyboard navigation, and reduced-motion support.
- Home, gallery, contact, login, dashboard, and a 404 page.
- Paginated gallery, lazy loading, and an accessible lightbox.
- Feedback with exactly **Name** and **Message**, validation and success/error states.
- Admin Email/Password login at **`/login/index.html`**, dashboard at **`/admin/index.html`**.
- Private feedback viewing/deletion; gallery upload/deletion; slider uploads, HTTPS URLs, deletion, and ordering.
- Firebase ID token verification with revocation checks **and an `admin: true` custom claim** on every admin API.
- Direct-to-Storage uploads, image signature/type/size validation, upload progress, retryable registration, origin checks, CSP, and transaction-backed feedback rate limits.
- Firebase Hosting/Cloud Functions and Vercel configuration, a Heroku Procfile, and automated security/API tests.

## Assumptions and launch status

1. The title is exactly **“ගුරු අභිවන්දනා 2k26”**. No reference artwork was attached, so the gold font/gradient treatment is an interpretation rather than an exact artwork reproduction.
2. No official SCMU logo or event photos were supplied. `public/assets/scmu-logo.svg` is a replaceable landscape wordmark. Starter photos are **labelled illustrative education images**, not photographs of this school's celebration. See [asset notes](docs/assets.md).
3. No event date/time or social handles were confirmed. `EVENT_DATE` is optional. Facebook/TikTok/Instagram controls remain disabled until official URLs are configured. The school website defaults to `https://srisanghabodhi.lk/`.
4. Feedback is private to SCMU admins. Admin accounts are created by a trusted project owner; no public registration or built-in password is included.
5. The frontend renders as a **design preview without credentials**. Unconfigured writes return `503`; no feedback is silently accepted or saved locally.
6. The complete application is provided. Firebase provisioning, credentials, billing, hosting, and the live smoke check require your own project/account.

## 1. Requirements

- **Node.js 22 or later**, npm, and a Firebase project you control.
- Firebase's **Blaze pay-as-you-go plan** for Storage. This is a current requirement for existing and new default buckets. Configure a billing budget/alert. [Official Storage requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

## 2. Create the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project**. Analytics is optional.
2. **Project settings → General → Add Web app**. Copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`, and `messagingSenderId`.
3. **Build → Firestore Database**: create the **default database**, Standard edition/native mode, in production mode and a suitable region. Collections are created automatically when the server first writes.
4. **Build → Storage**: create the default bucket and copy its **exact name**, including `.firebasestorage.app` or `.appspot.com`. Do not add `gs://`.
5. **Authentication → Sign-in method**: enable **Email/Password**. Email-link/passwordless sign-in can remain disabled.
6. **Authentication → Users**: add your administrator's Gmail address and a dedicated Firebase password.
7. **Authentication → Settings → Authorized domains**: add `localhost` for development and your hosting/custom hostnames.
8. **Project settings → Service accounts**: generate a private key for local development/an external Node host. Keep the JSON outside `public/` and out of Git.
9. The runtime identity needs Firestore and Storage access and Firebase Auth user-read permission for revocation checks. The trusted role-assignment script additionally needs Firebase Authentication admin permission. Cloud Functions can use its attached service account.

## 3. Local setup

```bash
git clone https://github.com/disindu123/Teachers-day-web.git
cd Teachers-day-web
npm ci
cp .env.example .env
```

On Windows, copy `.env.example` to `.env` in File Explorer or use `copy .env.example .env`.

Edit `.env`. The `FB_` prefix is intentional: Cloud Functions reserves variables beginning with `FIREBASE_`.

| Variable                                                                              | Value                                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `FB_PROJECT_ID`                                                                       | Firebase project ID                                                              |
| `FB_STORAGE_BUCKET`                                                                   | Exact Storage bucket name                                                        |
| `FB_CLIENT_EMAIL`, `FB_PRIVATE_KEY`                                                   | Service-account values; **server only**                                          |
| `FB_SERVICE_ACCOUNT_JSON`                                                             | Alternative: complete compact service-account JSON in one server secret          |
| `GOOGLE_APPLICATION_CREDENTIALS`                                                      | Alternative: absolute path to a local service-account JSON                       |
| `FB_USE_ADC`                                                                          | `true` for an attached Google Cloud service account                              |
| `FB_WEB_API_KEY`, `FB_WEB_AUTH_DOMAIN`, `FB_WEB_APP_ID`, `FB_WEB_MESSAGING_SENDER_ID` | Public Web app config                                                            |
| `RATE_LIMIT_SALT`                                                                     | Random server-only secret, identical across instances                            |
| `PUBLIC_SITE_URL`                                                                     | Canonical origin, e.g. `http://localhost:3000`; omit to infer the request origin |
| `TRUST_PROXY`                                                                         | `0` locally; `1` behind a trusted single-hop host ingress                        |
| `SOCIAL_FACEBOOK`, `SOCIAL_TIKTOK`, `SOCIAL_INSTAGRAM`                                | Confirmed official HTTPS profiles                                                |
| `SCHOOL_WEBSITE`                                                                      | Official school website                                                          |
| `EVENT_DATE`                                                                          | Optional ISO date/time with `+05:30`                                             |

Use **one** Admin credential method. For individual key fields, quote `FB_PRIVATE_KEY` and preserve newlines as `\n`, as in `.env.example`.

Generate a random rate-limit salt and paste it into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Grant your existing Firebase user's admin role:

```bash
npm run admin -- --email your-admin@gmail.com
```

This preserves other custom claims and revokes old sessions. Sign out and sign in again after a role change. To remove access:

```bash
npm run admin -- --email your-admin@gmail.com --remove
```

Start the site:

```bash
npm start
```

Open **http://localhost:3000** and **http://localhost:3000/login/index.html**.

`npm ci` builds the Firebase browser bundle automatically. Use `npm run build` after changing `client/firebase.js`; `npm run dev` watches the server.

## 4. Deploy the security rules

Install the [Firebase CLI](https://firebase.google.com/docs/cli), sign in, associate your project, and deploy:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,storage
```

- **Firestore rules deny browser access.** Express mediates all reads/writes with its Admin SDK, keeping feedback private and enforcing validation.
- **Storage permits public photo reads and admin-only uploads/deletions** in `gallery/{uid}/{file}` and `slider/{uid}/{file}`. Creation requires the admin's own UID, an accepted image MIME type, and a maximum 10 MB. Objects are immutable.
- Express checks upload ownership, bucket metadata, size, MIME type, and initial image bytes before registration.
- Only the requested gallery/slider fields are stored. Deletion derives the uploaded object path from its Firebase download URL and removes the binary before metadata.
- Optionally enable **Firestore TTL on `_rateLimits.expiresAt`** to clean expired limiter records. The application already respects their expiry.

## 5. Branding and content

- Replace `public/assets/scmu-logo.svg` or update the `<img>` paths. Its layout uses `max-height: 50px; width: auto`.
- Set confirmed official social URLs and an optional confirmed `EVENT_DATE`.
- Use the dashboard **Gallery** tab to upload approved photographs and optional captions.
- Use **Image slider** to upload photos or paste publicly accessible HTTPS image URLs. Lower order numbers appear first. Delete unwanted slides with the trash control.
- The homepage falls back to six illustrative bundled slides when Firestore's slider is empty. Optionally run **`npm run seed:slider`** once against an empty slider to copy those images into Firebase Storage/Firestore. Replace them with event photography when ready.
- An unconfigured gallery shows a labelled illustrative preview. A configured empty gallery shows a genuine empty album state.

Files upload **directly from the authenticated browser to Firebase Storage**, followed by a small JSON registration request to Express. This avoids Node host/serverless body-size limits. If registration fails after an upload, the dashboard retains its path for a safe retry.

## 6. API

Writes use `Content-Type: application/json`. Admin endpoints require `Authorization: Bearer <Firebase ID token>` and the `admin: true` claim.

| Endpoint                                | Access | Request / response                                    |
| --------------------------------------- | ------ | ----------------------------------------------------- |
| `GET /api/config`                       | Public | Allowlisted public config; no Admin secrets           |
| `GET /api/health`                       | Public | Process status and Web config readiness               |
| `POST /api/messages`                    | Public | `{ name, message }`; `201` after commit               |
| `GET /api/messages?limit=30&cursor=...` | Admin  | `{ items, nextCursor }`, newest first                 |
| `DELETE /api/messages/:id`              | Admin  | `204` after deletion                                  |
| `GET /api/gallery?limit=24&cursor=...`  | Public | `{ items, nextCursor }`, newest first                 |
| `POST /api/gallery`                     | Admin  | `{ storagePath, caption? }`                           |
| `DELETE /api/gallery/:id`               | Admin  | Deletes binary and metadata                           |
| `GET /api/slider`                       | Public | `{ items }` by order/document ID                      |
| `POST /api/slider`                      | Admin  | `{ storagePath, order }` **or** `{ imageUrl, order }` |
| `PATCH /api/slider/:id`                 | Admin  | `{ order }`; `204`                                    |
| `DELETE /api/slider/:id`                | Admin  | Deletes metadata and uploaded binary                  |
| `GET /api/admin/me`                     | Admin  | Verified UID/email                                    |
| `GET /api/admin/stats`                  | Admin  | Firestore aggregation counts                          |

**Limits:** Name 2–80 characters; Message 3–2,000; Caption 0–300; order integer 0–9,999; pagination 1–100 items. API timestamps are ISO strings; database timestamps are Firestore Timestamps. Submitted text is rendered with `textContent`.

Public feedback is limited to **5 messages/client IP/15 minutes**, transactionally shared across instances. A separate process-local API burst guard allows 60 requests/minute. Configure your ingress before trusting forwarded IPs; use your hosting firewall for broader traffic controls.

Errors: `{ error: { code, message, requestId } }`. Unknown errors are logged with request IDs; stack traces are never returned.

### Firestore schemas

| Collection    | Fields                                                        |
| ------------- | ------------------------------------------------------------- |
| `messages`    | `name: string`, `message: string`, `createdAt: timestamp`     |
| `gallery`     | `imageUrl: string`, `caption: string`, `createdAt: timestamp` |
| `slider`      | `imageUrl: string`, `order: number`                           |
| `_rateLimits` | Internal `count: number`, `expiresAt: timestamp`              |

## 7. Deployment

### Any Node host, Heroku, or Render

1. Connect this repository to your host. Select **Node 22 or later**.
2. Install/build with `npm ci`; start with `npm start`. The app binds the provider's `PORT` on all interfaces. A Heroku `Procfile` is included.
3. Set `NODE_ENV=production`, Firebase Admin/Web settings, a random `RATE_LIMIT_SALT`, and public/social values using the host's environment manager. `FB_SERVICE_ACCOUNT_JSON` is convenient when multiline key handling is awkward.
4. Set `PUBLIC_SITE_URL` to the HTTPS origin. Use `TRUST_PROXY=1` only behind the host's trusted ingress.
5. Add the hostname to Firebase Auth, deploy the Firebase rules, and run the smoke check below.

Persistence is entirely in Firebase; no writable deployment disk is needed.

### Vercel

Vercel detects root **`server.js`**, which exports the Express app. `public/` is served by its CDN. `vercel.json` adds static security headers.

1. Import `disindu123/Teachers-day-web` into Vercel. Select its Express preset and Node 22 or later.
2. Use `npm ci` for install and `npm run build` for build if prompted; retain standard `public/` static handling.
3. Add all environment values. Set `PUBLIC_SITE_URL` per deployment environment, or leave it blank to check the current origin on preview deployments.
4. Set `TRUST_PROXY=1`, add the production/custom hostname to Firebase Auth, and deploy.
5. Run the smoke check. Uploads still go directly to Firebase Storage; the API only receives JSON.

[Official Express on Vercel guide](https://vercel.com/docs/frameworks/backend/express).

### Firebase Hosting + Cloud Functions (2nd gen)

`firebase.functions.js` exports function **`web`**, region **`asia-south1`**, runtime **Node 22**. Hosting serves static assets; API/clean page routes reach Express through the rewrite.

1. Use a clean deployment checkout, without the Node `.env` that contains reserved `PORT`. Keep private-key files out of the deployment.
2. Create **`.env.YOUR_PROJECT_ID`** with these nonsecret settings:

```dotenv
FB_USE_ADC=true
FB_PROJECT_ID=YOUR_PROJECT_ID
FB_STORAGE_BUCKET=YOUR_EXACT_BUCKET
FB_WEB_API_KEY=YOUR_WEB_API_KEY
FB_WEB_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
FB_WEB_APP_ID=YOUR_WEB_APP_ID
FB_WEB_MESSAGING_SENDER_ID=YOUR_SENDER_ID
PUBLIC_SITE_URL=https://YOUR_PROJECT_ID.web.app
TRUST_PROXY=1
SOCIAL_FACEBOOK=
SOCIAL_TIKTOK=
SOCIAL_INSTAGRAM=
SCHOOL_WEBSITE=https://srisanghabodhi.lk/
```

3. Create the rate-limit Secret Manager secret and paste your random value when prompted:

```bash
firebase functions:secrets:set RATE_LIMIT_SALT
```

4. Ensure the runtime service account has Firestore/Storage access and Firebase Auth user-read permission. It uses Application Default Credentials, so no private Admin key is needed in the deployed function.
5. Deploy:

```bash
npm ci
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore,storage,functions,hosting
```

6. Add the hostname to Firebase Auth and run the smoke check. Keep the canonical `web.app` origin consistent with `PUBLIC_SITE_URL`.

The function is capped at 10 instances. Tune resources for expected traffic. Functions and Storage require an enabled billing account.

[Hosting/Functions guide](https://firebase.google.com/docs/hosting/functions) · [Environment/secrets guide](https://firebase.google.com/docs/functions/config-env).

## 8. Verification and launch smoke check

```bash
npm test
npm run build
npm audit --omit=dev
```

Automated tests exercise actual HTTP routes with **injected test doubles**. They cover auth/role/revocation checks, Unicode/markup handling, validation, upload ownership, unsafe URLs, order editing/deletion, and Storage signatures. They do not contact your live Firebase project.

After configuring Firebase:

1. Submit feedback; confirm success and the document in `messages`.
2. Sign in as the assigned admin; view its Sri Lanka timestamp and delete it.
3. Upload a gallery photo; check Storage, Firestore, public grid, and lightbox. Delete it and verify both locations.
4. Add uploaded and URL slider images, reorder them, check the homepage, and remove them.
5. Log out; verify `401` on admin APIs. An ordinary authenticated user must receive `403`.
6. Check narrow screens, keyboard navigation, and the live browser console.

### Troubleshooting

| Symptom                            | Fix                                                                  |
| ---------------------------------- | -------------------------------------------------------------------- |
| Login is being configured          | Fill Web config/project/bucket settings, then restart/redeploy       |
| `ADMIN_REQUIRED`                   | Grant admin claim, then sign out/in                                  |
| `FIREBASE_NOT_CONFIGURED`          | Check credentials, project/bucket, and random salt                   |
| Storage unauthorized               | Deploy rules, refresh admin session, check bucket name               |
| Firestore/Storage permission error | Check runtime service-account IAM roles/project                      |
| `ORIGIN_DENIED`                    | Match `PUBLIC_SITE_URL` to the browser origin, including scheme/port |
| Social link unavailable            | Set its confirmed official HTTPS URL                                 |
| Uploaded but not published         | Submit the same form again to register the retained upload path      |
| Functions rejects env names        | Use the Firebase env example; remove reserved names                  |

## Source map

| Location                                              | Purpose                                                 |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `server.js`                                           | Node entrypoint / Express export                        |
| `lib/app.js`                                          | API, authentication, security, static serving           |
| `lib/firebase.js`, `lib/store.js`                     | Admin SDK, database, uploads                            |
| `lib/config.js`, `lib/validation.js`, `lib/errors.js` | Config/validation/error handling                        |
| `public/index.html`, `gallery.html`, `contact.html`   | Public pages                                            |
| `public/login/index.html`, `public/admin/index.html`  | Admin pages                                             |
| `public/css/styles.css`, `public/js/`                 | Styles and vanilla JS                                   |
| `client/firebase.js`                                  | Modular browser SDK source                              |
| `scripts/`                                            | Build, trusted admin assignment, optional image seeding |
| `tests/`                                              | HTTP/security and upload tests                          |
| `firebase.json`, `firebase.functions.js`, `*.rules`   | Firebase deployment/access                              |
| `vercel.json`, `Procfile`                             | Other host configuration                                |

Original MIT license retained. Third-party images and Firebase SDK retain their respective licences. Official SCMU branding/event photography should be supplied by their owners.
