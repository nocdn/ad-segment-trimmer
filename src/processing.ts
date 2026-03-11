import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, extname, join, parse, resolve } from "node:path";
import { mkdir, unlink } from "node:fs/promises";

import OpenAI from "openai";

import { getEntryByHash, type TimestampRange, upsertEntry } from "./db.ts";
import { config } from "./config.ts";
import { logInfo, logWarning } from "./logger.ts";

const UPLOADS_DIR = "uploads";
const FIREWORKS_BASE_URL = "https://audio-turbo.api.fireworks.ai/v1";
const FIREWORKS_MODEL = "whisper-v3-turbo";
const TRANSCRIPTION_AUDIO_EXTENSION = ".mp3";
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mpeg", ".mpg"]);
const SEGMENT_PROMPT =
  "From the provided podcast transcript, please output all of the advertisement segments. Output them verbatim. Output them as an array of strings with each string being a segment. If a segment is repeated exactly in another part of the transcript, only output it once. DO NOT OUTPUT THEM IN ANY CODEBLOCKS OR BACKTICKS OR ANYTHING, JUST THE ARRAY OF SEGMENTS AS YOUR RESPONSE. This is going into a safety-critical system so it cannot have any code blocks or backticks. Do not change the segments' case, punctuation or capitalization.";

export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

type TranscriptionResult = {
  text: string;
  words: TranscriptWord[];
};

type ProcessMediaResult = {
  fileData: Uint8Array;
  originalFilename: string;
  downloadFilename: string;
  adSegmentsFound: number;
  responseContentType: string;
};

type TimestampTuple = [number, number];
type KeepRange = {
  start: number;
  duration?: number;
};
type MediaKind = "audio" | "video";

let openAiClient: OpenAI | null = null;
let fireworksClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI {
  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: config.openAiApiKey,
    });
  }

  return openAiClient;
}

function getFireworksClient(): OpenAI {
  if (!fireworksClient) {
    fireworksClient = new OpenAI({
      apiKey: config.fireworksApiKey,
      baseURL: FIREWORKS_BASE_URL,
    });
  }

  return fireworksClient;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sanitizeFilename(filename: string): string {
  const safeBase = basename(filename)
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");

  return safeBase;
}

function buildDownloadFilename(originalFilename: string): string {
  const parsed = parse(originalFilename);
  if (!parsed.ext) {
    return `${originalFilename}[trimmed]`;
  }

  return `${parsed.name}[trimmed]${parsed.ext}`;
}

function quoteCommandArg(value: string): string {
  if (/^[A-Za-z0-9_./:[\]-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatCommandForLog(command: string[]): string {
  return command.map(quoteCommandArg).join(" ");
}

function createUploadPaths(file: File): {
  originalFilename: string;
  inputPath: string;
  outputPath: string;
  transcriptionAudioPath: string;
} {
  const fallbackName = `upload_${randomUUID().replaceAll("-", "")}`;
  const originalFilename = basename(file.name) || fallbackName;
  const safeFilename = sanitizeFilename(originalFilename) || fallbackName;
  const uniqueId = randomUUID().replaceAll("-", "");
  const inputPath = join(UPLOADS_DIR, `${uniqueId}_${safeFilename}`);
  const outputPath = `${inputPath.slice(0, Math.max(0, inputPath.length - extname(inputPath).length))}_edited${extname(inputPath)}`;
  const transcriptionAudioPath = `${inputPath.slice(0, Math.max(0, inputPath.length - extname(inputPath).length))}_transcription${TRANSCRIPTION_AUDIO_EXTENSION}`;

  return {
    originalFilename,
    inputPath,
    outputPath,
    transcriptionAudioPath,
  };
}

async function safeDelete(...paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await unlink(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && code !== "ENOENT") {
          logWarning("Failed to delete temporary file %s: %s", path, getErrorMessage(error));
        }
      }
    }),
  );
}

function normalizeSegmentsToRemove(segmentsToRemove: TimestampTuple[]): TimestampTuple[] {
  if (!Array.isArray(segmentsToRemove) || segmentsToRemove.length === 0) {
    throw new Error("segments_to_remove must be a non-empty list of (start, end) tuples");
  }

  const sortedSegments = [...segmentsToRemove].sort((left, right) => {
    if (left[0] !== right[0]) {
      return left[0] - right[0];
    }

    return left[1] - right[1];
  });

  const normalized: TimestampTuple[] = [];

  for (const [index, [start, end]] of sortedSegments.entries()) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Segment ${index}: Start and end times must be numbers`);
    }

    if (start >= end) {
      throw new Error(`Segment ${index}: Start time (${start}) must be less than end time (${end})`);
    }

    const previous = normalized.at(-1);
    if (!previous) {
      normalized.push([start, end]);
      continue;
    }

    if (start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
      continue;
    }

    normalized.push([start, end]);
  }

  return normalized;
}

function findPhraseTimestamps(transcriptData: TranscriptWord[], phrases: string[] | string): TimestampTuple[] {
  if (!transcriptData.length || !phrases) {
    return [];
  }

  const phraseList = typeof phrases === "string" ? [phrases] : phrases;
  const transcriptWords = transcriptData.map((item) => ({
    word: item.word.trim().toLowerCase().replace(/[.,:;!?]+$/g, ""),
    start: item.start,
    end: item.end,
  }));

  const results: TimestampTuple[] = [];

  for (const phrase of phraseList) {
    if (!phrase) {
      continue;
    }

    const targetWords = phrase
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase().replace(/[.,:;!?]+$/g, ""))
      .filter(Boolean);

    if (targetWords.length === 0) {
      continue;
    }

    for (let index = 0; index <= transcriptWords.length - targetWords.length; index += 1) {
      let matched = true;

      for (let offset = 0; offset < targetWords.length; offset += 1) {
        if (transcriptWords[index + offset]?.word !== targetWords[offset]) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      const start = transcriptWords[index]?.start;
      const end = transcriptWords[index + targetWords.length - 1]?.end;
      if (start !== undefined && end !== undefined) {
        results.push([start, end]);
      }
    }
  }

  return results;
}

function generateFfmpegTrimArgs(
  inputPath: string,
  outputPath: string,
  segmentsToRemove: TimestampTuple[],
): string[] {
  if (!inputPath || !outputPath) {
    throw new Error("Input and output file paths must be provided");
  }

  const normalizedSegments = normalizeSegmentsToRemove(segmentsToRemove);
  const filterParts: string[] = [];
  const segmentLabels: string[] = [];

  filterParts.push(`[0:a]atrim=0:${normalizedSegments[0]?.[0]}[s0]`);
  segmentLabels.push("[s0]");

  for (let index = 0; index < normalizedSegments.length - 1; index += 1) {
    const currentEnd = normalizedSegments[index]?.[1];
    const nextStart = normalizedSegments[index + 1]?.[0];

    if (currentEnd === undefined || nextStart === undefined) {
      continue;
    }

    if (currentEnd < nextStart) {
      filterParts.push(`[0:a]atrim=${currentEnd}:${nextStart}[s${index + 1}]`);
      segmentLabels.push(`[s${index + 1}]`);
    }
  }

  filterParts.push(
    `[0:a]atrim=start=${normalizedSegments[normalizedSegments.length - 1]?.[1]}[s${normalizedSegments.length}]`,
  );
  segmentLabels.push(`[s${normalizedSegments.length}]`);

  const filterComplex = `${filterParts.join(";")};${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=0:a=1[out]`;

  return [
    "ffmpeg",
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[out]",
    outputPath,
  ];
}

function generateVideoFfmpegTrimArgs(
  inputPath: string,
  outputPath: string,
  segmentsToRemove: TimestampTuple[],
): string[] {
  if (!inputPath || !outputPath) {
    throw new Error("Input and output file paths must be provided");
  }

  const keepRanges = buildKeepRanges(segmentsToRemove);
  if (keepRanges.length === 0) {
    throw new Error("No video ranges to keep");
  }

  const filterParts: string[] = [];
  const concatLabels: string[] = [];

  for (let index = 0; index < keepRanges.length; index += 1) {
    const keepRange = keepRanges[index];
    if (!keepRange) {
      continue;
    }

    const videoTrim =
      keepRange.duration === undefined
        ? `trim=start=${keepRange.start}`
        : `trim=start=${keepRange.start}:end=${keepRange.start + keepRange.duration}`;
    const audioTrim =
      keepRange.duration === undefined
        ? `atrim=start=${keepRange.start}`
        : `atrim=start=${keepRange.start}:end=${keepRange.start + keepRange.duration}`;

    filterParts.push(`[0:v:0]${videoTrim},setpts=PTS-STARTPTS[v${index}]`);
    filterParts.push(`[0:a:0]${audioTrim},asetpts=PTS-STARTPTS[a${index}]`);
    concatLabels.push(`[v${index}]`, `[a${index}]`);
  }

  const filterComplex = `${filterParts.join(";")};${concatLabels.join("")}concat=n=${keepRanges.length}:v=1:a=1[outv][outa]`;

  return [
    "ffmpeg",
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    outputPath,
  ];
}

function buildKeepRanges(segmentsToRemove: TimestampTuple[]): KeepRange[] {
  const normalizedSegments = normalizeSegmentsToRemove(segmentsToRemove);
  const keepRanges: KeepRange[] = [];

  const firstStart = normalizedSegments[0]?.[0];
  if (firstStart !== undefined && firstStart > 0) {
    keepRanges.push({
      start: 0,
      duration: firstStart,
    });
  }

  for (let index = 0; index < normalizedSegments.length - 1; index += 1) {
    const currentEnd = normalizedSegments[index]?.[1];
    const nextStart = normalizedSegments[index + 1]?.[0];

    if (currentEnd === undefined || nextStart === undefined || currentEnd >= nextStart) {
      continue;
    }

    keepRanges.push({
      start: currentEnd,
      duration: nextStart - currentEnd,
    });
  }

  const lastEnd = normalizedSegments[normalizedSegments.length - 1]?.[1];
  if (lastEnd !== undefined) {
    keepRanges.push({
      start: lastEnd,
    });
  }

  return keepRanges;
}

function escapeConcatFilePath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

function buildConcatFileContents(paths: string[]): string {
  return paths.map((path) => `file '${escapeConcatFilePath(resolve(path))}'`).join("\n");
}

function buildFastTrimSegmentPath(outputPath: string, index: number): string {
  const parsed = parse(outputPath);
  const extension = parsed.ext || ".mp3";
  return join(parsed.dir, `${parsed.name}_keep_${index}${extension}`);
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) {
    return true;
  }

  const extension = extname(file.name).toLowerCase();
  return VIDEO_EXTENSIONS.has(extension);
}

function getMediaKind(file: File): MediaKind {
  return isVideoFile(file) ? "video" : "audio";
}

function getResponseContentType(file: File, mediaKind: MediaKind): string {
  if (file.type) {
    return file.type;
  }

  const extension = extname(file.name).toLowerCase();

  if (extension === ".mp4" || extension === ".m4v") {
    return "video/mp4";
  }

  if (extension === ".mov") {
    return "video/quicktime";
  }

  if (extension === ".mkv") {
    return "video/x-matroska";
  }

  if (extension === ".webm") {
    return "video/webm";
  }

  if (extension === ".avi") {
    return "video/x-msvideo";
  }

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".m4a") {
    return "audio/mp4";
  }

  if (extension === ".aac") {
    return "audio/aac";
  }

  if (extension === ".ogg") {
    return "audio/ogg";
  }

  if (extension === ".flac") {
    return "audio/flac";
  }

  if (mediaKind === "video") {
    return "video/mp4";
  }

  return "audio/mpeg";
}

async function extractAudioForTranscription(inputPath: string, outputPath: string): Promise<void> {
  const command = [
    "ffmpeg",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    outputPath,
  ];

  logInfo("FFmpeg transcription-audio command: %s", formatCommandForLog(command));

  try {
    await runFfmpeg(command);
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("Stream map") || message.includes("matches no streams")) {
      throw new Error("Uploaded file does not contain a usable audio stream");
    }

    throw error;
  }
}

async function runPreciseTrim(
  inputPath: string,
  outputPath: string,
  segmentsToRemove: TimestampTuple[],
  mediaKind: MediaKind,
): Promise<void> {
  let ffmpegCommand: string[];
  try {
    ffmpegCommand =
      mediaKind === "video"
        ? generateVideoFfmpegTrimArgs(inputPath, outputPath, segmentsToRemove)
        : generateFfmpegTrimArgs(inputPath, outputPath, segmentsToRemove);
  } catch (error) {
    throw new Error(`Error generating FFmpeg command: ${getErrorMessage(error)}`);
  }

  logInfo("FFmpeg command: %s", formatCommandForLog(ffmpegCommand));
  logInfo("Executing FFmpeg...");
  await runFfmpeg(ffmpegCommand);
  logInfo("FFmpeg completed successfully");
}

async function runFastTrim(
  inputPath: string,
  outputPath: string,
  segmentsToRemove: TimestampTuple[],
  mediaKind: MediaKind,
): Promise<void> {
  const keepRanges = buildKeepRanges(segmentsToRemove);
  if (keepRanges.length === 0) {
    logWarning("Fast FFmpeg mode produced no keep ranges, falling back to precise trim mode");
    await runPreciseTrim(inputPath, outputPath, segmentsToRemove, mediaKind);
    return;
  }

  const segmentPaths = keepRanges.map((_, index) => buildFastTrimSegmentPath(outputPath, index));
  const concatFilePath = join(parse(outputPath).dir, `${parse(outputPath).name}_concat.txt`);

  try {
    for (const [index, keepRange] of keepRanges.entries()) {
      const segmentCommand = ["ffmpeg", "-y"];

      if (keepRange.start > 0) {
        segmentCommand.push("-ss", String(keepRange.start));
      }

      if (keepRange.duration !== undefined) {
        segmentCommand.push("-to", String(keepRange.start + keepRange.duration));
      }

      segmentCommand.push("-i", inputPath);
      if (mediaKind === "video") {
        segmentCommand.push("-map", "0:v:0", "-map", "0:a:0");
      } else {
        segmentCommand.push("-map", "0:a:0");
      }
      segmentCommand.push("-c", "copy", segmentPaths[index] ?? outputPath);

      logInfo("Fast FFmpeg segment command: %s", formatCommandForLog(segmentCommand));
      await runFfmpeg(segmentCommand);
    }

    const concatFileContents = `${buildConcatFileContents(segmentPaths)}\n`;
    await Bun.write(concatFilePath, concatFileContents);

    const concatCommand = [
      "ffmpeg",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFilePath,
      "-c",
      "copy",
      outputPath,
    ];

    logInfo("Fast FFmpeg concat command: %s", formatCommandForLog(concatCommand));
    logInfo("Executing FFmpeg...");
    await runFfmpeg(concatCommand);
    logInfo("FFmpeg completed successfully");
  } finally {
    await safeDelete(concatFilePath, ...segmentPaths);
  }
}

function toTimestampRanges(segments: TimestampTuple[]): TimestampRange[] {
  return segments.map(([start, end]) => ({ start, end }));
}

function fromTimestampRanges(segments: TimestampRange[]): TimestampTuple[] {
  return segments.map(({ start, end }) => [start, end]);
}

async function calculateFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function transcribe(filePath: string, contentType: string): Promise<TranscriptionResult> {
  const file = new File([Bun.file(filePath)], basename(filePath), {
    type: contentType || "application/octet-stream",
  });
  const response = await getFireworksClient().audio.transcriptions.create({
    model: FIREWORKS_MODEL,
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  } as never);

  const words = Array.isArray((response as { words?: Array<{ word: string; start: number; end: number }> }).words)
    ? ((response as { words?: Array<{ word: string; start: number; end: number }> }).words ?? []).map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end,
      }))
    : [];

  return {
    text: (response as { text?: string }).text ?? "",
    words,
  };
}

async function extractAdSegments(transcriptionText: string): Promise<string[]> {
  const response = await getOpenAiClient().responses.create({
    model: config.openAiModel,
    reasoning: {
      effort: config.reasoningEffort as "minimal" | "low" | "medium" | "high",
      summary: "auto",
    },
    input: [
      {
        role: "developer",
        content: SEGMENT_PROMPT,
      },
      {
        role: "user",
        content: transcriptionText,
      },
    ],
  });

  const outputText = response.output_text ?? "";

  try {
    const parsed = JSON.parse(outputText) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    logWarning("Failed to parse OpenAI response as JSON, treating as no segments");
    return [];
  }
}

async function copyFile(inputPath: string, outputPath: string): Promise<void> {
  await Bun.write(outputPath, Bun.file(inputPath));
}

async function runFfmpeg(command: string[]): Promise<void> {
  const process = Bun.spawn({
    cmd: command,
    stdout: "ignore",
    stderr: "pipe",
    timeout: config.ffmpegTimeoutMs,
  });

  const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve("");
  await process.exited;
  const stderr = await stderrPromise;

  if (process.exitCode !== 0) {
    throw new Error(`FFmpeg command failed: ${stderr || `ffmpeg exited with code ${process.exitCode}`}`);
  }
}

export async function processUploadedMedia(file: File, apiKeyId: number): Promise<ProcessMediaResult> {
  if (!file.name) {
    throw new Error("No selected file");
  }

  await mkdir(UPLOADS_DIR, { recursive: true });

  const { originalFilename, inputPath, outputPath, transcriptionAudioPath } = createUploadPaths(file);
  const mediaKind = getMediaKind(file);
  const responseContentType = getResponseContentType(file, mediaKind);

  await Bun.write(inputPath, file);
  logInfo("Saved uploaded file: %s -> %s", originalFilename, inputPath);

  try {
    const fileHash = await calculateFileHash(inputPath);
    logInfo("Calculated SHA-256 hash for %s: %s", originalFilename, fileHash);

    const cachedEntry = await getEntryByHash(apiKeyId, fileHash);
    let normalizedMatches: TimestampTuple[] = [];
    let transcriptionText: string | null = null;

    if (cachedEntry) {
      normalizedMatches =
        cachedEntry.ad_timestamps.length > 0
          ? normalizeSegmentsToRemove(fromTimestampRanges(cachedEntry.ad_timestamps))
          : [];
      transcriptionText = cachedEntry.transcription;

      logInfo(
        "Cache hit for file hash %s. Reusing %s stored trim ranges and skipping transcription/ad extraction.",
        fileHash,
        normalizedMatches.length,
      );
    } else {
      logInfo("Cache miss for file hash %s. Starting transcription...", fileHash);
      await extractAudioForTranscription(inputPath, transcriptionAudioPath);
      const transcription = await transcribe(transcriptionAudioPath, "audio/mpeg");
      transcriptionText = transcription.text;
      logInfo(
        "Transcription complete. Text length: %s, Words: %s",
        transcription.text.length,
        transcription.words.length,
      );

      let adSegments: string[];
      try {
        logInfo("Sending transcription to OpenAI for ad segment detection...");
        adSegments = await extractAdSegments(transcription.text);
        logInfo("Received ad-segment response from OpenAI");
        logInfo("Parsed %s ad segments", adSegments.length);
      } catch (error) {
        throw new Error(`Error from OpenAI: ${getErrorMessage(error)}`);
      }

      const rawMatches = findPhraseTimestamps(transcription.words, adSegments);
      normalizedMatches = rawMatches.length > 0 ? normalizeSegmentsToRemove(rawMatches) : [];
      logInfo(
        "Found %s raw matching timestamp ranges, normalized to %s trim ranges: %o",
        rawMatches.length,
        normalizedMatches.length,
        normalizedMatches,
      );
    }

    if (normalizedMatches.length === 0) {
      if (cachedEntry) {
        logInfo("Cached entry has no ad segments to trim, copying original file");
      } else {
        logInfo("No ad segments found, copying original file");
      }
      await copyFile(inputPath, outputPath);
    } else {
      if (config.fasterFfmpegEnabled) {
        logInfo("Using faster FFmpeg stream-copy trim mode");
        await runFastTrim(inputPath, outputPath, normalizedMatches, mediaKind);
      } else {
        logInfo("Using precise FFmpeg trim mode");
        await runPreciseTrim(inputPath, outputPath, normalizedMatches, mediaKind);
      }
    }

    let fileData: Uint8Array;
    try {
      fileData = await Bun.file(outputPath).bytes();
    } catch (error) {
      throw new Error(`Error reading output file: ${getErrorMessage(error)}`);
    }

    await upsertEntry(
      apiKeyId,
      originalFilename,
      fileHash,
      normalizedMatches.length,
      toTimestampRanges(normalizedMatches),
      transcriptionText,
    );

    return {
      fileData,
      originalFilename,
      downloadFilename: buildDownloadFilename(originalFilename),
      adSegmentsFound: normalizedMatches.length,
      responseContentType,
    };
  } finally {
    await safeDelete(inputPath, outputPath, transcriptionAudioPath);
  }
}

export {
  buildDownloadFilename,
  findPhraseTimestamps,
  formatCommandForLog,
  generateFfmpegTrimArgs,
  getErrorMessage,
  normalizeSegmentsToRemove,
  sanitizeFilename,
};
