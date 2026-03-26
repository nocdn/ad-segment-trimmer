const DEFAULT_PORT = 7070;
const DEFAULT_MAX_REQUEST_BODY_SIZE_MB = 1024;
const DEFAULT_FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10;
const DEFAULT_TRANSCRIPTION_PROVIDER = "fireworks";

export type TranscriptionProvider = "fireworks" | "mistral";

function getEnv(name: string): string | undefined {
  return Bun.env[name];
}

export function getRequiredEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  return value.toLowerCase() === "true";
}

export function parseIntegerEnv(name: string, defaultValue: number): number {
  const value = getEnv(name);
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseTranscriptionProviderEnv(): TranscriptionProvider {
  const value = getEnv("TRANSCRIPTION_PROVIDER");

  if (!value) {
    return DEFAULT_TRANSCRIPTION_PROVIDER;
  }

  if (value === "fireworks" || value === "mistral") {
    return value;
  }

  throw new Error('TRANSCRIPTION_PROVIDER must be either "fireworks" or "mistral"');
}

export const config = {
  port: parseIntegerEnv("PORT", DEFAULT_PORT),
  maxRequestBodySizeBytes:
    parseIntegerEnv("MAX_REQUEST_BODY_SIZE_MB", DEFAULT_MAX_REQUEST_BODY_SIZE_MB) * 1024 * 1024,
  ffmpegTimeoutMs: parseIntegerEnv("FFMPEG_TIMEOUT_MS", DEFAULT_FFMPEG_TIMEOUT_MS),
  fasterFfmpegEnabled: parseBooleanEnv("FASTER_FFMPEG_ENABLED", true),
  rateLimitEnabled: parseBooleanEnv("RATE_LIMIT_ENABLED", true),
  rateLimitWindowSeconds: parseIntegerEnv("RATE_LIMIT_WINDOW_SECONDS", DEFAULT_RATE_LIMIT_WINDOW_SECONDS),
  rateLimitMaxRequests: parseIntegerEnv("RATE_LIMIT_MAX_REQUESTS", DEFAULT_RATE_LIMIT_MAX_REQUESTS),
  openAiApiKey: getEnv("OPENAI_API_KEY"),
  fireworksApiKey: getEnv("FIREWORKS_API_KEY"),
  mistralApiKey: getEnv("MISTRAL_API_KEY"),
  transcriptionProvider: parseTranscriptionProviderEnv(),
  openAiModel: getEnv("OPENAI_MODEL") ?? "gpt-5-mini",
  reasoningEffort: getEnv("REASONING_EFFORT") ?? "low",
} as const;
