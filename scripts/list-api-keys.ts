import { getAllApiKeys, initDb } from "../src/db.ts";

await initDb();

const apiKeys = await getAllApiKeys();

if (apiKeys.length === 0) {
  console.log("No API keys found");
  process.exit(0);
}

for (const apiKey of apiKeys) {
  const status = apiKey.revoked_at ? "revoked" : "active";
  console.log(
    [
      `id=${apiKey.id}`,
      `name=${JSON.stringify(apiKey.name)}`,
      `public_id=${apiKey.public_id}`,
      `status=${status}`,
      `created_at=${apiKey.created_at}`,
      `last_used_at=${apiKey.last_used_at ?? "never"}`,
      `revoked_at=${apiKey.revoked_at ?? "null"}`,
    ].join(" "),
  );
}
