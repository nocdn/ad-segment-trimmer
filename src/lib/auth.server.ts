import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { db } from "./db.server"
import { schema } from "./db/schema"

const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "local-dev-better-auth-secret-local-dev"
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:5173"

function getTrustedOrigins() {
  const trustedOrigins = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ])

  try {
    trustedOrigins.add(new URL(BETTER_AUTH_URL).origin)
  } catch {
    // Ignore invalid local fallback values and let Better Auth handle baseURL validation.
  }

  for (const origin of process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []) {
    const normalizedOrigin = origin.trim()

    if (normalizedOrigin) {
      trustedOrigins.add(normalizedOrigin)
    }
  }

  return [...trustedOrigins]
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    camelCase: true,
    transaction: true,
  }),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    apiKey({
      apiKeyHeaders: "x-api-key",
      enableMetadata: true,
      enableSessionForAPIKeys: true,
      requireName: true,
      defaultPrefix: "ast",
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60 * 60 * 24,
        maxRequests: 1000,
      },
    }),
    tanstackStartCookies(),
  ],
})
