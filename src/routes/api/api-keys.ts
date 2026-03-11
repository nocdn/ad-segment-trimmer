import { auth } from "#/lib/auth.server"
import { getCookieSession } from "#/lib/request-auth.server"
import { ensureAuthTables } from "#/lib/db.server"
import { createFileRoute } from "@tanstack/react-router"

type CreateApiKeyRequest = {
  name?: unknown
  expiresIn?: unknown
  prefix?: unknown
  metadata?: unknown
  permissions?: unknown
  remaining?: unknown
  refillAmount?: unknown
  refillInterval?: unknown
  rateLimitEnabled?: unknown
  rateLimitTimeWindow?: unknown
  rateLimitMax?: unknown
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isPermissionMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => isStringArray(entry))
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOptionalNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === "number"
}

export const Route = createFileRoute("/api/api-keys")({
  server: {
    handlers: ({ createHandlers }) =>
      createHandlers({
        POST: async ({ request }) => {
          await ensureAuthTables()

          const session = await getCookieSession(request)

          if (!session) {
            return Response.json({ error: "Unauthorized" }, { status: 401 })
          }

          let body: CreateApiKeyRequest

          try {
            body = (await request.json()) as CreateApiKeyRequest
          } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 })
          }

          if (typeof body.name !== "string" || !body.name.trim()) {
            return Response.json({ error: "Name is required" }, { status: 400 })
          }

          if (!isOptionalNumber(body.expiresIn)) {
            return Response.json({ error: "expiresIn must be a number or null" }, { status: 400 })
          }

          if (body.prefix !== undefined && typeof body.prefix !== "string") {
            return Response.json({ error: "prefix must be a string" }, { status: 400 })
          }

          if (body.metadata !== undefined && !isPlainObject(body.metadata)) {
            return Response.json({ error: "metadata must be an object" }, { status: 400 })
          }

          if (body.permissions !== undefined && !isPermissionMap(body.permissions)) {
            return Response.json({ error: "permissions must be an object of string arrays" }, { status: 400 })
          }

          if (!isOptionalNumber(body.remaining)) {
            return Response.json({ error: "remaining must be a number or null" }, { status: 400 })
          }

          if (body.refillAmount !== undefined && typeof body.refillAmount !== "number") {
            return Response.json({ error: "refillAmount must be a number" }, { status: 400 })
          }

          if (body.refillInterval !== undefined && typeof body.refillInterval !== "number") {
            return Response.json({ error: "refillInterval must be a number" }, { status: 400 })
          }

          if (
            body.rateLimitEnabled !== undefined &&
            typeof body.rateLimitEnabled !== "boolean"
          ) {
            return Response.json({ error: "rateLimitEnabled must be a boolean" }, { status: 400 })
          }

          if (
            body.rateLimitTimeWindow !== undefined &&
            typeof body.rateLimitTimeWindow !== "number"
          ) {
            return Response.json({ error: "rateLimitTimeWindow must be a number" }, { status: 400 })
          }

          if (body.rateLimitMax !== undefined && typeof body.rateLimitMax !== "number") {
            return Response.json({ error: "rateLimitMax must be a number" }, { status: 400 })
          }

          try {
            const apiKey = await auth.api.createApiKey({
              body: {
                userId: session.user.id,
                name: body.name.trim(),
                expiresIn: body.expiresIn,
                prefix: body.prefix,
                metadata: body.metadata,
                permissions: body.permissions,
                remaining: body.remaining,
                refillAmount: body.refillAmount,
                refillInterval: body.refillInterval,
                rateLimitEnabled: body.rateLimitEnabled,
                rateLimitTimeWindow: body.rateLimitTimeWindow,
                rateLimitMax: body.rateLimitMax,
              },
            })

            return Response.json(apiKey)
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Failed to create API key"

            return Response.json({ error: message }, { status: 400 })
          }
        },
      }),
  },
})
