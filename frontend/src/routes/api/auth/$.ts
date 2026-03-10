import { auth } from "#/lib/auth.server"
import { ensureAuthTables } from "#/lib/db.server"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureAuthTables()
        return auth.handler(request)
      },
      POST: async ({ request }) => {
        await ensureAuthTables()
        return auth.handler(request)
      },
    },
  },
})
