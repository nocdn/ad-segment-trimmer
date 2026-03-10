import { authClient } from "#/lib/auth-client"
import { getCurrentSession } from "#/lib/auth-server"
import type { ApiKey } from "@better-auth/api-key/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { useEffect, useState } from "react"

const DEFAULT_DOWNLOAD_FILENAME = "processed_audio.mp3"
const DEFAULT_PROJECT_ID = "default-project"

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

  // Keep the dashboard logic typechecked while the authenticated UI is intentionally blank.
  void {
    API_KEY_PERMISSION_OPTIONS,
    session,
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
    isCreateApiKeyDialogOpen,
    isSigningOut,
    newApiKeyValue,
    apiKeyOwnerType,
    apiKeyProject,
    apiKeyPermissionMode,
    apiKeyExpiresInDays,
    handleOpenCreateApiKeyDialog,
    handleCloseCreateApiKeyDialog,
    handleApiKeyPermissionModeChange,
    handleSubmit,
    handleDeleteEntry,
    handleCreateApiKey,
    handleDeleteApiKey,
    handleSignOut,
  }

  return <main />
}
