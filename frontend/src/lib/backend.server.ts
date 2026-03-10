import { existsSync } from "node:fs"
import type { AuthContext } from "./auth-server"

const DOCKER_BACKEND_INTERNAL_URL = "http://backend:7070"
const LOCAL_BACKEND_INTERNAL_URL = "http://localhost:7070"
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "local-internal-secret"

function isRunningInContainer() {
  return existsSync("/.dockerenv")
}

function resolveBackendInternalUrl() {
  const configuredUrl =
    process.env.BACKEND_INTERNAL_URL ??
    (isRunningInContainer() ? DOCKER_BACKEND_INTERNAL_URL : LOCAL_BACKEND_INTERNAL_URL)

  let parsedUrl: URL

  try {
    parsedUrl = new URL(configuredUrl)
  } catch {
    return configuredUrl
  }

  if (isRunningInContainer() || parsedUrl.hostname !== "backend") {
    return configuredUrl
  }

  parsedUrl.hostname = "localhost"
  return parsedUrl.toString()
}

const BACKEND_INTERNAL_URL = resolveBackendInternalUrl()

function createBackendUrl(pathname: string) {
  return new URL(pathname, BACKEND_INTERNAL_URL)
}

function copyResponseHeaders(source: Headers) {
  const headers = new Headers()

  for (const name of ["cache-control", "content-disposition", "content-length", "content-type"]) {
    const value = source.get(name)

    if (value) {
      headers.set(name, value)
    }
  }

  return headers
}

export function responseFromBackend(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: copyResponseHeaders(response.headers),
  })
}

export async function proxyProcessRequest(request: Request, auth: AuthContext) {
  const headers = new Headers()
  const contentType = request.headers.get("content-type")

  if (contentType) {
    headers.set("content-type", contentType)
  }

  headers.set("x-internal-api-secret", INTERNAL_API_SECRET)
  headers.set("x-user-id", auth.userId)

  return fetch(createBackendUrl("/process"), {
    method: "POST",
    headers,
    body: request.body,
    // @ts-expect-error Node/Bun streaming request bodies require duplex.
    duplex: "half",
  })
}

export async function proxyHistoryRequest(
  pathname: string,
  method: "GET" | "DELETE",
  auth: AuthContext
) {
  const headers = new Headers({
    "x-internal-api-secret": INTERNAL_API_SECRET,
    "x-user-id": auth.userId,
  })

  return fetch(createBackendUrl(pathname), {
    method,
    headers,
  })
}
