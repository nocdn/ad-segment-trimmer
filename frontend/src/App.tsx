import type { FormEvent } from "react"
import { useEffect, useState } from "react"
import "./globals.css"

const DEFAULT_DOWNLOAD_FILENAME = "processed_audio.mp3"

type HistoryEntry = {
  id: number
  filename: string
  created_at: string
  ad_segments_found: number
}

function buildTrimmedFilename(filename: string): string {
  const lastDot = filename.lastIndexOf(".")
  if (lastDot <= 0) {
    return `${filename}[trimmed]`
  }

  const base = filename.slice(0, lastDot)
  const ext = filename.slice(lastDot)
  return `${base}[trimmed]${ext}`
}

function getDownloadFilename(contentDisposition: string | null, fallbackFilename: string): string {
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

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastRequestDurationMs, setLastRequestDurationMs] = useState<number | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [downloadFilename, setDownloadFilename] = useState(DEFAULT_DOWNLOAD_FILENAME)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  useEffect(() => {
    let isActive = true
    let isFetching = false

    async function fetchHistory() {
      if (isFetching) {
        return
      }

      isFetching = true
      try {
        const response = await fetch("/api/history")
        if (!response.ok) {
          throw new Error(`Failed to fetch history: ${response.status}`)
        }

        const data = (await response.json()) as unknown
        if (!Array.isArray(data)) {
          throw new Error("Invalid history response")
        }

        if (!isActive) {
          return
        }

        setHistoryEntries(data as HistoryEntry[])
        setHistoryError(null)
      } catch (error) {
        if (!isActive) {
          return
        }

        setHistoryError(error instanceof Error ? error.message : "Failed to fetch history")
      } finally {
        isFetching = false
      }
    }

    void fetchHistory()
    const intervalId = window.setInterval(() => {
      void fetchHistory()
    }, 1000)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [])

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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Request failed")
    } finally {
      setLastRequestDurationMs(performance.now() - requestStartTime)
      setIsProcessing(false)
    }
  }

  return (
    <main>
      <form onSubmit={handleSubmit}>
        <input
          type="file"
          name="file"
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] ?? null)
          }}
          required
        />
        <button type="submit" disabled={!selectedFile || isProcessing}>
          Submit
        </button>
      </form>

      {isProcessing ? <p>processing...</p> : null}
      {errorMessage ? <p>{errorMessage}</p> : null}
      {lastRequestDurationMs !== null ? (
        <p>End-to-end processing time: {(lastRequestDurationMs / 1000).toFixed(2)}s</p>
      ) : null}

      {audioUrl ? (
        <div>
          <audio controls src={audioUrl} />
          <a href={audioUrl} download={downloadFilename}>
            Download processed audio
          </a>
        </div>
      ) : null}

      <section>
        <h2>History</h2>
        {historyError ? <p>{historyError}</p> : null}
        {historyEntries.length === 0 ? <p>No history yet.</p> : null}
        <ul>
          {historyEntries.map((entry) => (
            <li key={entry.id}>
              <p>{entry.filename}</p>
              <p>Ad segments removed: {entry.ad_segments_found}</p>
              <p>{new Date(entry.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
