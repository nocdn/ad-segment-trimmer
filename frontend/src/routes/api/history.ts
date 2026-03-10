import { createApiAuthMiddleware } from "#/lib/auth-server"
import { proxyHistoryRequest, responseFromBackend } from "#/lib/backend.server"
import { createFileRoute } from "@tanstack/react-router"

const historyReadMiddleware = createApiAuthMiddleware({
  history: ["read"],
})

export const Route = createFileRoute("/api/history")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        GET: {
          middleware: [historyReadMiddleware],
          handler: async ({ context }) => {
            const response = await proxyHistoryRequest("/history", "GET", context.auth)
            return responseFromBackend(response)
          },
        },
      }),
  },
})
