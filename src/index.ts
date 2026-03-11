import app from "./app.ts";
import { config } from "./config.ts";
import { initDb } from "./db.ts";
import { logInfo } from "./logger.ts";

await initDb();

logInfo("OPENAI_API_KEY configured: %s", Boolean(config.openAiApiKey));
logInfo("FIREWORKS_API_KEY configured: %s", Boolean(config.fireworksApiKey));
logInfo("OPENAI_MODEL from .env %s", config.openAiModel);
logInfo("REASONING_EFFORT from .env %s", config.reasoningEffort);
logInfo("FASTER_FFMPEG_ENABLED from .env %s", config.fasterFfmpegEnabled);
logInfo("RATE_LIMIT_ENABLED from .env %s", config.rateLimitEnabled);
logInfo("RATE_LIMIT_WINDOW_SECONDS from .env %s", config.rateLimitWindowSeconds);
logInfo("RATE_LIMIT_MAX_REQUESTS from .env %s", config.rateLimitMaxRequests);
logInfo("Starting Bun/Hono server on port %s", config.port);

export default {
  port: config.port,
  maxRequestBodySize: config.maxRequestBodySizeBytes,
  fetch(request: Request, server: Bun.Server<unknown>) {
    return app.fetch(request, {
      ip: server.requestIP(request),
    });
  },
};
