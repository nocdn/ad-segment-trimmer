import { createApiKeyEntry, initDb } from "../src/db.ts";

const name = Bun.argv[2]?.trim();

if (!name) {
  console.error('Usage: bun run create-api-key "<name>"');
  process.exit(1);
}

await initDb();

const result = await createApiKeyEntry(name);

console.log("API key created");
console.log(`name: ${result.entry.name}`);
console.log(`public id: ${result.entry.public_id}`);
console.log(`created at: ${result.entry.created_at}`);
console.log("");
console.log("Save this key now. It will not be shown again:");
console.log(result.key);
