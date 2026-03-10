import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { db } from "./db.server"

const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "local-dev-better-auth-secret-local-dev"
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:6030"

export const auth = betterAuth({
  database: {
    db,
    type: "postgres",
  },
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
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
