import { initDb, rotateApiKey } from "../src/db.ts";

const publicId = Bun.argv[2]?.trim();

if (!publicId) {
  console.error('Usage: bun run rotate-api-key "<public_id>"');
  process.exit(1);
}

await initDb();

const result = await rotateApiKey(publicId);

console.log("API key rotated");
console.log(`old public id: ${result.oldEntry.public_id}`);
console.log(`new public id: ${result.newEntry.public_id}`);
console.log(`name: ${result.newEntry.name}`);
console.log(`created at: ${result.newEntry.created_at}`);
console.log("");
console.log("Save this new key now. It will not be shown again:");
console.log(result.key);
