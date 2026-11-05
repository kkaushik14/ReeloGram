# ReeloGram

Author: Kumar Kaushik
Project date: 23 Jan 2026

An existing Next.js App Router project with credential authentication, MongoDB models, and ImageKit upload support. The home page remains the original starter page; login and registration use basic forms. A video feed and video CRUD API are not implemented yet.

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

## API routes

- `GET/POST /api/auth/[...nextauth]`: NextAuth session and credential endpoints.
- `POST /api/auth/register`: accepts JSON containing `email` and `password`; passwords are hashed before storage. Requires at least 8 characters and no more than 72 UTF-8 bytes.
- `GET /api/imagekit-auth`: returns short-lived upload authentication parameters for signed-in users. Responses are not cached.

If Node reports a missing Homebrew dynamic library, use an installed working Node LTS version or repair the Node installation. Ensure that version is first in `PATH`, including for subprocesses.
