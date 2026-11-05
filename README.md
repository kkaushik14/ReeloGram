# ReeloGram

Author: Kumar Kaushik
Project date: 23 Jan 2026

An existing Next.js App Router project with credential authentication, MongoDB models, ImageKit uploads, and video saving/feed APIs. The frontend follows the supplied soft monochrome design tokens, with light and dark appearance, video discovery, personal collections, upload progress, playback, sharing, and uploader-only editing and deletion.

## Local setup

Use Node.js 24 LTS (Node 22.18+ is needed for the test runner).

```sh
npm ci
cp env.sample .env.local
```

Set `REELOGRAM_MONGODB_URL` to your MongoDB connection string. Generate a unique `REELOGRAM_NEXTAUTH_SECRET` with `openssl rand -base64 32` and set `REELOGRAM_NEXTAUTH_URL=http://localhost:3000`. Fill in the ImageKit public key, URL endpoint and private key to enable uploads. Keep the private key server-side. Environment files are ignored by Git.

```sh
npm run dev
```

Open http://localhost:3000. Basic authentication pages are available at `/register` and `/login`. Registration requires a reachable MongoDB database. The ImageKit authentication endpoint requires a signed-in session.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The regression tests cover credential validation, upload type/size boundaries, and database connection caching/retry behavior without writing to a real database. A production build fetches the existing Geist fonts from Google.

### End-to-end checks

```sh
npm run test:e2e
npm run test:e2e -- --imagekit
npm run test:e2e -- --configured-db --imagekit
```

The default run starts a disposable MongoDB database and an isolated Next.js server on an available local port. On first use, it downloads MongoDB's test binary. It checks concurrent registration, duplicate email rejection, password hashing, invalid credentials, session creation, logout, upload access control, feed validation, and controlled database outage errors. It leaves the normal development server and frontend unchanged.

`--imagekit` enables real PNG, video, and PDF uploads with the configured ImageKit credentials. It saves two uploaded videos, verifies their MongoDB records, tests duplicate/non-video/missing-file rejection and anonymous feed pagination, then checks uploader-only edits/deletes using a second account. It also verifies ImageKit file removal, shared-thumbnail retention, lock contention, and recovery from an interrupted deletion. `--configured-db` uses `REELOGRAM_MONGODB_URL` instead of the disposable database and removes only this run's test accounts and video records afterward. Outage simulation runs only with the disposable database. These service tests require network access and working credentials in `.env.local`; no credentials are logged or committed.

For manual form checks, add `--hold` to keep the temporary app running. The runner prints its local URL and process ID; send SIGINT to that process to finish cleanup. Generated test build/configuration files are ignored by Git.

## API routes

- `GET/POST /api/auth/[...nextauth]`: NextAuth session and credential endpoints.
- `POST /api/auth/register`: accepts JSON containing `email`, `name`, `dateOfBirth` (YYYY-MM-DD) and `password`; passwords are hashed before storage. Requires at least 8 characters and no more than 72 UTF-8 bytes.
- `GET /api/imagekit-auth`: returns short-lived upload authentication parameters for signed-in users. Responses are not cached.
- `POST /api/videos`: saves metadata for an uploaded video; requires a signed-in session.
- `GET /api/videos?limit=5&cursor=...`: public video feed, newest first, with a default and maximum initial page size of five, then one video per cursor request. Returns `{ videos, nextCursor, total }`; pass `nextCursor` back unchanged for the next page. An empty/end page has `nextCursor: null`. Responses are not cached.
- `PATCH /api/videos/:id`: uploader-only partial edits to title, description and controls.
- `DELETE /api/videos/:id`: uploader-only deletion with ImageKit cleanup.

### Saving an uploaded video

Upload a video and a JPEG, PNG or WebP thumbnail through ImageKit using the authenticated upload parameters. Then POST JSON to `/api/videos` with the same session cookie:

```json
{
  "title": "My video",
  "description": "A description",
  "fileId": "IMAGEKIT_VIDEO_FILE_ID",
  "thumbnailFileId": "IMAGEKIT_IMAGE_FILE_ID",
  "controls": true
}
```

The server verifies both file IDs in the configured ImageKit library, requires public files, checks media types and sizes (100 MB video, 5 MB thumbnail), derives their delivery URLs, and assigns the session user as author. Client-supplied URLs and author IDs are ignored. Titles must contain 1–120 characters and descriptions 1–2000 characters. `controls` is optional and defaults to true. Each uploaded video can be saved once; duplicate saves return 409. Missing files return 404; invalid inputs/media return 400; unauthenticated saves return 401; service failures return 503.

The created record is returned with HTTP 201 and includes `id`, `fileId`, `thumbnailFileId`, `title`, `description`, `videoUrl`, `thumbnailUrl`, `controls`, `transformation`, `uploadedBy`, and timestamps. The existing model's legacy `thumbNailUrl` and `transformatioon` storage fields remain compatible; the API exposes the canonical names above. The frontend uses these APIs directly.

### Editing and deleting videos

Send a signed-in session cookie to `PATCH /api/videos/:id` with any nonempty subset of `title`, `description`, and `controls`. The same text limits as creation apply. For example, `{ "title": "Updated title", "controls": false }`. The updated record is returned with HTTP 200. Ownership, uploaded file IDs, URLs and other fields cannot be edited; unsupported fields return 400. Unauthenticated requests return 401, other users return 403, invalid IDs return 400, and missing videos return 404. Legacy records without an uploader are not claimable through these endpoints.

`DELETE /api/videos/:id` returns 204 after removing the record and its unshared ImageKit files. A shared thumbnail is retained until its last video reference is removed. Deleting by stored file IDs avoids guessing assets from URLs; owned legacy records without tracked IDs return 409 and require a trusted backfill first.

Deletion first marks the record as pending and hides it from the public feed. ImageKit cleanup failures return 503 and preserve that record for an uploader retry of the same DELETE request. Already-missing files count as cleaned up. Edits to pending deletions return 409. Once deletion completes, subsequent requests for the record return 404. MongoDB leases coordinate saves/deletes for shared files across server workers; contention returns 409 so the caller can retry. Leases expire after 90 seconds if a worker stops. Editing and deletion controls are available on the uploader’s video cards.

If Node reports a missing Homebrew dynamic library, use an installed working Node LTS version or repair the Node installation. Ensure that version is first in `PATH`, including for subprocesses.

## Frontend

- `/`: community and credited Pexels feed; server search, source/date filters, oldest/newest sorting, pagination, playback and share links.
- `/reels`: compact vertical video viewer, separate left controls and right details, active-only playback, sound, pause, seeking, sharing and keyboard navigation. Five records load initially; each forward move queues one more record.
- `/my-videos`: the signed-in user’s videos, with edit and delete dialogs.
- `/upload`: choose an MP4 or WebM video and cover, enter a title and description, then publish with progress feedback. Successful uploads are retained for retry if publishing fails.
- `/login` and `/register`: account forms with password visibility and clear errors.
- Appearance preferences are saved in the browser; the initial appearance is light.

`app/design-tokens.css` preserves the supplied token file. Shared styles use its semantic color variables. The optional curated Pexels import adds real licensed clips with creator/source credits; no made-up activity or view counts are displayed.

`GET /api/videos?mine=true` requires a session and filters on its user ID. `GET /api/videos/:id` returns an available video for share links; videos pending deletion are excluded.

## Motion

`app/motion.css` holds the shared motion settings. Headlines reveal once without changing their reserved space; buttons and cards have restrained hover feedback; pending actions use localized spinners and skeletons. Dialogs and notices have brief entrances. The mobile drawer enters from its existing left edge, supports Escape, and returns focus to the menu button.

The resource banner rotates between Pexels, Pixabay, Coverr and Mixkit every seven seconds, pauses on hover/focus or when the page is hidden, and has manual selection and pause controls. Reduced-motion preferences stop the banner and disable automatic Reels playback. Only the current Reel plays; hidden/offscreen players pause. The existing optional cube animation component remains available but is no longer mounted on Discover. No API, upload, or account behavior is driven by animation.


## Curated Pexels collection

`npm run seed:pexels` previews three reviewed clips. `npm run seed:pexels -- --apply` uploads the videos and covers to the configured ImageKit account and saves their records in the configured MongoDB database. It is a manual import, never an application-startup job. A unique source ID makes repeat runs skip existing clips. Files created by a failed import are cleaned up. Credentials stay in local environment files.

The collection manifest is `scripts/pexels-clips.mjs`. Originals and creator names were checked on their Pexels pages. Each record keeps its source URL, creator and [Pexels license](https://www.pexels.com/license/); the app links these credits in Browse, Reels and the player. These editorial imports have no user owner, so they cannot be claimed or modified by an arbitrary signed-in user. Future editorial management must use a trusted server-side workflow. Community uploads keep the existing uploader-only controls.

The resource banner links to the free-video collections on Pexels, Pixabay, Coverr and Mixkit without implying partnerships. The curated collection includes three Pexels clips and one each from Pixabay, Coverr and Mixkit. The Pexels and Pixabay icons come from Simple Icons; Coverr and Mixkit use their official website icons. Pexels' [logo and credit guidance](https://help.pexels.com/hc/en-us/articles/900005851903-How-should-I-give-credit-Can-I-use-your-logo) permits attribution use.

Feed filters: `q` searches titles, descriptions and credited creators (160 characters maximum); `sort=newest|oldest`; `period=any|week|month|year`; `source=all|pexels|pixabay|coverr|mixkit|community`. Pagination cursors belong to the current combination of filters and must not be reused after filters change. `total` counts all matching records, not just the loaded page. Search treats regular-expression characters as literal text.

Login and registration place a looping, muted preview of a real ImageKit video on the left and the form on the right. Mobile screens show only the form and decorative background; the preview component does not fetch or mount a video there. Playback has a pause control, suspends while the page is hidden, and resumes when visible. Password visibility, validation, account creation and callback routing remain functional.


## Featured-source imports

`npm run seed:featured` previews the full collection; `npm run seed:featured -- --apply` uploads the reviewed originals and covers to ImageKit and saves their delivery URLs, file IDs, creator, source page and license in MongoDB. Repeat runs skip existing records. The frontend serves all video and cover files from ImageKit; no downloaded media is placed in `public` or served from disk. A downloaded file used during source review is not a runtime dependency.

The source manifest is `scripts/featured-clips.mjs`. Newly added providers use namespaced source IDs to avoid collisions with one another. Source filters, logos and credit text support Pexels, Pixabay, Coverr and Mixkit. Community filtering excludes editorial imports. These are credited viewing examples inside ReeloGram, with no stock-download marketplace or invented uploader identities. Original license links remain attached to every imported record.

`app/refinements.css` adds a slate dark palette inspired by the layered surfaces in [Radix Colors](https://www.radix-ui.com/colors) while preserving the supplied design-token file and the compact Reels layout. The resource banner plays four dedicated, credited ImageKit clips. These records have `placement: hero` and are excluded from Browse/Reels. Only the current banner video is mounted, with quality chosen by the shared ImageKit playback policy. Rotation and playback can be paused; reduced-motion preferences require manual playback.


`GET /api/showcase` provides the banner-only clips. Authentication previews use one of these clips instead of reusing the public feed. The complete Reels viewer expands into a native modal dialog, bounded inside the viewport, retaining its scrolling feed, left controls, right details and incremental loading. Its X button is the only dismiss control: Escape and backdrop clicks do not dismiss it. The same video elements remain mounted when expanding/collapsing, preserving the selected Reel, playback time, mute and pause settings. A 32×18 canvas samples the active video at most five times per second to create the blurred ambient light, without decoding a second background video. Only the active Reel plays in either presentation.

Light mode uses shared `--color-support` tokens for restrained teal accents on counts, selected views and decorative background details. Purple remains the primary action colour; the expanded viewer supplies its own dark local token values for readable controls and text.

## Adaptive video delivery and feed cleanup

Use `AdaptiveVideo` from `app/components/AdaptiveVideo.tsx` for every video context. `lib/video-playback.ts` is the reusable policy: it selects a quality cap from connection/data-saving settings, hardware hints, display size, crop and source dimensions. Watch/Reels and wide banners can reach 2160p when useful; weak devices and slow networks receive lower caps. HLS adapts within the cap. Browsers without suitable HLS support use bounded, optimized ImageKit MP4 renditions. Processing responses are polled; the player never redirects a slow device to a large unoptimized original. Only the active, visible video is decoded, and hidden/offscreen players release their buffers. One upcoming Reel may request a manifest and one-byte preparation probe; data-saving and slow connections skip that work.

`npm run videos:prepare` previews preparation for banner clips. Add `--apply` to warm the shared delivery profiles in ImageKit; `--feed` selects feed records instead. Upload saves also start preparation after the response. These operations do not serve files from disk.

`npm run videos:archive-imports` previews removal of the exact reviewed editorial feed IDs. `--apply` archives those records. `--all-current --apply` archives the current feed snapshot, including community posts, while retaining all original files, ownership and credits. Banner-only records are excluded. Browse, Reels and share links hide archived records; future uploads default to the feed and appear in both existing layouts. The operation can be reversed by a trusted database operator setting selected records' placement back to `feed`. Seed commands do not republish an already-imported archived record.

## Email-first accounts, recovery and email

Start with an email on `/login` or `/register`. Existing users enter a password; new users add a private date of birth and public name, then create a password. `/forgot-password` and `/reset-password` provide single-use, expiring email recovery. SMTP/Resend adapters, templates and delivery queues are separate from routes and video code. See [the authentication guide](docs/authentication.md) for environment settings, API behavior, retry handling, rate limits, session revocation, handled edge cases and test coverage. Use Node 24 LTS for development and the maintenance scripts.

The shared footer links to Help, Terms of use and Privacy policy and is absent on authentication pages. The sidebar stays fixed without its own scrollbar. Route, feed, Reel, account and upload skeletons reserve the expected space while content is loading. The HLS implementation is loaded only when a browser needs it; account and video notifications run after successful responses.

`npm run test:email` separately tests SMTP rejection/retry, concurrent worker leases, event deduplication and payload expiry against a local TLS inbox and disposable MongoDB. It does not send internet mail.

## Vercel environment variables

All deployment-facing application settings are namespaced with `REELOGRAM_`; use the complete list in [`env.sample`](env.sample). Examples include `REELOGRAM_MONGODB_URL`, `REELOGRAM_PRIVATE_KEY`, `REELOGRAM_EMAIL_PROVIDER` and `REELOGRAM_SMTP_PASSWORD`. The local `.env` and `.env.local` files use the same names. Existing unprefixed application values are ignored.

Set `REELOGRAM_NEXTAUTH_URL` to your actual **HTTPS production address**, such as `https://your-app.vercel.app`, and configure a strong `REELOGRAM_NEXTAUTH_SECRET`. A server-only adapter supplies NextAuth's reserved URL/secret names internally. You do not need to add unprefixed NextAuth variables in Vercel.

The public deployment inputs are `REELOGRAM_NEXT_PUBLIC_PUBLIC_KEY` and `REELOGRAM_NEXT_PUBLIC_URL_ENDPOINT`. `next.config.ts` explicitly maps only these two public ImageKit settings to the browser's `NEXT_PUBLIC_REELOGRAM_*` names. Database, SMTP, authentication and ImageKit private credentials are never included in that mapping. Rebuild/redeploy after changing public values so the browser bundle receives them.

Add the new names to the intended Vercel project/environment and redeploy. If a namespaced key already exists, edit its value rather than creating another entry with the same name and target. Old unprefixed keys can be removed after the renamed configuration is deployed successfully.

## Upload reliability and showcase quality

`lib/uploads/config.ts` holds the browser upload limits, and `lib/uploads/imagekit-upload.ts` implements direct signed ImageKit uploads. A transfer that keeps making progress can run for up to 30 minutes. No progress for 90 seconds, or no service response for two minutes after transferring the file, ends the attempt with a specific retry message. The form retains its selections and any successfully uploaded file IDs for a manual retry. An uncertain network failure is never automatically retried into duplicate uploads. Video bodies do not pass through Vercel's request-size limit.

Hero and login/signup clips use a stable optimized MP4 rendition selected for the device, connection, source and displayed crop. They retain that sharpness across loops rather than switching HLS levels repeatedly. A sustained eight-second stall or explicit data-saving/slow-network setting can reduce quality. Reels and the main viewer continue to use adaptive HLS. Run `npm run videos:prepare -- --apply` to prepare the sharper showcase renditions before release.

## Analytics and cookie preferences

Google Analytics uses measurement ID `G-B6PDWD34WF` only in Vercel's Production environment and only after the visitor chooses **Allow analytics**. No Google tag is loaded before that choice. **Essential only** preserves sign-in and media functionality without analytics. The consent choice expires after 180 days and can be changed through Cookie settings in the footer or Privacy policy. Changes synchronize between open tabs; withdrawal disables future measurement and removes this site's `_ga` cookies.

Page-view events use an allowlist of app routes, fixed page titles, and URLs without query strings or fragments. Authentication, password recovery and unknown routes are excluded. Advertising and Google signals are disabled. Local development and preview deployments do not collect analytics.
