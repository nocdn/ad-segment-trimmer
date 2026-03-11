import { getCurrentSession } from "#/lib/auth-server"
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const session = await getCurrentSession()

    if (!session) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      })
    }

    return {
      session,
    }
  },
  component: Outlet,
})
