import { SQL } from "bun";

import { getRequiredEnv } from "./config.ts";
import { logWarning } from "./logger.ts";

const EXPECTED_HISTORY_COLUMNS = new Set([
  "id",
  "filename",
  "file_hash",
  "created_at",
  "ad_segments_found",
  "ad_timestamps",
  "transcription",
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
  filename: string;
  file_hash: string;
  created_at: Date | string;
  ad_segments_found: number;
  ad_timestamps: TimestampRange[] | string | null;
  transcription: string | null;
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
      filename TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ad_segments_found INTEGER NOT NULL DEFAULT 0,
      ad_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcription TEXT
    )
  `;
}

export async function initDb(): Promise<void> {
  const sql = getSql();

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

export async function upsertEntry(
  filename: string,
  fileHash: string,
  adSegmentsFound: number,
  adTimestamps: TimestampRange[],
  transcription: string | null,
): Promise<void> {
  const sql = getSql();
  const adTimestampsJson = JSON.stringify(adTimestamps);

  await sql`
    INSERT INTO history (filename, file_hash, ad_segments_found, ad_timestamps, transcription)
    VALUES (${filename}, ${fileHash}, ${adSegmentsFound}, ${adTimestampsJson}::jsonb, ${transcription})
    ON CONFLICT (file_hash)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      ad_segments_found = EXCLUDED.ad_segments_found,
      ad_timestamps = EXCLUDED.ad_timestamps,
      transcription = EXCLUDED.transcription
  `;
}

export async function getAllEntries(): Promise<HistoryEntry[]> {
  const sql = getSql();
  const rows = await sql<Array<HistoryRow>>`
    SELECT id, filename, file_hash, created_at, ad_segments_found, ad_timestamps, transcription
    FROM history
    ORDER BY created_at DESC
  `;

  return rows.map(mapHistoryRow);
}

export async function getEntryByHash(fileHash: string): Promise<HistoryEntry | null> {
  const sql = getSql();
  const rows = await sql<Array<HistoryRow>>`
    SELECT id, filename, file_hash, created_at, ad_segments_found, ad_timestamps, transcription
    FROM history
    WHERE file_hash = ${fileHash}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return mapHistoryRow(row);
}

export async function deleteEntry(entryId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<Array<{ id: number }>>`
    DELETE FROM history
    WHERE id = ${entryId}
    RETURNING id
  `;

  return rows.length > 0;
}

export async function clearAll(): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM history`;
}
