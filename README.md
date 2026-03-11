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

## Docker Compose

The compose file only starts the Bun/Hono API. It does not provision Postgres.

Your `.env` must contain a full external `DATABASE_URL`, and the container will use that exact connection string.

Start the API container:

```bash
docker compose up -d --build
```

If your external database is running on your host machine, `localhost` inside the container will not point to the host. In that case, use a host-reachable address in `DATABASE_URL` such as `host.docker.internal` where appropriate for your setup.

## API

### `POST /process`

Send multipart form data with a file under the `file` field:

```bash
curl -F "file=@audio.mp3" -OJ http://localhost:7070/process
```

The response is the edited audio file as an attachment, with `[trimmed]` inserted before the extension.

### `GET /history`

Returns processing history as JSON:

```bash
curl http://localhost:7070/history
```

### `DELETE /history/:id`

Deletes one history row:

```bash
curl -X DELETE http://localhost:7070/history/1
```

## Environment variables

See [`.env.example`](.env.example) for the full list. The main variables are:

- `OPENAI_API_KEY`
- `FIREWORKS_API_KEY`
- `OPENAI_MODEL`
- `REASONING_EFFORT`
- `DATABASE_URL`
- `MAX_REQUEST_BODY_SIZE_MB`
- `FFMPEG_TIMEOUT_MS`
- `FASTER_FFMPEG_ENABLED`
- `PORT`

## Notes

- The app automatically recreates the `history` table if its schema does not match the expected columns.
- Cached entries are keyed by a SHA-256 file hash.
- `FASTER_FFMPEG_ENABLED=true` uses a faster FFmpeg stream-copy plus concat-demuxer path, which is less precise at cut boundaries than the fallback precise trim mode.
- No migration scripts are used.
- `GET /history` is intentionally excluded from request access logs.
- The app avoids logging full Fireworks/OpenAI payloads such as complete transcripts.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
