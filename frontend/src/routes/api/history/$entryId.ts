import { createApiAuthMiddleware } from "#/lib/auth-server"
import { proxyHistoryRequest, responseFromBackend } from "#/lib/backend.server"
import { createFileRoute } from "@tanstack/react-router"

const historyDeleteMiddleware = createApiAuthMiddleware({
  history: ["delete"],
})

export const Route = createFileRoute("/api/history/$entryId")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        DELETE: {
          middleware: [historyDeleteMiddleware],
          handler: async ({ context, params }) => {
            const response = await proxyHistoryRequest(
              `/history/${params.entryId}`,
              "DELETE",
              context.auth
            )

            return responseFromBackend(response)
          },
        },
      }),
  },
})
