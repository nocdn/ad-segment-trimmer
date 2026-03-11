import { getCurrentSession } from "#/lib/auth-server"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const session = await getCurrentSession()

    throw redirect({
      to: session ? "/dashboard" : "/login",
    })
  },
})
