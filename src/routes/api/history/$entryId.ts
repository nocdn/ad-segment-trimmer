import { createApiAuthMiddleware } from "#/lib/auth-server"
import { deleteHistoryEntry } from "#/lib/db.server"
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
            const entryId = Number.parseInt(params.entryId, 10)

            if (!Number.isFinite(entryId)) {
              return Response.json({ error: "Invalid history entry id" }, { status: 400 })
            }

            const deleted = await deleteHistoryEntry(entryId, context.auth.userId)

            if (!deleted) {
              return Response.json({ error: "Entry not found" }, { status: 404 })
            }

            return Response.json({ message: "Entry deleted" })
          },
        },
      }),
  },
})
