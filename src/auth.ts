import { createMiddleware } from "hono/factory";

import { getPublicIdFromApiKey, hashApiKey } from "./api-keys.ts";
import { findActiveApiKeyByToken, touchApiKeyLastUsed } from "./db.ts";

function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.trim().split(/\s+/, 2);
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export const apiKeyAuthMiddleware = createMiddleware<{
  Variables: {
    apiKeyId: number;
    apiKeyPublicId: string;
  };
}>(async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const token = readBearerToken(c.req.header("Authorization"));
  if (!token) {
    c.header("WWW-Authenticate", 'Bearer realm="ad-segment-trimmer"');
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const publicId = getPublicIdFromApiKey(token);
  if (!publicId) {
    c.header("WWW-Authenticate", 'Bearer realm="ad-segment-trimmer"');
    return c.json({ error: "Invalid API key format" }, 401);
  }

  const apiKey = await findActiveApiKeyByToken(publicId, hashApiKey(token));
  if (!apiKey) {
    c.header("WWW-Authenticate", 'Bearer realm="ad-segment-trimmer"');
    return c.json({ error: "Invalid API key" }, 401);
  }

  await touchApiKeyLastUsed(apiKey.id);

  c.set("apiKeyId", apiKey.id);
  c.set("apiKeyPublicId", apiKey.public_id);

  await next();
});
