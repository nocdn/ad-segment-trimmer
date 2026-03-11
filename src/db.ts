import { SQL } from "bun";

import { generateApiKey } from "./api-keys.ts";
import { getRequiredEnv } from "./config.ts";
import { logWarning } from "./logger.ts";

const EXPECTED_HISTORY_COLUMNS = new Set([
  "id",
  "api_key_id",
  "filename",
  "file_hash",
  "created_at",
  "ad_segments_found",
  "ad_timestamps",
  "transcription",
]);
const EXPECTED_API_KEY_COLUMNS = new Set([
  "id",
  "name",
  "public_id",
  "key_hash",
  "created_at",
  "last_used_at",
  "revoked_at",
]);

export type TimestampRange = {
  start: number;
  end: number;
};

export type HistoryEntry = {
  id: number;
  filename: string;
  file_hash: string;
  created_at: string;
  ad_segments_found: number;
  ad_timestamps: TimestampRange[];
  transcription: string | null;
};

type HistoryRow = {
  id: number;
  api_key_id: number;
  filename: string;
  file_hash: string;
  created_at: Date | string;
  ad_segments_found: number;
  ad_timestamps: TimestampRange[] | string | null;
  transcription: string | null;
};

export type ApiKeyEntry = {
  id: number;
  name: string;
  public_id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ApiKeyRow = {
  id: number;
  name: string;
  public_id: string;
  key_hash: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
};

let sqlClient: SQL | null = null;

function getSql(): SQL {
  if (!sqlClient) {
    sqlClient = new SQL(getRequiredEnv("DATABASE_URL"));
  }

  return sqlClient;
}

function sameColumns(actual: Set<string>, expected: Set<string>): boolean {
  if (actual.size !== expected.size) {
    return false;
  }

  for (const column of actual) {
    if (!expected.has(column)) {
      return false;
    }
  }

  return true;
}

function toUtcIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace("Z", "+00:00");
}

function normalizeAdTimestamps(value: TimestampRange[] | string | null): TimestampRange[] {
  if (!value) {
    return [];
  }

  const parsed = Array.isArray(value) ? value : (() => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  })();

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (Array.isArray(item) && item.length === 2) {
      const [start, end] = item;
      if (typeof start === "number" && typeof end === "number") {
        return [{ start, end }];
      }
    }

    if (
      item &&
      typeof item === "object" &&
      "start" in item &&
      "end" in item &&
      typeof item.start === "number" &&
      typeof item.end === "number"
    ) {
      return [{ start: item.start, end: item.end }];
    }

    return [];
  });
}

function mapHistoryRow(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    filename: row.filename,
    file_hash: row.file_hash,
    created_at: toUtcIsoString(row.created_at),
    ad_segments_found: row.ad_segments_found,
    ad_timestamps: normalizeAdTimestamps(row.ad_timestamps),
    transcription: row.transcription,
  };
}

async function createHistoryTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE history (
      id SERIAL PRIMARY KEY,
      api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ad_segments_found INTEGER NOT NULL DEFAULT 0,
      ad_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcription TEXT,
      UNIQUE (api_key_id, file_hash)
    )
  `;
}

async function createApiKeysTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE api_keys (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `;
}

export async function initDb(): Promise<void> {
  const sql = getSql();

  const existingApiKeyColumns = await sql<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
  `;
  const actualApiKeyColumns = new Set(existingApiKeyColumns.map((row) => row.column_name));

  if (actualApiKeyColumns.size > 0 && !sameColumns(actualApiKeyColumns, EXPECTED_API_KEY_COLUMNS)) {
    logWarning(
      "Recreating api_keys table due to schema mismatch. Existing columns: %o",
      [...actualApiKeyColumns].sort(),
    );
    await sql`DROP TABLE IF EXISTS history`;
    await sql`DROP TABLE IF EXISTS api_keys`;
  }

  const existingColumns = await sql<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history'
  `;
  const actualColumns = new Set(existingColumns.map((row) => row.column_name));

  if (actualColumns.size > 0 && !sameColumns(actualColumns, EXPECTED_HISTORY_COLUMNS)) {
    logWarning(
      "Recreating history table due to schema mismatch. Existing columns: %o",
      [...actualColumns].sort(),
    );
    await sql`DROP TABLE IF EXISTS history`;
  }

  const apiKeysTableExists = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AS exists
  `;

  if (!apiKeysTableExists[0]?.exists) {
    await createApiKeysTable();
  }

  const tableExists = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'history'
    ) AS exists
  `;

  if (!tableExists[0]?.exists) {
    await createHistoryTable();
  }
}

function mapApiKeyRow(row: ApiKeyRow): ApiKeyEntry {
  return {
    id: row.id,
    name: row.name,
    public_id: row.public_id,
    created_at: toUtcIsoString(row.created_at),
    last_used_at: row.last_used_at ? toUtcIsoString(row.last_used_at) : null,
    revoked_at: row.revoked_at ? toUtcIsoString(row.revoked_at) : null,
  };
}

export async function upsertEntry(
  apiKeyId: number,
  filename: string,
  fileHash: string,
  adSegmentsFound: number,
  adTimestamps: TimestampRange[],
  transcription: string | null,
): Promise<void> {
  const sql = getSql();
  const adTimestampsJson = JSON.stringify(adTimestamps);

  await sql`
    INSERT INTO history (api_key_id, filename, file_hash, ad_segments_found, ad_timestamps, transcription)
    VALUES (${apiKeyId}, ${filename}, ${fileHash}, ${adSegmentsFound}, ${adTimestampsJson}::jsonb, ${transcription})
    ON CONFLICT (api_key_id, file_hash)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      ad_segments_found = EXCLUDED.ad_segments_found,
      ad_timestamps = EXCLUDED.ad_timestamps,
      transcription = EXCLUDED.transcription
  `;
}

export async function getAllEntries(apiKeyId: number): Promise<HistoryEntry[]> {
  const sql = getSql();
  const rows = await sql<Array<HistoryRow>>`
    SELECT id, api_key_id, filename, file_hash, created_at, ad_segments_found, ad_timestamps, transcription
    FROM history
    WHERE api_key_id = ${apiKeyId}
    ORDER BY created_at DESC
  `;

  return rows.map(mapHistoryRow);
}

export async function getEntryByHash(apiKeyId: number, fileHash: string): Promise<HistoryEntry | null> {
  const sql = getSql();
  const rows = await sql<Array<HistoryRow>>`
    SELECT id, api_key_id, filename, file_hash, created_at, ad_segments_found, ad_timestamps, transcription
    FROM history
    WHERE api_key_id = ${apiKeyId} AND file_hash = ${fileHash}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return mapHistoryRow(row);
}

export async function deleteEntry(apiKeyId: number, entryId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<Array<{ id: number }>>`
    DELETE FROM history
    WHERE api_key_id = ${apiKeyId} AND id = ${entryId}
    RETURNING id
  `;

  return rows.length > 0;
}

export async function createApiKeyEntry(name: string): Promise<{ key: string; entry: ApiKeyEntry }> {
  const sql = getSql();
  const generated = generateApiKey();
  const rows = await sql<Array<ApiKeyRow>>`
    INSERT INTO api_keys (name, public_id, key_hash)
    VALUES (${name}, ${generated.publicId}, ${generated.keyHash})
    RETURNING id, name, public_id, key_hash, created_at, last_used_at, revoked_at
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create API key");
  }

  return {
    key: generated.key,
    entry: mapApiKeyRow(row),
  };
}

export async function findActiveApiKeyByToken(
  publicId: string,
  keyHash: string,
): Promise<ApiKeyEntry | null> {
  const sql = getSql();
  const rows = await sql<Array<ApiKeyRow>>`
    SELECT id, name, public_id, key_hash, created_at, last_used_at, revoked_at
    FROM api_keys
    WHERE public_id = ${publicId} AND key_hash = ${keyHash} AND revoked_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return mapApiKeyRow(row);
}

export async function touchApiKeyLastUsed(apiKeyId: number): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys
    SET last_used_at = NOW()
    WHERE id = ${apiKeyId}
  `;
}

export async function getAllApiKeys(): Promise<ApiKeyEntry[]> {
  const sql = getSql();
  const rows = await sql<Array<ApiKeyRow>>`
    SELECT id, name, public_id, key_hash, created_at, last_used_at, revoked_at
    FROM api_keys
    ORDER BY created_at DESC
  `;

  return rows.map(mapApiKeyRow);
}

export async function revokeApiKey(publicId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<Array<{ id: number }>>`
    UPDATE api_keys
    SET revoked_at = NOW()
    WHERE public_id = ${publicId} AND revoked_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

export async function rotateApiKey(publicId: string): Promise<{ oldEntry: ApiKeyEntry; newEntry: ApiKeyEntry; key: string }> {
  const sql = getSql();

  return await sql.begin(async (tx) => {
    const existingRows = await tx<Array<ApiKeyRow>>`
      SELECT id, name, public_id, key_hash, created_at, last_used_at, revoked_at
      FROM api_keys
      WHERE public_id = ${publicId} AND revoked_at IS NULL
      LIMIT 1
    `;

    const existingRow = existingRows[0];
    if (!existingRow) {
      throw new Error(`No active API key found for public id: ${publicId}`);
    }

    const generated = generateApiKey();
    const insertedRows = await tx<Array<ApiKeyRow>>`
      INSERT INTO api_keys (name, public_id, key_hash)
      VALUES (${existingRow.name}, ${generated.publicId}, ${generated.keyHash})
      RETURNING id, name, public_id, key_hash, created_at, last_used_at, revoked_at
    `;

    const insertedRow = insertedRows[0];
    if (!insertedRow) {
      throw new Error("Failed to create replacement API key");
    }

    await tx`
      UPDATE api_keys
      SET revoked_at = NOW()
      WHERE id = ${existingRow.id}
    `;

    return {
      oldEntry: mapApiKeyRow({
        ...existingRow,
        revoked_at: new Date(),
      }),
      newEntry: mapApiKeyRow(insertedRow),
      key: generated.key,
    };
  });
}

export async function checkDatabaseHealth(): Promise<{ status: "ok" | "error"; message: string }> {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    return {
      status: "ok",
      message: "database connection is healthy",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function clearAll(): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM history`;
}
