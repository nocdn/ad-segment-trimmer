import { authClient } from "#/lib/auth-client"
import { getCurrentSession } from "#/lib/auth-server"
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  NumberField,
  Select,
} from "@base-ui-components/react"
import type { ApiKey } from "@better-auth/api-key/client"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Check,
  ChevronDown,
  History,
  Key,
  Loader,
  Plus,
  SquareDashedMousePointer,
  User,
} from "lucide-react"
import type { ChangeEvent, FormEvent } from "react"
import { useEffect, useRef, useState } from "react"

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
type ListedApiKey = Omit<ApiKey, "key"> & {
  key?: string
}

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

function isSamePermissions(current: KeyPermissions, target: KeyPermissions) {
  return (
    current.audioProcess === target.audioProcess &&
    current.historyRead === target.historyRead &&
    current.historyDelete === target.historyDelete
  )
}

function getPermissionModeFromPermissions(permissions: KeyPermissions): ApiKeyPermissionMode {
  if (isSamePermissions(permissions, ALL_KEY_PERMISSIONS)) {
    return "all"
  }

  if (isSamePermissions(permissions, READ_ONLY_KEY_PERMISSIONS)) {
    return "read-only"
  }

  return "restricted"
}

function getApiKeyAccessLabel(permissions: ListedApiKey["permissions"]) {
  const nextPermissions: KeyPermissions = {
    audioProcess: permissions?.audio?.includes("process") ?? false,
    historyRead: permissions?.history?.includes("read") ?? false,
    historyDelete: permissions?.history?.includes("delete") ?? false,
  }

  if (isSamePermissions(nextPermissions, ALL_KEY_PERMISSIONS)) {
    return "All"
  }

  if (isSamePermissions(nextPermissions, READ_ONLY_KEY_PERMISSIONS)) {
    return "Read only"
  }

  if (isSamePermissions(nextPermissions, RESTRICTED_DEFAULT_KEY_PERMISSIONS)) {
    return "Restricted"
  }

  const grantedScopes = API_KEY_PERMISSION_OPTIONS.filter(
    (permission) => nextPermissions[permission.key]
  ).length

  return grantedScopes > 0 ? `Custom (${grantedScopes})` : "No access"
}

function getApiKeyName(apiKey: ListedApiKey) {
  return apiKey.name?.trim() || apiKey.start || "Untitled key"
}

function getApiKeyPreview(apiKey: ListedApiKey) {
  return apiKey.start ?? "Unavailable"
}

function formatApiKeyDate(value: string | Date | null | undefined) {
  if (!value) {
    return "Never"
  }

  const parsedDate = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return "Never"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(parsedDate)
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
  const [apiKeys, setApiKeys] = useState<ListedApiKey[]>([])
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [isApiKeysLoading, setIsApiKeysLoading] = useState(true)
  const [isCreateApiKeyDialogOpen, setIsCreateApiKeyDialogOpen] = useState(false)
  const [isRevealApiKeyDialogOpen, setIsRevealApiKeyDialogOpen] = useState(false)
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false)
  const [deletingApiKeyId, setDeletingApiKeyId] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [newApiKeyValue, setNewApiKeyValue] = useState<string | null>(null)
  const [hasCopiedApiKey, setHasCopiedApiKey] = useState(false)
  const [apiKeyName, setApiKeyName] = useState("")
  const [apiKeyPermissionMode, setApiKeyPermissionMode] = useState<ApiKeyPermissionMode>("all")
  const [apiKeyExpiresInDays, setApiKeyExpiresInDays] = useState("30")
  const [apiKeyPermissions, setApiKeyPermissions] =
    useState<KeyPermissions>(DEFAULT_KEY_PERMISSIONS)
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }

      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current)
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

      const nextApiKeys: ListedApiKey[] = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.data?.apiKeys)
          ? result.data.apiKeys
          : []

      setApiKeys(nextApiKeys)
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

  function resetApiKeyForm(permissionMode: ApiKeyPermissionMode = "all") {
    setApiKeyName("")
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
    setHasCopiedApiKey(false)
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

  function handleApiKeyPermissionToggle(key: keyof KeyPermissions, checked: boolean) {
    setApiKeyPermissions((current) => {
      const nextPermissions = {
        ...current,
        [key]: checked,
      }

      setApiKeyPermissionMode(getPermissionModeFromPermissions(nextPermissions))

      return nextPermissions
    })
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

    if (!apiKeyName.trim()) {
      setApiKeyError("Name is required")
      return
    }

    setIsCreatingApiKey(true)
    setApiKeyError(null)
    setNewApiKeyValue(null)
    setHasCopiedApiKey(false)

    const expiresInDays = Number.parseInt(apiKeyExpiresInDays, 10)
    const expiresInSeconds =
      Number.isFinite(expiresInDays) && expiresInDays > 0 ? expiresInDays * 24 * 60 * 60 : null

    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: apiKeyName.trim(),
          expiresIn: expiresInSeconds,
          permissions: toPermissionMap(apiKeyPermissions),
        }),
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

      const result = (await response.json()) as { error?: string; key?: string }

      if (!response.ok) {
        throw new Error(result.error ?? "Failed to create API key")
      }

      if (!result.key) {
        throw new Error("API key was created but no key value was returned")
      }

      setNewApiKeyValue(result.key)
      resetApiKeyForm("all")
      setIsCreateApiKeyDialogOpen(false)
      setIsRevealApiKeyDialogOpen(true)
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

  async function handleCopyApiKey() {
    if (!newApiKeyValue) {
      return
    }

    await navigator.clipboard.writeText(newApiKeyValue)
    setHasCopiedApiKey(true)

    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current)
    }

    copyResetTimeoutRef.current = setTimeout(() => {
      setHasCopiedApiKey(false)
      copyResetTimeoutRef.current = null
    }, 1000)
  }

  function handleCloseRevealApiKeyDialog() {
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current)
      copyResetTimeoutRef.current = null
    }

    setIsRevealApiKeyDialogOpen(false)
    setNewApiKeyValue(null)
    setHasCopiedApiKey(false)
  }

  const parsedApiKeyExpiresInDays = Number.parseInt(apiKeyExpiresInDays, 10)

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

  return (
    <div
      id="main-container"
      className="font-inter color-text grid h-svh w-screen grid-cols-[12rem_1fr]"
    >
      <div className="flex h-full flex-col justify-between text-[15px] opacity-90" id="sidebar">
        <div id="main-sidebar-content" className="flex flex-col items-start p-5 px-3">
          <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#262626]">
            {" "}
            <SquareDashedMousePointer size={17} strokeWidth={2.5} />
            Playground
          </button>
          <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#262626]">
            {" "}
            <User size={17} strokeWidth={2.5} />
            Users
          </button>
          <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#262626]">
            {" "}
            <Key size={17} strokeWidth={2.5} />
            API Keys
          </button>
          <button className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#262626]">
            {" "}
            <History size={17} strokeWidth={2.5} />
            History
          </button>
        </div>
        <div id="secondary-sidebar-content" className="m-6 flex items-center gap-4">
          <div className="size-8 rounded-full bg-amber-200"></div>
          <div className="flex flex-col text-sm">
            <p>bartek.bak</p>
            <a className="flex cursor-pointer items-center gap-2 text-red-400">Log out</a>
          </div>
        </div>
      </div>
      <div id="main-content" className="py-3 pr-3">
        <div className="border-shadow flex h-full w-full flex-col rounded-xl bg-[#181818] p-5.5">
          <div id="heading-api-keys" className="font-ibm-plex-sans flex w-full justify-between">
            <p className="fontfont-medium text-lg">API Keys</p>
            <button
              type="button"
              onClick={handleOpenCreateApiKeyDialog}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-black"
            >
              <Plus size={16} />
              New API Key
            </button>
          </div>
          <p className="text-[15px]">
            Please keep your API keys a secret, and revoke them if they may have leaked.
          </p>
          <div id="keys-table" className="mt-12 w-full">
            <div id="table-heading" className="grid grid-cols-[1fr_1fr_1fr_1fr_2fr]">
              <p>Name</p>
              <p>Preview</p>
              <p>Access</p>
              <p>Expires</p>
              <p className="w-full pr-1.5 text-right">Action</p>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {isApiKeysLoading ? <p className="text-sm opacity-70">Loading API keys...</p> : null}
              {!isApiKeysLoading && apiKeyError ? (
                <p className="text-sm text-red-400">{apiKeyError}</p>
              ) : null}
              {!isApiKeysLoading && !apiKeyError && apiKeys.length === 0 ? (
                <p className="text-sm opacity-70">No API keys yet.</p>
              ) : null}
              {!isApiKeysLoading && !apiKeyError
                ? apiKeys.map((apiKey) => {
                    return (
                      <div
                        key={apiKey.id}
                        className="grid grid-cols-[1fr_1fr_1fr_1fr_2fr] items-center border-t border-white/10 py-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate">{getApiKeyName(apiKey)}</p>
                        </div>
                        <p className="truncate font-mono text-sm opacity-80">
                          {getApiKeyPreview(apiKey)}
                        </p>
                        <p>{getApiKeyAccessLabel(apiKey.permissions)}</p>
                        <p>{formatApiKeyDate(apiKey.expiresAt)}</p>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleDeleteApiKey(apiKey.id)}
                            disabled={deletingApiKeyId === apiKey.id}
                            className="cursor-pointer rounded-full bg-white/10 px-4 py-2 text-right text-sm transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingApiKeyId === apiKey.id ? "Revoking..." : "Revoke"}
                          </button>
                        </div>
                      </div>
                    )
                  })
                : null}
            </div>
          </div>
        </div>
      </div>
      <Dialog.Root
        open={isCreateApiKeyDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!open && isCreatingApiKey) {
            return
          }

          setIsCreateApiKeyDialogOpen(open)

          if (!open) {
            setApiKeyError(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="ui-dialog-backdrop fixed inset-0 z-40 bg-black/60" />
          <Dialog.Popup className="ui-dialog-popup fixed top-1/2 left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-700 bg-[#111111] p-6 text-white shadow-2xl outline-none">
            <Dialog.Title className="text-lg font-medium">Create new API key</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-white/70">
              This key will only be shown once after creation.
            </Dialog.Description>
            <form onSubmit={handleCreateApiKey} className="mt-6 flex flex-col gap-4">
              <Field.Root className="flex flex-col gap-1.5">
                <Field.Label className="text-sm">Name</Field.Label>
                <Input
                  autoComplete="off"
                  value={apiKeyName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setApiKeyName(event.currentTarget.value)
                  }
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  data-lpignore="true"
                  placeholder="Production uploader"
                  required
                  className="h-10 rounded-md border border-neutral-600 bg-transparent px-3 text-sm text-white outline-none"
                />
              </Field.Root>

              <Field.Root className="flex flex-col gap-1.5">
                <Field.Label className="text-sm">Access</Field.Label>
                <Select.Root
                  value={apiKeyPermissionMode}
                  onValueChange={(value: ApiKeyPermissionMode | null) => {
                    if (value) {
                      handleApiKeyPermissionModeChange(value)
                    }
                  }}
                >
                  <Select.Trigger className="flex h-10 items-center justify-between rounded-md border border-neutral-600 bg-transparent px-3 text-sm text-white">
                    <Select.Value>
                      {apiKeyPermissionMode === "read-only"
                        ? "Read only"
                        : apiKeyPermissionMode === "restricted"
                          ? "Restricted"
                          : "All"}
                    </Select.Value>
                    <Select.Icon>
                      <ChevronDown size={16} />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Positioner className="z-50 outline-none">
                      <Select.Popup className="min-w-[var(--anchor-width)] rounded-md border border-neutral-700 bg-[#111111] p-1 text-sm text-white shadow-xl outline-none">
                        <Select.Item value="all" className="flex rounded px-3 py-2">
                          <Select.ItemText>All</Select.ItemText>
                          <Select.ItemIndicator className="ml-auto">
                            <Check size={14} />
                          </Select.ItemIndicator>
                        </Select.Item>
                        <Select.Item value="restricted" className="flex rounded px-3 py-2">
                          <Select.ItemText>Restricted</Select.ItemText>
                          <Select.ItemIndicator className="ml-auto">
                            <Check size={14} />
                          </Select.ItemIndicator>
                        </Select.Item>
                        <Select.Item value="read-only" className="flex rounded px-3 py-2">
                          <Select.ItemText>Read only</Select.ItemText>
                          <Select.ItemIndicator className="ml-auto">
                            <Check size={14} />
                          </Select.ItemIndicator>
                        </Select.Item>
                      </Select.Popup>
                    </Select.Positioner>
                  </Select.Portal>
                </Select.Root>
              </Field.Root>

              {apiKeyPermissionMode === "restricted" ? (
                <Field.Root className="flex flex-col gap-2">
                  <Field.Label className="text-sm">Permissions</Field.Label>
                  <div className="flex flex-col gap-2 rounded-md border border-neutral-700 p-3">
                    {API_KEY_PERMISSION_OPTIONS.map((permission) => (
                      <label
                        key={permission.key}
                        className="flex cursor-pointer items-start gap-3 text-sm"
                      >
                        <Checkbox.Root
                          checked={apiKeyPermissions[permission.key]}
                          onCheckedChange={(checked: boolean) =>
                            handleApiKeyPermissionToggle(permission.key, checked)
                          }
                          className="mt-0.5 inline-flex size-4 items-center justify-center rounded border border-neutral-500"
                        >
                          <Checkbox.Indicator>
                            <Check size={12} />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                        <span>
                          <span className="block">{permission.title}</span>
                          <span className="block text-xs opacity-60">{permission.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Field.Root>
              ) : null}

              <Field.Root className="flex flex-col gap-1.5">
                <Field.Label className="text-sm">Expires in days</Field.Label>
                <NumberField.Root
                  value={Number.isNaN(parsedApiKeyExpiresInDays) ? null : parsedApiKeyExpiresInDays}
                  min={0}
                  onValueChange={(value: number | null) =>
                    setApiKeyExpiresInDays(value === null ? "" : String(value))
                  }
                  className="flex flex-col"
                >
                  <NumberField.Input
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    data-lpignore="true"
                    className="h-10 rounded-md border border-neutral-600 bg-transparent px-3 text-sm text-white outline-none"
                  />
                </NumberField.Root>
                <Field.Description className="text-xs text-white/60">
                  Use 0 if the key should not expire.
                </Field.Description>
              </Field.Root>

              {apiKeyError ? <p className="text-sm text-red-400">{apiKeyError}</p> : null}

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center">
                  {isCreatingApiKey ? <Loader size={16} className="animate-spin" /> : null}
                </div>
                <div className="flex items-center gap-3">
                  <Dialog.Close className="border-shadow cursor-pointer rounded-full border border-neutral-600 px-3 py-2 text-sm">
                    Cancel
                  </Dialog.Close>
                  <Button
                    type="submit"
                    disabled={isCreatingApiKey}
                    className="cursor-pointer rounded-full bg-white px-4 py-2 text-sm text-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCreatingApiKey ? "Creating..." : "Create"}
                  </Button>
                </div>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={isRevealApiKeyDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            handleCloseRevealApiKeyDialog()
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="ui-dialog-backdrop fixed inset-0 z-40 bg-black/60" />
          <Dialog.Popup className="ui-dialog-popup fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-700 bg-[#111111] p-6 text-white shadow-2xl outline-none">
            <Dialog.Title className="text-lg font-medium">Copy your API key</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-white/70">
              Store it now. You will not be able to see this value again.
            </Dialog.Description>
            <div className="mt-6 flex flex-col gap-3">
              <Field.Root className="flex flex-col gap-1.5">
                <Field.Label className="text-sm">API key</Field.Label>
                <Input
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  data-lpignore="true"
                  readOnly
                  value={newApiKeyValue ?? ""}
                  className="h-10 rounded-md border border-neutral-600 bg-transparent px-3 text-sm text-white outline-none"
                />
              </Field.Root>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  onClick={() => void handleCopyApiKey()}
                  className="border-shadow cursor-pointer rounded-full border border-neutral-600 px-4 py-2 text-sm text-white"
                >
                  {hasCopiedApiKey ? "Copied" : "Copy"}
                </Button>
                <button
                  type="button"
                  onClick={handleCloseRevealApiKeyDialog}
                  className="cursor-pointer rounded-full bg-white px-4 py-2 text-sm text-black"
                >
                  Done
                </button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
