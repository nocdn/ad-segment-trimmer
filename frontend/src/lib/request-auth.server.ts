import { auth } from "./auth.server"
import type { PermissionMap, RequestAuthSession } from "./auth-server"
import { ensureAuthTables, getAuthUserById } from "./db.server"

function buildJsonError(status: number, error: string) {
  return Response.json({ error }, { status })
}

export async function getCookieSession(request: Request): Promise<RequestAuthSession> {
  await ensureAuthTables()

  return auth.api.getSession({
    headers: request.headers,
  })
}

async function validateApiKeyPermissions(key: string, permissions?: PermissionMap) {
  await ensureAuthTables()

  return auth.api.verifyApiKey({
    body: {
      key,
      permissions,
    },
  })
}

export async function resolveRequestAuth(request: Request, permissions?: PermissionMap) {
  const apiKeyValue = request.headers.get("x-api-key")

  if (apiKeyValue) {
    const verification = await validateApiKeyPermissions(apiKeyValue, permissions)

    if (!verification.valid || !verification.key) {
      const errorCode = verification.error?.code ?? "INVALID_API_KEY"
      const status = errorCode === "INSUFFICIENT_API_KEY_PERMISSIONS" ? 403 : 401

      const errorMessage =
        typeof verification.error?.message === "string"
          ? verification.error.message
          : "Unauthorized"

      return buildJsonError(status, errorMessage)
    }

    const user = await getAuthUserById(verification.key.referenceId)

    if (!user) {
      return buildJsonError(401, "Unauthorized")
    }

    return {
      source: "api-key" as const,
      userId: user.id,
      keyId: verification.key.id,
      session: {
        user,
        session: {
          id: verification.key.id,
          token: apiKeyValue,
          userId: user.id,
        },
      },
    }
  }

  const session = await getCookieSession(request)

  if (!session) {
    return buildJsonError(401, "Unauthorized")
  }

  return {
    source: "session" as const,
    session,
    userId: session.user.id,
  }
}
