import { apiKeyClient } from "@better-auth/api-key/client"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [apiKeyClient()],
})
