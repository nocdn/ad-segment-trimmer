import { revokeApiKey, initDb } from "../src/db.ts";

const publicId = Bun.argv[2]?.trim();

if (!publicId) {
  console.error('Usage: bun run revoke-api-key "<public_id>"');
  process.exit(1);
}

await initDb();

const revoked = await revokeApiKey(publicId);

if (!revoked) {
  console.error(`No active API key found for public id: ${publicId}`);
  process.exit(1);
}

console.log(`Revoked API key: ${publicId}`);
