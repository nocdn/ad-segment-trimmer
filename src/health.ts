import { config } from "./config.ts";
import { checkDatabaseHealth } from "./db.ts";

type CheckStatus = "ok" | "error";

type HealthCheck = {
  status: CheckStatus;
  message: string;
};

type HealthResponse = {
  status: "ok" | "error";
  timestamp: string;
  uptime_seconds: number;
  checks: {
    service: HealthCheck;
    database: HealthCheck;
    ffmpeg: HealthCheck;
    openai_api_key: HealthCheck;
    transcription_provider: HealthCheck;
    rate_limit: HealthCheck;
  };
};

async function checkFfmpegHealth(): Promise<HealthCheck> {
  try {
    const process = Bun.spawn({
      cmd: ["ffmpeg", "-version"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });

    const stdoutPromise = process.stdout ? new Response(process.stdout).text() : Promise.resolve("");
    const stderrPromise = process.stderr ? new Response(process.stderr).text() : Promise.resolve("");

    await process.exited;

    if (process.exitCode !== 0) {
      const stderr = await stderrPromise;
      return {
        status: "error",
        message: stderr.trim() || `ffmpeg exited with code ${process.exitCode}`,
      };
    }

    const stdout = await stdoutPromise;
    const versionLine = stdout.trim().split("\n")[0] ?? "ffmpeg is available";

    return {
      status: "ok",
      message: versionLine,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkConfigured(value: string | undefined, name: string): HealthCheck {
  if (!value) {
    return {
      status: "error",
      message: `${name} is not configured`,
    };
  }

  return {
    status: "ok",
    message: `${name} is configured`,
  };
}

function checkTranscriptionProvider(): HealthCheck {
  const provider = config.transcriptionProvider;

  if (provider === "mistral") {
    const keyCheck = checkConfigured(config.mistralApiKey, "MISTRAL_API_KEY");
    return {
      status: keyCheck.status,
      message: `provider: mistral - ${keyCheck.message}`,
    };
  }

  const keyCheck = checkConfigured(config.fireworksApiKey, "FIREWORKS_API_KEY");
  return {
    status: keyCheck.status,
    message: `provider: fireworks - ${keyCheck.message}`,
  };
}

export async function getHealthStatus(): Promise<HealthResponse> {
  const databaseCheck = await checkDatabaseHealth();
  const ffmpegCheck = await checkFfmpegHealth();
  const openAiCheck = checkConfigured(config.openAiApiKey, "OPENAI_API_KEY");
  const transcriptionProviderCheck = checkTranscriptionProvider();
  const rateLimitCheck = {
    status: "ok" as const,
    message: config.rateLimitEnabled
      ? `enabled: ${config.rateLimitMaxRequests} requests per ${config.rateLimitWindowSeconds} seconds`
      : "disabled",
  };

  const checks = {
    service: {
      status: "ok" as const,
      message: "service is running",
    },
    database: databaseCheck,
    ffmpeg: ffmpegCheck,
    openai_api_key: openAiCheck,
    transcription_provider: transcriptionProviderCheck,
    rate_limit: rateLimitCheck,
  };

  const overallStatus =
    databaseCheck.status === "ok" &&
    ffmpegCheck.status === "ok" &&
    openAiCheck.status === "ok" &&
    transcriptionProviderCheck.status === "ok"
      ? "ok"
      : "error";

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
  };
}
