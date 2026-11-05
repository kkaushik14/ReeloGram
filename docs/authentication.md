# Accounts and transactional email

The application uses NextAuth credentials, MongoDB account records and a separate transactional email service. SMTP is configured locally. No email credentials belong in client code or Git.

## Module boundaries

- `lib/auth/validation.ts`: shared email, profile, password and reset-token input rules.
- `lib/auth/request.ts`: bounded JSON parsing, origin checks and safe HTTP errors.
- `lib/auth/rate-limit.ts`: atomic MongoDB counters shared by server workers.
- `lib/auth-opt.ts`: password verification, session creation and session revocation.
- `lib/email/transport.ts`: the provider-independent `sendEmail` interface and SMTP/Resend adapters.
- `lib/email/templates.ts`: escaped HTML and plain-text account, password and video messages.
- `lib/email/outbox.ts`: deduplicated, leased delivery of account and posting notices.
- `models/EmailJob.ts`: the durable email queue. Reset-link messages are sent directly and are never put in this collection.

## SMTP configuration

Set these in `.env.local` on the server:

```dotenv
REELOGRAM_EMAIL_PROVIDER=smtp
REELOGRAM_SMTP_HOST=smtp.example.com
REELOGRAM_SMTP_PORT=587
REELOGRAM_SMTP_USER=your-mailbox@example.com
REELOGRAM_SMTP_PASSWORD=your-provider-app-password
REELOGRAM_EMAIL_FROM="ReeloGram <your-mailbox@example.com>"
# Optional:
REELOGRAM_EMAIL_REPLY_TO=your-support-address@example.com
# Set to 1 for implicit TLS on a custom port. Port 465 uses it automatically.
REELOGRAM_SMTP_SECURE=0
```

Port 587 requires STARTTLS. Port 465 uses implicit TLS. Certificate verification remains enabled. The provider may require an application password rather than the normal account password.

`REELOGRAM_APP_URL`, or otherwise `REELOGRAM_NEXTAUTH_URL`, determines links in messages. Use HTTPS in a public environment; HTTP is accepted only for local development. Links are never constructed from a visitor-supplied Host header. Change the local URL to the actual public origin before deployment.

The optional Resend adapter uses `REELOGRAM_EMAIL_PROVIDER=resend`, `REELOGRAM_RESEND_API_KEY` and the same `REELOGRAM_EMAIL_FROM`. It does not change calling code.

Account-created, posted-video and password-changed messages are queued after the main action succeeds. A mail outage does not undo a successful account or video save. Delivery has a one-minute lease, stable event keys, five bounded attempts and exponential retry delays. Sent payloads are removed; deduplication metadata and unprocessed messages expire after seven days. Run `npm run email:retry` from a scheduled server job to process due retries. SMTP has no universal idempotency guarantee; stable Message-IDs help downstream deduplication but cannot guarantee exactly-once delivery after an ambiguous network timeout.

Password-reset messages contain short-lived credentials, so they bypass the durable outbox. A failed send removes only that request's token; it cannot clear a newer token created in the meantime. The user can request another link within the rate limits. Neither tokens nor SMTP responses are logged.

## Account flow

Both `/login` and `/register` begin with an email. `POST /api/auth/identify` returns the next step. Existing accounts enter a password; new users enter a name and date of birth, then create and confirm a password. No account is stored until the final valid submission. Duplicate creation races return a sign-in prompt. After registration, a 60-second, single-use sign-in grant is exchanged through NextAuth to create the normal protected session cookie. Only the digest is stored; grants never enter URLs or browser storage. Failed exchanges leave the successful account creation intact and offer ordinary sign-in.

Date of birth remains private. It is not returned in sessions, public uploader records or video feeds. Legacy accounts without a date of birth still sign in. Their public name falls back to the existing email handle when a separate name is unavailable. Profile pictures are shown when available; otherwise the UI uses initials.

The email-first routing intentionally reveals whether an email has an account, as required by the product flow. It is rate-limited. Password recovery itself uses the same response and asynchronous work schedule for known and unknown addresses.

## Password recovery and session protection

- `POST /api/auth/forgot-password`: accepts an email and sends a reset link if an account exists.
- `POST /api/auth/reset-password`: accepts a token and a new password.
- Tokens use 32 cryptographically random bytes. MongoDB stores only the SHA-256 digest and a 20-minute expiry on the account.
- New requests replace older tokens. Tokens are consumed in the same atomic write that changes the password and increments the session version. Concurrent submissions can succeed only once.
- Expired, malformed, missing, used or replaced tokens receive controlled errors. Reusing the current password is rejected without consuming the valid token.
- Password changes invalidate previous sessions. Protected APIs resolve the current account/version through NextAuth; a missing user or revoked version cannot authorize uploads, edits or deletes.
- Reset links use a fragment, which is removed from the address bar after the page reads it. The page has `no-referrer` and `noindex` metadata. Reset tokens are not sent in a URL query or request log.
- A successful reset issues a new 60-second, single-use sign-in grant. The browser exchanges it through NextAuth for a fresh session after previous sessions have been invalidated. Grants are bound to the email/account and atomically consumed. Reset completion never reuses the old session or puts a bearer token in localStorage. If an exchange fails or expires, the user can sign in with the new password.

## Input and abuse controls

New passwords require at least eight characters and at most 72 UTF-8 bytes, matching bcrypt's limit. Passwords are not trimmed. All-space passwords are rejected. Names are trimmed, whitespace is normalized, and control characters are rejected. Dates must be real calendar dates, no later than today, and no more than 120 calendar years ago.

Email addresses are canonicalized and restricted to a single conventional address. Recipient lists, control characters, homoglyph separators, objects and MongoDB operator payloads are rejected. Public JSON account requests are limited to 8 KiB and checked against supplied browser origins. NextAuth supplies its own CSRF/session-cookie protections for sign-in and sign-out. Public mutations extract allowed scalar fields; raw request objects are never used as database filters or update operators. This application uses MongoDB, not SQL; it does not concatenate SQL or MongoDB queries. Email templates escape user-provided names and video titles.

MongoDB fixed-window counters limit email identification, registration, login, recovery and reset attempts. Keys are HMAC hashes; raw emails and network addresses are not stored in the counter collection. Counters use atomic updates and automatic expiry. Requests fail closed if the counter database is unavailable. Login throttling returns an ordinary authentication failure with a wait message; JSON endpoints return 429 and Retry-After.

Forwarded network addresses are ignored by default to prevent a client from bypassing limits by spoofing headers. The fallback is a shared network bucket plus per-account limits. Set `REELOGRAM_AUTH_TRUST_PROXY=1` only behind a proxy that overwrites untrusted `X-Forwarded-For` headers. Do not enable it for a server directly reachable by arbitrary clients.

Video authorization remains uploader-only and server-enforced. Client-supplied uploader IDs and delivery URLs are ignored. ImageKit file IDs, media type, size and visibility are verified before saving. Public owner metadata omits email and date of birth.

The mobile header contains only the brand and menu button. Account identity and sign-out are inside the mobile drawer; desktop account controls remain in the header. Authentication pages remain form-focused on mobile with no footer.

## Validation

`npm test` covers malformed/injected inputs, calendar dates, Unicode password byte limits, email escaping, provider headers/errors, video quality policy and URL restrictions. `npm run test:e2e -- --imagekit` uses a disposable database, a real local TLS SMTP sink, and temporary ImageKit uploads. It verifies account creation, SMTP messages, duplicate/race behavior, login errors, media ownership, token expiry/replacement/reuse, concurrent reset consumption, session invalidation, rate limits and outage handling. `--configured-db` repeats the service checks against Atlas and removes only test-owned records/files. The SMTP test sink never sends internet mail. The configured SMTP service was separately verified with TLS authentication and an accepted delivery-check message to its own mailbox.

Browser checks cover desktop/mobile account steps, wrong-password recovery navigation, form feedback, upload/publish, uploader initials, the footer and policy pages, the fixed sidebar, ImageKit playback and the expanded Reel viewer. Credentials and downloaded test fixtures are not committed.
