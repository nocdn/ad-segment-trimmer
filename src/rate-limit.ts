import { createMiddleware } from "hono/factory";

import { config } from "./config.ts";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const entries = new Map();

function getWindowMs(): number {
  return config.rateLimitWindowSeconds * 1000;
}

function getEntry(key: string): RateLimitEntry {
  const now = Date.now();
  const existing = entries.get(key);

  if (!existing || now >= existing.resetAt) {
    const nextEntry = {
      count: 0,
      resetAt: now + getWindowMs(),
    };
    entries.set(key, nextEntry);
    return nextEntry;
  }

  return existing;
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  if (!config.rateLimitEnabled) {
    await next();
    return;
  }

  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const key = c.get("apiKeyPublicId");
  const entry = getEntry(key);

  if (entry.count >= config.rateLimitMaxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - Date.now()) / 1000),
    );
    c.header("Retry-After", String(retryAfterSeconds));
    c.header("X-RateLimit-Limit", String(config.rateLimitMaxRequests));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  entry.count += 1;

  c.header("X-RateLimit-Limit", String(config.rateLimitMaxRequests));
  c.header(
    "X-RateLimit-Remaining",
    String(Math.max(0, config.rateLimitMaxRequests - entry.count)),
  );
  c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  await next();
});
