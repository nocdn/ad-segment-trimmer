import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, extname, join } from "node:path"
import OpenAI from "openai"
import {
  addHistoryEntry,
  getCachedProcessingData,
  upsertCachedProcessingData,
  type CachedProcessingData,
} from "./db.server"

type TranscribedWord = {
  word: string
  start: number
  end: number
}

type ProcessedAudioResult = {
  body: Buffer
  contentType: string
  downloadFilename: string
}

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini"
const REASONING_EFFORT = (process.env.REASONING_EFFORT ?? "medium") as
  | "minimal"
  | "low"
  | "medium"
  | "high"

let openAiClient: OpenAI | null = null
let fireworksClient: OpenAI | null = null

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required")
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  return openAiClient
}

function getFireworksClient() {
  if (!process.env.FIREWORKS_API_KEY) {
    throw new Error("FIREWORKS_API_KEY is required")
  }

  if (!fireworksClient) {
    fireworksClient = new OpenAI({
      apiKey: process.env.FIREWORKS_API_KEY,
      baseURL: "https://audio-turbo.api.fireworks.ai/v1",
    })
  }

  return fireworksClient
}

function sanitizeUploadedFilename(filename: string) {
  const base = basename(filename).trim()
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, "_")

  return sanitized || `upload_${randomUUID()}`
}

function createDownloadFilename(originalFilename: string) {
  const extension = extname(originalFilename)
  const nameWithoutExtension = extension
    ? originalFilename.slice(0, -extension.length)
    : originalFilename

  return extension ? `${nameWithoutExtension}[trimmed]${extension}` : `${originalFilename}[trimmed]`
}

function escapeContentDispositionFilename(filename: string) {
  return filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function createTempDirectory() {
  const directory = join(tmpdir(), `ad-segment-trimmer-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

async function computeFileHash(filePath: string) {
  const file = await readFile(filePath)
  return createHash("sha256").update(file).digest("hex")
}

function normalizeTimestampRanges(rawRanges: CachedProcessingData["ad_segment_timestamps"]) {
  if (!Array.isArray(rawRanges)) {
    return null
  }

  const normalized: Array<[number, number]> = []

  for (const item of rawRanges) {
    if (!Array.isArray(item) || item.length !== 2) {
      return null
    }

    const [start, end] = item
    const normalizedStart = Number(start)
    const normalizedEnd = Number(end)

    if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd)) {
      return null
    }

    if (normalizedStart < 0 || normalizedEnd <= normalizedStart) {
      return null
    }

    normalized.push([normalizedStart, normalizedEnd])
  }

  normalized.sort((a, b) => a[0] - b[0])
  return normalized
}

async function transcribe(filePath: string) {
  const client = getFireworksClient()
  const response = (await client.audio.transcriptions.create({
    model: "whisper-v3-turbo",
    file: createReadStream(filePath),
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  } as never)) as {
    text?: string
    words?: Array<{
      word?: string
      start?: number
      end?: number
    }>
  }

  const words = Array.isArray(response.words)
    ? response.words
        .map((word) => ({
          word: typeof word.word === "string" ? word.word : "",
          start: Number(word.start),
          end: Number(word.end),
        }))
        .filter(
          (word): word is TranscribedWord =>
            Boolean(word.word) && Number.isFinite(word.start) && Number.isFinite(word.end)
        )
    : []

  return {
    text: typeof response.text === "string" ? response.text : "",
    words,
  }
}

function extractResponseText(response: unknown) {
  if (
    typeof response === "object" &&
    response !== null &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text
  }

  if (typeof response !== "object" || response === null || !("output" in response)) {
    return ""
  }

  const output = Array.isArray(response.output) ? response.output : []

  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item)) {
      continue
    }

    const content = Array.isArray(item.content) ? item.content : []

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text
      }
    }
  }

  return ""
}

async function extractAdSegments(transcriptionText: string) {
  const client = getOpenAiClient()
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "From the provided podcast transcript, please output all of the advertisement segments. Output them verbatim. Output them as an array of strings with each string being a segment. If a segment is repeated exactly in another part of the transcript, only output it once. DO NOT OUTPUT THEM IN ANY CODEBLOCKS OR BACKTICKS OR ANYTHING, JUST THE ARRAY OF SEGMENTS AS YOUR RESPONSE. This is going into a safety-critical system so it cannot have any code blocks or backticks. Do not change the segments' case, punctuation or capitalization.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: transcriptionText,
          },
        ],
      },
    ],
    reasoning: {
      effort: REASONING_EFFORT,
      summary: "auto",
    },
  })

  let parsed: unknown

  try {
    parsed = JSON.parse(extractResponseText(response)) as unknown
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
}

function normalizeWordToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,:;!?]+$/g, "")
}

function findPhraseTimestampMatches(transcriptWords: TranscribedWord[], phrases: string[]) {
  if (transcriptWords.length === 0 || phrases.length === 0) {
    return []
  }

  const normalizedTranscript = transcriptWords.map((item) => ({
    word: normalizeWordToken(item.word),
    start: item.start,
    end: item.end,
  }))

  const matches: Array<[number, number]> = []

  for (const phrase of phrases) {
    const targetWords = phrase.split(/\s+/).map(normalizeWordToken).filter(Boolean)

    if (targetWords.length === 0) {
      continue
    }

    for (let index = 0; index <= normalizedTranscript.length - targetWords.length; index += 1) {
      let matched = true

      for (let offset = 0; offset < targetWords.length; offset += 1) {
        if (normalizedTranscript[index + offset]?.word !== targetWords[offset]) {
          matched = false
          break
        }
      }

      if (!matched) {
        continue
      }

      matches.push([
        normalizedTranscript[index].start,
        normalizedTranscript[index + targetWords.length - 1].end,
      ])
    }
  }

  return matches
}

async function writeConcatManifest({
  inputFile,
  manifestFile,
  segmentsToRemove,
}: {
  inputFile: string
  manifestFile: string
  segmentsToRemove: Array<[number, number]>
}) {
  if (segmentsToRemove.length === 0) {
    throw new Error("segmentsToRemove must not be empty")
  }

  const orderedSegments = [...segmentsToRemove].sort((a, b) => a[0] - b[0])

  for (let index = 0; index < orderedSegments.length; index += 1) {
    const [start, end] = orderedSegments[index]

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Segment ${index}: start and end times must be numbers`)
    }

    if (start >= end) {
      throw new Error(`Segment ${index}: start time must be less than end time`)
    }

    if (index > 0 && start < orderedSegments[index - 1][1]) {
      throw new Error(`Segments ${index - 1} and ${index} overlap or are not in ascending order`)
    }
  }

  const keepRanges: Array<[number, number | null]> = []
  const [firstStart] = orderedSegments[0]

  if (firstStart > 0) {
    keepRanges.push([0, firstStart])
  }

  for (let index = 0; index < orderedSegments.length - 1; index += 1) {
    const [, currentEnd] = orderedSegments[index]
    const [nextStart] = orderedSegments[index + 1]

    if (currentEnd < nextStart) {
      keepRanges.push([currentEnd, nextStart])
    }
  }

  keepRanges.push([orderedSegments[orderedSegments.length - 1][1], null])

  const escapedInputPath = inputFile.replace(/'/g, "'\\''")
  const lines = ["ffconcat version 1.0"]

  for (const [start, end] of keepRanges) {
    lines.push(`file '${escapedInputPath}'`)
    lines.push(`inpoint ${start.toFixed(6)}`)

    if (end !== null) {
      lines.push(`outpoint ${end.toFixed(6)}`)
    }
  }

  await writeFile(manifestFile, `${lines.join("\n")}\n`, "utf8")
}

async function runFfmpeg({
  manifestFile,
  outputFile,
}: {
  manifestFile: string
  outputFile: string
}) {
  const args = [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    manifestFile,
    "-fflags",
    "+genpts",
    "-avoid_negative_ts",
    "make_zero",
    "-c",
    "copy",
    outputFile,
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args)
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr || `FFmpeg exited with code ${code ?? "unknown"}`))
    })
  })
}

export async function processUploadedAudio({
  file,
  userId,
}: {
  file: File
  userId: string
}): Promise<ProcessedAudioResult> {
  const requestStartedAt = Date.now()
  const workingDirectory = await createTempDirectory()
  const originalFilename = file.name || `upload-${randomUUID()}`
  const sanitizedFilename = sanitizeUploadedFilename(originalFilename)
  const inputFile = join(workingDirectory, `${randomUUID()}-${sanitizedFilename}`)
  const outputFile = join(workingDirectory, `${randomUUID()}-output${extname(sanitizedFilename)}`)
  const concatManifestFile = join(workingDirectory, `${randomUUID()}.ffconcat`)

  try {
    await writeFile(inputFile, Buffer.from(await file.arrayBuffer()))

    const audioHash = await computeFileHash(inputFile)
    const cachedProcessing = await getCachedProcessingData(audioHash)

    let transcriptionText: string | null = null
    let adSegments: string[] = []
    let matches: Array<[number, number]> = []

    if (cachedProcessing) {
      const cachedRanges = normalizeTimestampRanges(cachedProcessing.ad_segment_timestamps)

      if (cachedRanges) {
        transcriptionText = cachedProcessing.transcription
        adSegments = Array.isArray(cachedProcessing.ad_segments) ? cachedProcessing.ad_segments : []
        matches = cachedRanges
      }
    }

    if (matches.length === 0) {
      const transcription = await transcribe(inputFile)
      transcriptionText = transcription.text
      adSegments = await extractAdSegments(transcription.text)
      matches = findPhraseTimestampMatches(transcription.words, adSegments)

      await upsertCachedProcessingData({
        audioHash,
        adSegments,
        transcription: transcriptionText,
        adSegmentTimestamps: matches,
      })
    }

    if (matches.length === 0) {
      await copyFile(inputFile, outputFile)
    } else {
      await writeConcatManifest({
        inputFile,
        manifestFile: concatManifestFile,
        segmentsToRemove: matches,
      })

      await runFfmpeg({
        manifestFile: concatManifestFile,
        outputFile,
      })
    }

    const outputBody = await readFile(outputFile)
    const processingTimeMs = Date.now() - requestStartedAt

    await addHistoryEntry({
      userId,
      filename: originalFilename,
      adSegmentsFound: matches.length,
      adSegments,
      processingTimeMs,
    })

    return {
      body: outputBody,
      contentType: file.type || "audio/mpeg",
      downloadFilename: createDownloadFilename(originalFilename),
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

export function createProcessedAudioResponse(result: ProcessedAudioResult) {
  const body = result.body.buffer.slice(
    result.body.byteOffset,
    result.body.byteOffset + result.body.byteLength
  ) as ArrayBuffer

  return new Response(body, {
    status: 200,
    headers: {
      "content-disposition": `attachment; filename="${escapeContentDispositionFilename(result.downloadFilename)}"`,
      "content-length": String(result.body.byteLength),
      "content-type": result.contentType,
    },
  })
}
