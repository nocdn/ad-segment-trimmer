import { createApiAuthMiddleware } from "#/lib/auth-server"
import { getHistoryForUser } from "#/lib/db.server"
import { checkRateLimit } from "#/lib/rate-limit.server"
import { createFileRoute } from "@tanstack/react-router"

const historyReadMiddleware = createApiAuthMiddleware({
  history: ["read"],
})

const HISTORY_RATE_LIMIT = process.env.HISTORY_RATE_LIMIT ?? "500000 per day"

export const Route = createFileRoute("/api/history")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        GET: {
          middleware: [historyReadMiddleware],
          handler: async ({ context }) => {
            const rateLimited = checkRateLimit("history", context.auth, HISTORY_RATE_LIMIT)

            if (rateLimited) {
              return rateLimited
            }

            const history = await getHistoryForUser(context.auth.userId)
            return Response.json(history)
          },
        },
      }),
  },
})
