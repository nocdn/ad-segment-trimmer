import { createMiddleware, createServerFn } from "@tanstack/react-start"

export type PermissionMap = Record<string, string[]>

export type RequestAuthSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name: string
    image?: string | null
  }
  session: {
    id: string
    token: string
    userId: string
  }
} | null

type ApiRouteUser = {
  id: string
  email: string
  emailVerified: boolean
  name: string
  image: string | null
}

export type AuthContext =
  | {
      source: "session"
      session: NonNullable<RequestAuthSession>
      userId: string
    }
  | {
      source: "api-key"
      session: {
        user: ApiRouteUser
        session: {
          id: string
          token: string
          userId: string
        }
      }
      userId: string
      keyId: string
    }

export function sanitizeRedirectTarget(target: unknown) {
  if (typeof target !== "string") {
    return "/dashboard"
  }

  if (!target.startsWith("/")) {
    return "/dashboard"
  }

  if (target.startsWith("//")) {
    return "/dashboard"
  }

  return target
}

export const getCurrentSession = createServerFn({ method: "GET" })
  .handler(async () => {
    const [{ getRequest }, { getCookieSession }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("./request-auth.server"),
    ])

    return getCookieSession(getRequest())
  })

export function createApiAuthMiddleware(permissions?: PermissionMap) {
  return createMiddleware().server(async ({ next, request }) => {
    const { resolveRequestAuth } = await import("./request-auth.server")
    const authResult = await resolveRequestAuth(request, permissions)

    if (authResult instanceof Response) {
      return authResult
    }

    return next({
      context: {
        auth: authResult,
      },
    })
  })
}
