# ad-segment-trimmer

Self-hosted TanStack Start app for removing ads from audio/video files with Fireworks Whisper, OpenAI, FFmpeg, Better Auth, Drizzle ORM, and Postgres.

## How it works

1. Upload a file to `POST /api/process`.
2. The server transcribes it with Fireworks Whisper (`whisper-v3-turbo`).
3. The transcript is sent to OpenAI to identify ad segments.
4. Matching transcript timestamps are converted into an FFmpeg concat manifest.
5. FFmpeg trims the detected segments and returns the processed file.
6. Processing history and hash-based cache data are stored in Postgres.

## Stack

- TanStack Start + React + Bun
- Better Auth for email/password auth and API keys
- Drizzle ORM for typed Postgres access
- Postgres for auth, history, and processing cache
- FFmpeg inside the app container
- Fireworks AI for transcription
- OpenAI for ad-segment extraction

## Environment

Copy `.env.example` to `.env` and fill in:

- `OPENAI_API_KEY`
- `FIREWORKS_API_KEY`
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS` (optional, comma-separated)

Notes:

- For local dev, `BETTER_AUTH_URL` usually matches `http://localhost:5173`.
- For Docker / production with the included compose file, `BETTER_AUTH_URL` usually matches `http://localhost:3000`.
- Tables are created automatically at runtime. No migrations are required.
- `drizzle.config.ts` is included for schema tooling like Drizzle Studio.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

The app will be available at `http://localhost:3000`.

## Local development

```bash
cp .env.example .env
bun install
bun run dev
```

The dev server will usually be available at `http://localhost:5173`.

## API

Better Auth is mounted at `/api/auth/*`.

Protected endpoints:

- `POST /api/process`
- `GET /api/history`
- `DELETE /api/history/:entryId`

You can authenticate with either:

- a Better Auth session cookie from the login flow, or
- an API key passed as `x-api-key`

Example:

```bash
curl -X POST \
  -H "x-api-key: YOUR_API_KEY" \
  -F "file=@audio.mp3" \
  -OJ http://localhost:3000/api/process
```

## Scripts

```bash
bun run dev
bun run build
bun run db:studio
bun run start
bun run typecheck
```

## License

MIT
