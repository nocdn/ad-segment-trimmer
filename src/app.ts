import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

import { apiKeyAuthMiddleware } from "./auth.ts";
import { config } from "./config.ts";
import { deleteEntry, getAllEntries } from "./db.ts";
import { getHealthStatus } from "./health.ts";
import { logError, logInfo } from "./logger.ts";
import { processUploadedAudio, getErrorMessage } from "./processing.ts";
import { rateLimitMiddleware } from "./rate-limit.ts";

const app = new Hono<{
  Variables: {
    apiKeyId: number;
    apiKeyPublicId: string;
  };
}>();

app.use("*", cors());

app.use("*", async (c, next) => {
  const startedAt = performance.now();
  await next();

  if (c.req.method === "GET" && c.req.path === "/history") {
    return;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  logInfo('%s %s %s %sms', c.req.method, c.req.path, c.res.status, durationMs);
});

app.get("/health", async (c) => {
  const health = await getHealthStatus();
  const statusCode = health.status === "ok" ? 200 : 503;
  return c.json(health, statusCode);
});

app.use("*", apiKeyAuthMiddleware);
app.use("*", rateLimitMiddleware);

app.post(
  "/process",
  bodyLimit({
    maxSize: config.maxRequestBodySizeBytes,
    onError: (c) => c.json({ error: "File too large" }, 413),
  }),
  async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;

    if (!(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }

    if (!file.name) {
      return c.json({ error: "No selected file" }, 400);
    }

    try {
      const result = await processUploadedAudio(file, c.get("apiKeyId"));

      return new Response(result.audioData, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(result.audioData.byteLength),
          "Content-Disposition": `attachment; filename="${result.downloadFilename.replace(/["\\]/g, "\\$&")}"`,
        },
      });
    } catch (error) {
      const message = getErrorMessage(error);

      if (message === "No selected file") {
        return c.json({ error: message }, 400);
      }

      if (
        message.startsWith("Error from OpenAI:") ||
        message.startsWith("Error generating FFmpeg command:") ||
        message.startsWith("FFmpeg command failed:") ||
        message.startsWith("Error reading output file:")
      ) {
        logError("Audio processing failed: %s", message);
        return c.json({ error: message }, 500);
      }

      if (message.includes("Authentication") || message.includes("API key")) {
        logError("Transcription or OpenAI authentication failed: %s", message);
      } else {
        logError("Audio processing failed: %s", message);
      }

      return c.json({ error: message }, 500);
    }
  },
);

app.get("/history", async (c) => {
  const entries = await getAllEntries(c.get("apiKeyId"));
  return c.json(entries);
});

app.delete("/history/:entryId", async (c) => {
  const entryId = Number.parseInt(c.req.param("entryId"), 10);
  if (Number.isNaN(entryId)) {
    return c.json({ error: "Entry not found" }, 404);
  }

  const deleted = await deleteEntry(c.get("apiKeyId"), entryId);
  if (!deleted) {
    return c.json({ error: "Entry not found" }, 404);
  }

  return c.json({ message: "Entry deleted" });
});

app.onError((error, c) => {
  logError("Unhandled request error for %s %s: %s", c.req.method, c.req.path, getErrorMessage(error));
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
