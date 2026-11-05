# ReeloGram

Author: Kumar Kaushik
Project date: 23 Jan 2026

An existing Next.js App Router project with credential authentication, MongoDB models, ImageKit uploads, and video saving/feed APIs. The home page remains the original starter page; login and registration use basic forms. Video saving and feed display are not connected to the frontend yet.

## Local setup

Use Node.js 24 LTS (Node 22.18+ is needed for the test runner).

```sh
npm ci
cp env.sample .env.local
```

Set `MONGODB_URL` to your MongoDB connection string. Generate a unique `NEXTAUTH_SECRET` with `openssl rand -base64 32` and set `NEXTAUTH_URL=http://localhost:3000`. Fill in the ImageKit public key, URL endpoint and private key to enable uploads. Keep the private key server-side. Environment files are ignored by Git.

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

`--imagekit` enables real PNG, video, and PDF uploads with the configured ImageKit credentials. It saves two uploaded videos, verifies their MongoDB records, tests duplicate/non-video/missing-file rejection and anonymous feed pagination, then deletes the generated files. `--configured-db` uses `MONGODB_URL` instead of the disposable database and removes only this run's test account and video records afterward. Outage simulation runs only with the disposable database. These service tests require network access and working credentials in `.env.local`; no credentials are logged or committed.

For manual form checks, add `--hold` to keep the temporary app running. The runner prints its local URL and process ID; send SIGINT to that process to finish cleanup. Generated test build/configuration files are ignored by Git.

## API routes

- `GET/POST /api/auth/[...nextauth]`: NextAuth session and credential endpoints.
- `POST /api/auth/register`: accepts JSON containing `email` and `password`; passwords are hashed before storage. Requires at least 8 characters and no more than 72 UTF-8 bytes.
- `GET /api/imagekit-auth`: returns short-lived upload authentication parameters for signed-in users. Responses are not cached.
- `POST /api/videos`: saves metadata for an uploaded video; requires a signed-in session.
- `GET /api/videos?limit=20&cursor=...`: public video feed, newest first, with a default page size of 20 and maximum of 100. Returns `{ videos, nextCursor }`; pass `nextCursor` back unchanged for the next page. An empty/end page has `nextCursor: null`. Responses are not cached.

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

The created record is returned with HTTP 201 and includes `id`, `fileId`, `thumbnailFileId`, `title`, `description`, `videoUrl`, `thumbnailUrl`, `controls`, `transformation`, `uploadedBy`, and timestamps. The existing model's legacy `thumbNailUrl` and `transformatioon` storage fields remain compatible; the API exposes the canonical names above. No update/delete API or automatic frontend publication has been added.

If Node reports a missing Homebrew dynamic library, use an installed working Node LTS version or repair the Node installation. Ensure that version is first in `PATH`, including for subprocesses.
