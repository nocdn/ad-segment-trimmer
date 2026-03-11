import type { AuthContext } from "./auth-server"

type WindowUnit = "second" | "minute" | "hour" | "day"

type ParsedLimit = {
  maxRequests: number
  windowMs: number
}

type BucketState = {
  count: number
  resetAt: number
}

const RATE_LIMITING_ENABLED = process.env.RATE_LIMITING_ENABLED?.toLowerCase() === "true"

const WINDOW_MS: Record<WindowUnit, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
}

const buckets = new Map<string, BucketState>()

function parseRateLimit(limit: string): ParsedLimit {
  const match = limit.trim().match(/^(\d+)\s+per\s+(second|minute|hour|day)s?$/i)

  if (!match) {
    throw new Error(`Unsupported rate limit format: ${limit}`)
  }

  const maxRequests = Number.parseInt(match[1], 10)
  const windowUnit = match[2].toLowerCase() as WindowUnit

  return {
    maxRequests,
    windowMs: WINDOW_MS[windowUnit],
  }
}

function buildRateLimitKey(namespace: string, auth: AuthContext) {
  if (auth.source === "api-key") {
    return `${namespace}:api-key:${auth.keyId}`
  }

  return `${namespace}:user:${auth.userId}`
}

export function checkRateLimit(namespace: string, auth: AuthContext, limit: string) {
  if (!RATE_LIMITING_ENABLED) {
    return null
  }

  const parsedLimit = parseRateLimit(limit)
  const bucketKey = buildRateLimitKey(namespace, auth)
  const now = Date.now()
  const current = buckets.get(bucketKey)

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + parsedLimit.windowMs,
    })

    return null
  }

  if (current.count >= parsedLimit.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000))

    return Response.json(
      {
        error: "Rate limit exceeded",
      },
      {
        status: 429,
        headers: {
          "retry-after": String(retryAfterSeconds),
        },
      }
    )
  }

  current.count += 1
  buckets.set(bucketKey, current)
  return null
}
