# TanStack Start Frontend

## Commands

```bash
bun install
bun run dev
bun run build
bun run start
```

## Environment

The frontend expects these server-side environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BACKEND_INTERNAL_URL`
- `INTERNAL_API_SECRET`

When you run the frontend locally from the `frontend/` directory, the scripts automatically load
the repo root `../.env` and then `frontend/.env` as an override layer. The intended local workflow
is to keep shared variables in the root `.env` and only add `frontend/.env` when you need a
frontend-only override.

If the frontend is running on your host while the backend is running outside the frontend
container, the default Docker URL (`http://backend:7070`) is automatically rewritten to
`http://localhost:7070`. You only need a local override when you want to point at a different
backend URL, for example:

```bash
BACKEND_INTERNAL_URL="http://localhost:7070"
BETTER_AUTH_URL="http://localhost:6030"
```
