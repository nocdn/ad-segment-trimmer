import { authClient } from "#/lib/auth-client"
import { getCurrentSession } from "#/lib/auth-server"
import type { ApiKey } from "@better-auth/api-key/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ChevronDown, Loader, Plus, Settings, Trash2, X } from "lucide-react"
import type { FormEvent } from "react"
import { useEffect, useState } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

const DEFAULT_DOWNLOAD_FILENAME = "processed_audio.mp3"

type HistoryEntry = {
  id: number
  filename: string
  created_at: string
  ad_segments_found: number
}

type KeyPermissions = {
  audioProcess: boolean
  historyRead: boolean
  historyDelete: boolean
}

type ApiKeyPermissionMode = "all" | "restricted" | "read-only"
type ApiKeyOwnerType = "you" | "service-account"

const ALL_KEY_PERMISSIONS: KeyPermissions = {
  audioProcess: true,
  historyRead: true,
  historyDelete: true,
}

const RESTRICTED_DEFAULT_KEY_PERMISSIONS: KeyPermissions = {
  audioProcess: true,
  historyRead: true,
  historyDelete: false,
}

const READ_ONLY_KEY_PERMISSIONS: KeyPermissions = {
  audioProcess: false,
  historyRead: true,
  historyDelete: false,
}

const DEFAULT_KEY_PERMISSIONS = ALL_KEY_PERMISSIONS
const DEFAULT_PROJECT_ID = "default-project"

const API_KEY_PERMISSION_OPTIONS: Array<{
  key: keyof KeyPermissions
  title: string
  permission: string
  description: string
}> = [
  {
    key: "audioProcess",
    title: "Process audio",
    permission: "audio:process",
    description: "Allows uploads to the trimming endpoint.",
  },
  {
    key: "historyRead",
    title: "Read history",
    permission: "history:read",
    description: "Allows viewing processing history and audit records.",
  },
  {
    key: "historyDelete",
    title: "Delete history",
    permission: "history:delete",
    description: "Allows removing history entries after review.",
  },
]

export const Route = createFileRoute("/_authed/dashboard")({
  loader: async () => {
    return getCurrentSession()
  },
  component: DashboardPage,
})

function buildTrimmedFilename(filename: string) {
  const lastDot = filename.lastIndexOf(".")

  if (lastDot <= 0) {
    return `${filename}[trimmed]`
  }

  const base = filename.slice(0, lastDot)
  const ext = filename.slice(lastDot)

  return `${base}[trimmed]${ext}`
}

function getDownloadFilename(contentDisposition: string | null, fallbackFilename: string) {
  if (!contentDisposition) {
    return fallbackFilename
  }

  const utf8FilenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)

  if (utf8FilenameMatch?.[1]) {
    return decodeURIComponent(utf8FilenameMatch[1])
  }

  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i)

  if (filenameMatch?.[1]) {
    return filenameMatch[1]
  }

  return fallbackFilename
}

function toPermissionMap(permissions: KeyPermissions) {
  const nextPermissions: Record<string, string[]> = {}

  if (permissions.audioProcess) {
    nextPermissions.audio = ["process"]
  }

  const historyPermissions: string[] = []

  if (permissions.historyRead) {
    historyPermissions.push("read")
  }

  if (permissions.historyDelete) {
    historyPermissions.push("delete")
  }

  if (historyPermissions.length > 0) {
    nextPermissions.history = historyPermissions
  }

  return nextPermissions
}

function formatDisplayDate(value: string | number | Date | null | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function getApiKeyPreview(key: ApiKey) {
  const prefix = key.prefix ? `${key.prefix}-` : ""

  if (key.start) {
    return `${prefix}${key.start}...`
  }

  return `${prefix}hidden`
}

function getApiKeyStatus(key: ApiKey) {
  if (key.enabled === false) {
    return {
      label: "Disabled",
      dotClassName: "bg-gray-500",
      textClassName: "text-gray-300",
    }
  }

  if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
    return {
      label: "Expired",
      dotClassName: "bg-amber-400",
      textClassName: "text-amber-200",
    }
  }

  return {
    label: "Active",
    dotClassName: "bg-emerald-400",
    textClassName: "text-gray-100",
  }
}

function getUserInitial(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email?.trim()

  if (!source) {
    return "U"
  }

  return source[0]?.toUpperCase() ?? "U"
}

function DashboardPage() {
  const navigate = useNavigate()
  const session = Route.useLoaderData()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastRequestDurationMs, setLastRequestDurationMs] = useState<number | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [downloadFilename, setDownloadFilename] = useState(DEFAULT_DOWNLOAD_FILENAME)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [isApiKeysLoading, setIsApiKeysLoading] = useState(true)
  const [isCreateApiKeyDialogOpen, setIsCreateApiKeyDialogOpen] = useState(false)
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false)
  const [deletingApiKeyId, setDeletingApiKeyId] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [newApiKeyValue, setNewApiKeyValue] = useState<string | null>(null)
  const [apiKeyName, setApiKeyName] = useState("")
  const [apiKeyOwnerType, setApiKeyOwnerType] = useState<ApiKeyOwnerType>("you")
  const [apiKeyProject, setApiKeyProject] = useState(DEFAULT_PROJECT_ID)
  const [apiKeyPermissionMode, setApiKeyPermissionMode] = useState<ApiKeyPermissionMode>("all")
  const [apiKeyExpiresInDays, setApiKeyExpiresInDays] = useState("30")
  const [apiKeyPermissions, setApiKeyPermissions] =
    useState<KeyPermissions>(DEFAULT_KEY_PERMISSIONS)

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  async function refreshHistory() {
    setIsHistoryLoading(true)

    try {
      const response = await fetch("/api/history")

      if (response.status === 401) {
        await navigate({
          to: "/login",
          search: {
            redirect: "/dashboard",
          },
        })
        return
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.status}`)
      }

      const data = (await response.json()) as unknown

      if (!Array.isArray(data)) {
        throw new Error("Invalid history response")
      }

      setHistoryEntries(data as HistoryEntry[])
      setHistoryError(null)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Failed to fetch history")
    } finally {
      setIsHistoryLoading(false)
    }
  }

  async function refreshApiKeys() {
    setIsApiKeysLoading(true)

    try {
      const result = await authClient.apiKey.list()

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to fetch API keys")
      }

      setApiKeys(Array.isArray(result.data) ? result.data : [])
      setApiKeyError(null)
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Failed to fetch API keys")
    } finally {
      setIsApiKeysLoading(false)
    }
  }

  useEffect(() => {
    void refreshHistory()
    void refreshApiKeys()
  }, [])

  useEffect(() => {
    if (!isCreateApiKeyDialogOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCreatingApiKey) {
        setIsCreateApiKeyDialogOpen(false)
        setApiKeyError(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isCreateApiKeyDialogOpen, isCreatingApiKey])

  function resetApiKeyForm(permissionMode: ApiKeyPermissionMode = "all") {
    setApiKeyName("")
    setApiKeyOwnerType("you")
    setApiKeyProject(DEFAULT_PROJECT_ID)
    setApiKeyExpiresInDays("30")
    setApiKeyPermissionMode(permissionMode)
    setApiKeyPermissions(
      permissionMode === "all"
        ? ALL_KEY_PERMISSIONS
        : permissionMode === "read-only"
          ? READ_ONLY_KEY_PERMISSIONS
          : RESTRICTED_DEFAULT_KEY_PERMISSIONS
    )
  }

  function handleOpenCreateApiKeyDialog() {
    setApiKeyError(null)
    setNewApiKeyValue(null)
    resetApiKeyForm("all")
    setIsCreateApiKeyDialogOpen(true)
  }

  function handleCloseCreateApiKeyDialog() {
    if (isCreatingApiKey) {
      return
    }

    setIsCreateApiKeyDialogOpen(false)
    setApiKeyError(null)
  }

  function handleApiKeyPermissionModeChange(mode: ApiKeyPermissionMode) {
    setApiKeyPermissionMode(mode)

    if (mode === "all") {
      setApiKeyPermissions(ALL_KEY_PERMISSIONS)
      return
    }

    if (mode === "read-only") {
      setApiKeyPermissions(READ_ONLY_KEY_PERMISSIONS)
      return
    }

    setApiKeyPermissions((current) =>
      Object.values(current).some(Boolean) ? current : RESTRICTED_DEFAULT_KEY_PERMISSIONS
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedFile || isProcessing) {
      return
    }

    setIsProcessing(true)
    setErrorMessage(null)
    setLastRequestDurationMs(null)
    const requestStartTime = performance.now()

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }

    const formData = new FormData()
    formData.append("file", selectedFile)
    const fallbackDownloadFilename = buildTrimmedFilename(selectedFile.name)

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      })

      if (response.status === 401) {
        await navigate({
          to: "/login",
          search: {
            redirect: "/dashboard",
          },
        })
        return
      }

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? ""
        let errorText = `Request failed with status ${response.status}`

        if (contentType.includes("application/json")) {
          const data = (await response.json()) as { error?: string }

          if (data.error) {
            errorText = data.error
          }
        } else {
          const text = await response.text()

          if (text) {
            errorText = text
          }
        }

        throw new Error(errorText)
      }

      const processedAudio = await response.blob()
      const nextDownloadFilename = getDownloadFilename(
        response.headers.get("content-disposition"),
        fallbackDownloadFilename
      )
      const processedAudioFile = new File([processedAudio], nextDownloadFilename, {
        type: processedAudio.type || "audio/mpeg",
      })
      const nextAudioUrl = URL.createObjectURL(processedAudioFile)

      setAudioUrl(nextAudioUrl)
      setDownloadFilename(nextDownloadFilename)
      await refreshHistory()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Request failed")
    } finally {
      setLastRequestDurationMs(performance.now() - requestStartTime)
      setIsProcessing(false)
    }
  }

  async function handleDeleteEntry(entryId: number) {
    try {
      const response = await fetch(`/api/history/${entryId}`, {
        method: "DELETE",
      })

      if (response.status === 401) {
        await navigate({
          to: "/login",
          search: {
            redirect: "/dashboard",
          },
        })
        return
      }

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error ?? "Failed to delete history entry")
      }

      await refreshHistory()
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Failed to delete history entry")
    }
  }

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isCreatingApiKey) {
      return
    }

    setIsCreatingApiKey(true)
    setApiKeyError(null)
    setNewApiKeyValue(null)

    const expiresInDays = Number.parseInt(apiKeyExpiresInDays, 10)
    const expiresInSeconds =
      Number.isFinite(expiresInDays) && expiresInDays > 0 ? expiresInDays * 24 * 60 * 60 : null

    try {
      const result = await authClient.apiKey.create({
        name: apiKeyName.trim() || undefined,
        expiresIn: expiresInSeconds,
        permissions: toPermissionMap(apiKeyPermissions),
      })

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to create API key")
      }

      setNewApiKeyValue(result.data?.key ?? null)
      resetApiKeyForm("all")
      setIsCreateApiKeyDialogOpen(false)
      await refreshApiKeys()
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Failed to create API key")
    } finally {
      setIsCreatingApiKey(false)
    }
  }

  async function handleDeleteApiKey(apiKeyId: string) {
    if (deletingApiKeyId) {
      return
    }

    setDeletingApiKeyId(apiKeyId)

    try {
      const result = await authClient.apiKey.delete({
        keyId: apiKeyId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to delete API key")
      }

      await refreshApiKeys()
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : "Failed to delete API key")
    } finally {
      setDeletingApiKeyId(null)
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true)

    try {
      await authClient.signOut()
      await navigate({
        to: "/login",
        search: {
          redirect: undefined,
        },
      })
    } finally {
      setIsSigningOut(false)
    }
  }

  const hasSelectedPermissions = Object.values(apiKeyPermissions).some(Boolean)
  const selectedPermissions = API_KEY_PERMISSION_OPTIONS.filter(
    (option) => apiKeyPermissions[option.key]
  )
  const userInitial = getUserInitial(session?.user.name, session?.user.email)
  const createdByLabel = session?.user.name ?? session?.user.email ?? "You"

  // Keep the retained dashboard logic typechecked while the old UI stays commented out.
  void {
    setSelectedFile,
    errorMessage,
    lastRequestDurationMs,
    downloadFilename,
    historyEntries,
    historyError,
    isHistoryLoading,
    apiKeys,
    apiKeyError,
    isApiKeysLoading,
    isSigningOut,
    newApiKeyValue,
    apiKeyExpiresInDays,
    handleSubmit,
    handleDeleteEntry,
    handleCreateApiKey,
    handleDeleteApiKey,
    handleSignOut,
  }

  return (
    <>
      <SidebarProvider
        keyboardShortcut={null}
        className="dashboard-shell font-inter h-svh w-full overflow-hidden overscroll-none text-gray-200"
      >
        <AppSidebar
          className="bg-sidebar hidden md:flex"
          onLogOut={handleSignOut}
          user={{
            name: session?.user.name ?? session?.user.email ?? "User",
            email: session?.user.email ?? "",
            avatar: "",
          }}
        />
        <SidebarInset className="dashboard-scroll-region m-2.5 overflow-hidden rounded-xl border border-white/8 bg-[#131517] shadow-[0_18px_54px_rgba(0,0,0,0.34)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#131517]">
            <div className="border-b border-white/6 px-6 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                  <div className="flex size-10 items-center justify-center rounded-full bg-white text-sm font-semibold text-black">
                    {userInitial}
                  </div>
                  <button type="button" className="font-medium text-white">
                    Personal
                  </button>
                  <span className="text-gray-600">/</span>
                  <button type="button" className="font-medium text-white">
                    Default project
                  </button>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <a href="#" className="transition-colors hover:text-white">
                    Dashboard
                  </a>
                  <a href="#" className="transition-colors hover:text-white">
                    API Docs
                  </a>
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-full border border-white/8 bg-white/[0.02] text-gray-200 transition-colors hover:bg-white/[0.06]"
                  >
                    <Settings className="size-4" />
                  </button>
                  <div className="flex size-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                    {userInitial}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-6">
              <div className="mx-auto w-full max-w-[1480px]">
                <section className="overflow-hidden rounded-[26px] border border-white/8 bg-[#1f1f21] shadow-[0_24px_72px_rgba(0,0,0,0.28)]">
                  <div className="flex flex-col gap-4 border-b border-white/8 px-8 py-6 lg:flex-row lg:items-center lg:justify-between">
                    <h1 className="text-[24px] font-semibold tracking-tight text-white">
                      API keys
                    </h1>
                    <Button
                      type="button"
                      onClick={handleOpenCreateApiKeyDialog}
                      className="h-12 rounded-2xl bg-white px-5 text-base font-medium text-black hover:bg-white/90"
                    >
                      <Plus />
                      Create new secret key
                    </Button>
                  </div>

                  <div className="px-8 py-8">
                    {newApiKeyValue ? (
                      <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-emerald-100">
                            Secret key generated
                          </p>
                          <code className="mt-2 block text-sm leading-6 break-all text-emerald-50">
                            {newApiKeyValue}
                          </code>
                        </div>
                        <button
                          type="button"
                          className="rounded-full p-1 text-emerald-100/80 transition-colors hover:bg-white/10 hover:text-white"
                          onClick={() => setNewApiKeyValue(null)}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : null}

                    <div className="max-w-[1200px] space-y-5 text-[15px] leading-8 text-gray-300">
                      <p>You can view and manage API keys for this workspace.</p>
                      <p>
                        Do not share secret keys with others or expose them in browser code or other
                        client-side bundles. Rotate or revoke any key that may have leaked.
                      </p>
                      <p>
                        View usage per API key on the{" "}
                        <a href="#" className="text-gray-200 underline underline-offset-4">
                          Usage page
                        </a>
                        .
                      </p>
                    </div>

                    {apiKeyError && !isCreateApiKeyDialogOpen ? (
                      <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">
                        {apiKeyError}
                      </div>
                    ) : null}

                    <div className="mt-10 overflow-x-auto">
                      <table className="w-full min-w-[1120px] border-collapse text-left text-[15px] text-gray-300">
                        <thead>
                          <tr className="border-b border-white/8 text-[12px] tracking-[0.18em] text-gray-500 uppercase">
                            <th className="pr-6 pb-4 font-medium">Name</th>
                            <th className="pr-6 pb-4 font-medium">Status</th>
                            <th className="pr-6 pb-4 font-medium">Secret key</th>
                            <th className="pr-6 pb-4 font-medium">Created</th>
                            <th className="pr-6 pb-4 font-medium">Last used</th>
                            <th className="pr-6 pb-4 font-medium">Project access</th>
                            <th className="pr-6 pb-4 font-medium">Created by</th>
                            <th className="pb-4 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {isApiKeysLoading ? (
                            <tr>
                              <td colSpan={8} className="py-10">
                                <div className="flex items-center gap-3 text-sm text-gray-400">
                                  <Loader className="size-4 animate-spin" />
                                  Loading API keys...
                                </div>
                              </td>
                            </tr>
                          ) : null}

                          {!isApiKeysLoading && apiKeys.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="py-12 text-sm text-gray-400">
                                No API keys yet. Create your first key to start authenticating
                                external scripts or integrations.
                              </td>
                            </tr>
                          ) : null}

                          {!isApiKeysLoading
                            ? apiKeys.map((key) => {
                                const status = getApiKeyStatus(key)

                                return (
                                  <tr
                                    key={key.id}
                                    className="border-b border-white/8 last:border-b-0"
                                  >
                                    <td className="py-5 pr-6 text-[16px] text-white">
                                      {key.name || "Untitled key"}
                                    </td>
                                    <td className="py-5 pr-6">
                                      <div
                                        className={`inline-flex items-center gap-2 ${status.textClassName}`}
                                      >
                                        <span
                                          className={`size-2 rounded-full ${status.dotClassName}`}
                                        />
                                        {status.label}
                                      </div>
                                    </td>
                                    <td className="py-5 pr-6 font-mono text-[14px] text-gray-200">
                                      {getApiKeyPreview(key)}
                                    </td>
                                    <td className="py-5 pr-6 text-gray-200">
                                      {formatDisplayDate(key.createdAt) ?? "Unknown"}
                                    </td>
                                    <td className="py-5 pr-6 text-gray-200">
                                      {formatDisplayDate(key.lastRequest) ?? "Never"}
                                    </td>
                                    <td className="py-5 pr-6 text-gray-200">Default project</td>
                                    <td className="py-5 pr-6 text-gray-200">{createdByLabel}</td>
                                    <td className="py-5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteApiKey(key.id)}
                                        disabled={deletingApiKeyId !== null}
                                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
                                      >
                                        {deletingApiKeyId === key.id ? (
                                          <Loader className="size-4 animate-spin" />
                                        ) : (
                                          <Trash2 className="size-4" />
                                        )}
                                        Revoke
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })
                            : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          {isCreateApiKeyDialogOpen ? (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-[2px]"
              onClick={handleCloseCreateApiKeyDialog}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-api-key-title"
                className="w-full max-w-[900px] rounded-[28px] border border-white/10 bg-[#2b2b2d] p-8 text-white shadow-[0_28px_96px_rgba(0,0,0,0.45)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-6">
                  <h2
                    id="create-api-key-title"
                    className="text-[28px] font-semibold tracking-tight"
                  >
                    Create new secret key
                  </h2>
                  <button
                    type="button"
                    className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white/8 hover:text-white"
                    onClick={handleCloseCreateApiKeyDialog}
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <form className="mt-8 space-y-8" onSubmit={handleCreateApiKey}>
                  <div className="space-y-4">
                    <Label className="text-[17px] font-semibold text-white">Owned by</Label>
                    <div className="inline-flex rounded-[20px] bg-black p-1">
                      <button
                        type="button"
                        className={`rounded-[16px] px-7 py-3 text-[18px] font-medium transition-colors ${
                          apiKeyOwnerType === "you"
                            ? "bg-[#323234] text-white"
                            : "text-gray-400 hover:text-white"
                        }`}
                        onClick={() => setApiKeyOwnerType("you")}
                      >
                        You
                      </button>
                      <button
                        type="button"
                        className={`rounded-[16px] px-7 py-3 text-[18px] font-medium transition-colors ${
                          apiKeyOwnerType === "service-account"
                            ? "bg-[#323234] text-white"
                            : "text-gray-400 hover:text-white"
                        }`}
                        onClick={() => setApiKeyOwnerType("service-account")}
                      >
                        Service account
                      </button>
                    </div>
                    <p className="max-w-[760px] text-[15px] leading-8 text-gray-300">
                      {apiKeyOwnerType === "you"
                        ? "This API key is tied to your user and can make requests against the selected project. If your access is removed, the key stops working as well."
                        : "This key can represent a service account for server-side automation. You can still adjust scopes before creating it."}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="api-key-name" className="text-[17px] font-semibold text-white">
                      Name <span className="ml-2 font-normal text-gray-400">Optional</span>
                    </Label>
                    <Input
                      id="api-key-name"
                      value={apiKeyName}
                      onChange={(event) => setApiKeyName(event.target.value)}
                      placeholder="My Test Key"
                      type="text"
                      className="h-16 rounded-2xl border-white/18 bg-transparent px-6 text-[18px] text-white placeholder:text-gray-500 focus-visible:border-white/30 focus-visible:ring-0"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label
                      htmlFor="api-key-project"
                      className="text-[17px] font-semibold text-white"
                    >
                      Project
                    </Label>
                    <div className="relative">
                      <select
                        id="api-key-project"
                        value={apiKeyProject}
                        onChange={(event) => setApiKeyProject(event.target.value)}
                        className="h-16 w-full appearance-none rounded-2xl border border-white/18 bg-transparent px-6 text-[18px] text-white transition-colors outline-none focus:border-white/30"
                      >
                        <option value={DEFAULT_PROJECT_ID} className="bg-[#2b2b2d] text-white">
                          Default project
                        </option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute top-1/2 right-6 size-5 -translate-y-1/2 text-gray-400" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-[17px] font-semibold text-white">Permissions</Label>
                    <div className="inline-flex rounded-[20px] bg-black p-1">
                      {(
                        [
                          ["all", "All"],
                          ["restricted", "Restricted"],
                          ["read-only", "Read only"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`rounded-[16px] px-7 py-3 text-[18px] font-medium transition-colors ${
                            apiKeyPermissionMode === mode
                              ? "bg-[#323234] text-white"
                              : "text-gray-400 hover:text-white"
                          }`}
                          onClick={() => handleApiKeyPermissionModeChange(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {apiKeyPermissionMode === "restricted" ? (
                      <div className="grid gap-3 pt-2">
                        {API_KEY_PERMISSION_OPTIONS.map((option) => (
                          <label
                            key={option.key}
                            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4"
                          >
                            <input
                              type="checkbox"
                              checked={apiKeyPermissions[option.key]}
                              onChange={(event) =>
                                setApiKeyPermissions((current) => ({
                                  ...current,
                                  [option.key]: event.target.checked,
                                }))
                              }
                              className="mt-1 h-4 w-4 accent-white"
                            />
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-medium text-white">
                                  {option.title}
                                </span>
                                <code className="rounded-md bg-white/6 px-2 py-0.5 text-[12px] text-gray-300">
                                  {option.permission}
                                </code>
                              </div>
                              <p className="mt-1 text-sm text-gray-400">{option.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">
                        {apiKeyPermissionMode === "all"
                          ? "Full access to every permission currently available."
                          : "Read-only access is limited to viewing history without mutation rights."}
                      </p>
                    )}

                    {apiKeyPermissionMode === "restricted" ? (
                      <p className="text-sm text-gray-400">
                        {selectedPermissions.length > 0
                          ? `Selected: ${selectedPermissions.map((option) => option.permission).join(", ")}`
                          : "Select at least one permission for this key."}
                      </p>
                    ) : null}
                  </div>

                  {apiKeyError ? (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">
                      {apiKeyError}
                    </div>
                  ) : null}

                  <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-16 rounded-2xl bg-white/10 px-8 text-[18px] text-white hover:bg-white/15"
                      onClick={handleCloseCreateApiKeyDialog}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isCreatingApiKey || !hasSelectedPermissions}
                      className="h-16 rounded-2xl bg-white px-8 text-[18px] font-medium text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/35"
                    >
                      {isCreatingApiKey ? <Loader className="animate-spin" /> : null}
                      Create secret key
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </SidebarInset>
      </SidebarProvider>

      {/* <main className="dashboard-page">
        <section className="dashboard-hero">
          <div>
            <p className="dashboard-kicker">Authenticated workspace</p>
            <h1>Trim uploads, inspect your history, and mint API keys deliberately.</h1>
            <p className="dashboard-copy">
              Signed in as <strong>{session?.user.email}</strong>. Session auth unlocks the dashboard.
              API keys unlock the same backend programmatically with explicit scopes.
            </p>
          </div>

          <div className="dashboard-actions">
            <button className="secondary-action" onClick={() => void refreshHistory()} type="button">
              <RefreshCcw size={16} />
              Refresh history
            </button>
            <button
              className="secondary-action danger"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              type="button"
            >
              {isSigningOut ? <Loader className="spin" size={16} /> : <LogOut size={16} />}
              Sign out
            </button>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="dashboard-kicker">Processing</p>
                <h2>Submit audio</h2>
              </div>
              <Upload size={18} />
            </div>

            <form className="upload-form" onSubmit={handleSubmit}>
              <label className="file-field">
                <span>Audio file</span>
                <input
                  name="file"
                  onChange={(event) => {
                    setSelectedFile(event.target.files?.[0] ?? null)
                  }}
                  required
                  type="file"
                />
              </label>

              <button
                className="primary-action"
                disabled={!selectedFile || isProcessing}
                type="submit"
              >
                {isProcessing ? <Loader className="spin" size={18} /> : <Upload size={18} />}
                {isProcessing ? "Processing" : "Submit"}
              </button>
            </form>

            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
            {lastRequestDurationMs !== null ? (
              <p className="quiet-copy">
                End-to-end processing time: {(lastRequestDurationMs / 1000).toFixed(2)}s
              </p>
            ) : null}

            {audioUrl ? (
              <div className="audio-result">
                <audio controls src={audioUrl} />
                <a className="download-link" download={downloadFilename} href={audioUrl}>
                  Download processed audio
                </a>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="dashboard-kicker">Programmatic access</p>
                <h2>API keys</h2>
              </div>
              <KeyRound size={18} />
            </div>

            <form className="api-key-form" onSubmit={handleCreateApiKey}>
              <label>
                <span>Key name</span>
                <input
                  onChange={(event) => setApiKeyName(event.target.value)}
                  placeholder="deploy-bot"
                  required
                  type="text"
                  value={apiKeyName}
                />
              </label>

              <label>
                <span>Expires in days</span>
                <input
                  min="1"
                  onChange={(event) => setApiKeyExpiresInDays(event.target.value)}
                  type="number"
                  value={apiKeyExpiresInDays}
                />
              </label>

              <div className="permission-grid">
                <label>
                  <input
                    checked={apiKeyPermissions.audioProcess}
                    onChange={(event) =>
                      setApiKeyPermissions((current) => ({
                        ...current,
                        audioProcess: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>`audio:process`</span>
                </label>
                <label>
                  <input
                    checked={apiKeyPermissions.historyRead}
                    onChange={(event) =>
                      setApiKeyPermissions((current) => ({
                        ...current,
                        historyRead: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>`history:read`</span>
                </label>
                <label>
                  <input
                    checked={apiKeyPermissions.historyDelete}
                    onChange={(event) =>
                      setApiKeyPermissions((current) => ({
                        ...current,
                        historyDelete: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>`history:delete`</span>
                </label>
              </div>

              <button className="primary-action" disabled={isCreatingApiKey} type="submit">
                {isCreatingApiKey ? (
                  <Loader className="spin" size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
                Create API key
              </button>
            </form>

            {newApiKeyValue ? (
              <div className="key-reveal">
                <p className="dashboard-kicker">Shown once</p>
                <code>{newApiKeyValue}</code>
              </div>
            ) : null}

            {apiKeyError ? <p className="form-error">{apiKeyError}</p> : null}

            <div className="key-list">
              {isApiKeysLoading ? <p className="quiet-copy">Loading keys...</p> : null}
              {!isApiKeysLoading && apiKeys.length === 0 ? (
                <p className="quiet-copy">No API keys yet.</p>
              ) : null}
              {apiKeys.map((key) => (
                <article className="key-card" key={key.id}>
                  <div>
                    <strong>{key.name || "Unnamed key"}</strong>
                    <p>{key.start ? `${key.start}...` : "Key prefix hidden"}</p>
                  </div>
                  <div className="key-card-meta">
                    <span>
                      {key.expiresAt
                        ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}`
                        : "No expiry"}
                    </span>
                    <button onClick={() => void handleDeleteApiKey(key.id)} type="button">
                      <Trash2 size={16} />
                      Revoke
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="panel history-panel">
          <div className="panel-header">
            <div>
              <p className="dashboard-kicker">Scoped records</p>
              <h2>Your history</h2>
            </div>
            <Eye size={18} />
          </div>

          {historyError ? <p className="form-error">{historyError}</p> : null}
          {isHistoryLoading ? <p className="quiet-copy">Loading history...</p> : null}
          {!isHistoryLoading && historyEntries.length === 0 ? (
            <p className="quiet-copy">No history yet.</p>
          ) : null}

          <ul className="history-list">
            {historyEntries.map((entry) => (
              <li className="history-row" key={entry.id}>
                <div>
                  <strong>{entry.filename}</strong>
                  <p>Ad segments removed: {entry.ad_segments_found}</p>
                </div>
                <div className="history-row-meta">
                  <span>{new Date(entry.created_at).toLocaleString()}</span>
                  <button onClick={() => void handleDeleteEntry(entry.id)} type="button">
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main> */}
    </>
  )
}
