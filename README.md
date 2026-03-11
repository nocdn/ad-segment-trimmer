# ad-segment-trimmer

Self-hosted REST API for removing ad segments from audio files using Fireworks Whisper, OpenAI Responses, FFmpeg, Hono, Bun, and Postgres.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## How it works

1. `POST /process` accepts an uploaded audio file.
2. The API computes a SHA-256 hash of the uploaded file.
3. If that hash already exists in Postgres, the API reuses the saved ad timestamps and skips transcription plus LLM extraction.
4. Otherwise, Fireworks transcribes the file with `whisper-v3-turbo`, including word timestamps.
5. OpenAI extracts ad segments from the transcript.
6. The API matches those phrases back onto transcript timestamps and stores the full transcription plus the exact ad timestamps in Postgres.
7. FFmpeg removes the matching ranges and returns the edited audio as a download.

## Requirements

- Bun 1.3+
- FFmpeg
- Postgres
- `OPENAI_API_KEY`
- `FIREWORKS_API_KEY`

## Local development

Copy the example env file:

```bash
cp .env.example .env
```

Set the required values in `.env`:

- `OPENAI_API_KEY`
- `FIREWORKS_API_KEY`
- `DATABASE_URL`

Install dependencies:

```bash
bun install
```

Run the API in watch mode:

```bash
bun run dev
```

Run the API without hot reload:

```bash
bun run start
```

The API listens on `http://localhost:7070` by default.

Create an API key before calling the API:

```bash
bun run create-api-key "local client"
```

If the API is running in Docker, you can also create a key from inside the container:

```bash
docker compose exec api bun run create-api-key "local client"
```

The command prints a key in this format:

```text
abcd1234_secret
```

The `abcd1234` part is a random public identifier. The full key is only shown once and is stored hashed in the same Postgres database as the rest of the app.

## Docker Compose

The compose file only starts the Bun/Hono API. It does not provision Postgres.

Your `.env` must contain a full external `DATABASE_URL`, and the container will use that exact connection string.

Start the API container:

```bash
docker compose up -d --build
```

If your external database is running on your host machine, `localhost` inside the container will not point to the host. In that case, use a host-reachable address in `DATABASE_URL` such as `host.docker.internal` where appropriate for your setup.

## API

### `GET /health`

Returns a health summary for the service and important dependencies:

```bash
curl http://localhost:7070/health
```

The response includes:

- overall service status
- Postgres connectivity
- FFmpeg availability
- whether `OPENAI_API_KEY` is configured
- whether `FIREWORKS_API_KEY` is configured
- rate limit configuration status

### `POST /process`

Send multipart form data with a file under the `file` field:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" -F "file=@audio.mp3" -OJ http://localhost:7070/process
```

The response is the edited audio file as an attachment, with `[trimmed]` inserted before the extension.

### `GET /history`

Returns processing history as JSON:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:7070/history
```

### `DELETE /history/:id`

Deletes one history row:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" -X DELETE http://localhost:7070/history/1
```

## API key management

API keys are stored in the same Postgres database as `history`, in an `api_keys` table.

You can manage API keys either from your host machine or from inside the running Docker container. In both cases the commands use the same Postgres database configured by `DATABASE_URL`.

Create a key from the host:

```bash
bun run create-api-key "my client"
```

Create a key from the container:

```bash
docker compose exec api bun run create-api-key "my client"
```

List keys from the host:

```bash
bun run list-api-keys
```

List keys from the container:

```bash
docker compose exec api bun run list-api-keys
```

Revoke a key by its public identifier from the host:

```bash
bun run revoke-api-key abcd1234
```

Revoke a key by its public identifier from the container:

```bash
docker compose exec api bun run revoke-api-key abcd1234
```

Rotate a key from the host:

```bash
bun run rotate-api-key abcd1234
```

Rotate a key from the container:

```bash
docker compose exec api bun run rotate-api-key abcd1234
```

## Environment variables

See [`.env.example`](.env.example) for the full list. The main variables are:

- `OPENAI_API_KEY`
- `FIREWORKS_API_KEY`
- `OPENAI_MODEL`
- `REASONING_EFFORT`
- `DATABASE_URL`
- `MAX_REQUEST_BODY_SIZE_MB`
- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_WINDOW_SECONDS`
- `RATE_LIMIT_MAX_REQUESTS`
- `FFMPEG_TIMEOUT_MS`
- `FASTER_FFMPEG_ENABLED`
- `PORT`

## Rate limiting

The API uses a simple per-key in-memory rate limiter.

The limiter runs after API key authentication and counts requests separately for each API key. If a key goes over the limit, the API returns `429 Too Many Requests`.

Configure it in `.env`:

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=1
```

This example means each API key can make up to 1 request per 60-second window.

The limiter is stored in memory inside the running app process. If you restart the app, the counters reset. If you run multiple app containers, each container keeps its own counters.

## Notes

- The app automatically recreates the `history` table if its schema does not match the expected columns.
- The app also automatically recreates the `api_keys` table if its schema does not match the expected columns.
- Cached entries are keyed by a SHA-256 file hash.
- History and cache entries are isolated per API key.
- `/health` is public and returns `200` when the service is healthy or `503` when an important dependency check fails.
- `FASTER_FFMPEG_ENABLED=true` uses a faster FFmpeg stream-copy path, which is less precise at cut boundaries than the fallback precise trim mode (settings the variable to `false` uses filter-based re-encoding)
- No db migration scripts are used.
- `GET /history` is intentionally excluded from request access logs.
- The app avoids logging full Fireworks/OpenAI payloads such as complete transcripts to avoid cluttering logs with huge transcripts.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
