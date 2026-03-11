import { createApiAuthMiddleware } from "#/lib/auth-server"
import {
  createProcessedAudioResponse,
  processUploadedAudio,
} from "#/lib/processing.server"
import { checkRateLimit } from "#/lib/rate-limit.server"
import { createFileRoute } from "@tanstack/react-router"

const processMiddleware = createApiAuthMiddleware({
  audio: ["process"],
})

const PROCESS_RATE_LIMIT = process.env.RATE_LIMIT ?? "10000 per day"

export const Route = createFileRoute("/api/process")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        POST: {
          middleware: [processMiddleware],
          handler: async ({ context, request }) => {
            const rateLimited = checkRateLimit("process", context.auth, PROCESS_RATE_LIMIT)

            if (rateLimited) {
              return rateLimited
            }

            const formData = await request.formData()
            const file = formData.get("file")

            if (!(file instanceof File)) {
              return Response.json({ error: "No file provided" }, { status: 400 })
            }

            if (!file.name) {
              return Response.json({ error: "No selected file" }, { status: 400 })
            }

            try {
              const result = await processUploadedAudio({
                file,
                userId: context.auth.userId,
              })

              return createProcessedAudioResponse(result)
            } catch (error) {
              return Response.json(
                {
                  error: error instanceof Error ? error.message : "Failed to process audio",
                },
                { status: 500 }
              )
            }
          },
        },
      }),
  },
})
