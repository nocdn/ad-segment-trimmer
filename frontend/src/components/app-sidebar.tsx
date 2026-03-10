"use client"

import {
  Github,
  KeyRound,
  SquareTerminal,
  Users,
} from "lucide-react"
import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { Sidebar, SidebarContent, SidebarFooter } from "@/components/ui/sidebar"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "History",
          url: "#",
        },
        {
          title: "Starred",
          url: "#",
        },
        {
          title: "Settings",
          url: "#",
        },
      ],
    },
    {
      title: "API Keys",
      url: "#",
      icon: KeyRound,
    },
    {
      title: "Users",
      url: "#",
      icon: Users,
    },
  ],
  navSecondary: [
    {
      title: "Source",
      url: "https://github.com/nocdn/ad-segment-trimmer",
      icon: Github,
    },
  ],
}

type SidebarUser = {
  name: string
  email: string
  avatar: string
}

export function AppSidebar({
  user = data.user,
  onLogOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user?: SidebarUser
  onLogOut?: () => void | Promise<void>
}) {
  return (
    <Sidebar collapsible="none" variant="inset" className="bg-sidebar" {...props}>
      <SidebarContent className="overflow-hidden">
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogOut={onLogOut} />
      </SidebarFooter>
    </Sidebar>
  )
}
