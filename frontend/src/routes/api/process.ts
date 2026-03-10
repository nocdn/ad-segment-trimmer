import { createApiAuthMiddleware } from "#/lib/auth-server"
import { proxyProcessRequest, responseFromBackend } from "#/lib/backend.server"
import { createFileRoute } from "@tanstack/react-router"

const processMiddleware = createApiAuthMiddleware({
  audio: ["process"],
})

export const Route = createFileRoute("/api/process")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        POST: {
          middleware: [processMiddleware],
          handler: async ({ context, request }) => {
            const response = await proxyProcessRequest(request, context.auth)
            return responseFromBackend(response)
          },
        },
      }),
  },
})
