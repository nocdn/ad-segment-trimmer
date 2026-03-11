import { and, desc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { history, processingCache, schema, user } from "./db/schema"

function normalizeDatabaseUrl(connectionString: string) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(connectionString)
  } catch {
    return connectionString
  }

  const sslMode = parsedUrl.searchParams.get("sslmode")
  const usesLibpqCompatibility = parsedUrl.searchParams.get("uselibpqcompat") === "true"

  if (!usesLibpqCompatibility && ["prefer", "require", "verify-ca"].includes(sslMode ?? "")) {
    parsedUrl.searchParams.set("sslmode", "verify-full")
  }

  return parsedUrl.toString()
}

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required")
}

export const pool = new Pool({
  connectionString: normalizeDatabaseUrl(DATABASE_URL),
})

export const db = drizzle({
  client: pool,
  schema,
})

let authTablesReady: Promise<void> | null = null
let processingTablesReady: Promise<void> | null = null

async function createAuthTables() {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS session_user_id_idx ON session ("userId");

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMPTZ,
      "refreshTokenExpiresAt" TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS account_user_id_idx ON account ("userId");

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);

    CREATE TABLE IF NOT EXISTS apikey (
      id TEXT PRIMARY KEY,
      "configId" TEXT NOT NULL DEFAULT 'default',
      name TEXT,
      start TEXT,
      "referenceId" TEXT NOT NULL,
      prefix TEXT,
      key TEXT NOT NULL,
      "refillInterval" INTEGER,
      "refillAmount" INTEGER,
      "lastRefillAt" TIMESTAMPTZ,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "rateLimitTimeWindow" INTEGER NOT NULL DEFAULT 86400000,
      "rateLimitMax" INTEGER NOT NULL DEFAULT 1000,
      "requestCount" INTEGER NOT NULL DEFAULT 0,
      remaining INTEGER,
      "lastRequest" TIMESTAMPTZ,
      "expiresAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      permissions TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS apikey_config_id_idx ON apikey ("configId");
    CREATE INDEX IF NOT EXISTS apikey_reference_id_idx ON apikey ("referenceId");
    CREATE INDEX IF NOT EXISTS apikey_key_idx ON apikey (key);
  `)
  )
}

export function ensureAuthTables() {
  if (!authTablesReady) {
    authTablesReady = createAuthTables()
  }

  return authTablesReady
}

async function createProcessingTables() {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ad_segments_found INTEGER NOT NULL DEFAULT 0,
      ad_segments JSONB,
      processing_time_ms BIGINT
    );

    CREATE TABLE IF NOT EXISTS processing_cache (
      audio_hash TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ad_segments JSONB,
      transcription TEXT,
      ad_segment_timestamps JSONB
    );

    CREATE INDEX IF NOT EXISTS idx_history_user_created_at ON history (user_id, created_at DESC);
  `)
  )
}

export function ensureProcessingTables() {
  if (!processingTablesReady) {
    processingTablesReady = createProcessingTables()
  }

  return processingTablesReady
}

export async function ensureAppTables() {
  await Promise.all([ensureAuthTables(), ensureProcessingTables()])
}

export type AuthUserRecord = {
  id: string
  email: string
  emailVerified: boolean
  name: string
  image: string | null
}

export async function getAuthUserById(userId: string) {
  await ensureAuthTables()

  const [authUser] = await db
    .select({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return authUser ?? null
}

export type HistoryEntry = {
  id: number
  user_id: string
  filename: string
  created_at: string
  ad_segments_found: number
  ad_segments: string[] | null
  processing_time_ms: number | null
}

export type CachedProcessingData = {
  ad_segments: string[] | null
  transcription: string | null
  ad_segment_timestamps: Array<[number, number]> | null
}

function toIsoString(value: Date) {
  return value.toISOString()
}

export async function addHistoryEntry({
  userId,
  filename,
  adSegmentsFound,
  adSegments,
  processingTimeMs,
}: {
  userId: string
  filename: string
  adSegmentsFound: number
  adSegments?: string[] | null
  processingTimeMs?: number | null
}) {
  await ensureProcessingTables()

  await db.insert(history).values({
    userId,
    filename,
    adSegmentsFound,
    adSegments: adSegments ?? null,
    processingTimeMs: processingTimeMs ?? null,
  })
}

export async function getHistoryForUser(userId: string) {
  await ensureProcessingTables()

  const historyEntries = await db
    .select({
      id: history.id,
      userId: history.userId,
      filename: history.filename,
      createdAt: history.createdAt,
      adSegmentsFound: history.adSegmentsFound,
      adSegments: history.adSegments,
      processingTimeMs: history.processingTimeMs,
    })
    .from(history)
    .where(eq(history.userId, userId))
    .orderBy(desc(history.createdAt))

  return historyEntries.map((entry) => ({
    id: entry.id,
    user_id: entry.userId,
    filename: entry.filename,
    created_at: toIsoString(entry.createdAt),
    ad_segments_found: entry.adSegmentsFound,
    ad_segments: entry.adSegments ?? null,
    processing_time_ms: entry.processingTimeMs ?? null,
  })) satisfies HistoryEntry[]
}

export async function deleteHistoryEntry(entryId: number, userId: string) {
  await ensureProcessingTables()

  const deletedEntries = await db
    .delete(history)
    .where(and(eq(history.id, entryId), eq(history.userId, userId)))
    .returning({ id: history.id })

  return deletedEntries.length > 0
}

export async function getCachedProcessingData(audioHash: string) {
  await ensureProcessingTables()

  const [cachedProcessing] = await db
    .select({
      adSegments: processingCache.adSegments,
      transcription: processingCache.transcription,
      adSegmentTimestamps: processingCache.adSegmentTimestamps,
    })
    .from(processingCache)
    .where(eq(processingCache.audioHash, audioHash))
    .limit(1)

  if (!cachedProcessing) {
    return null
  }

  return {
    ad_segments: cachedProcessing.adSegments ?? null,
    transcription: cachedProcessing.transcription,
    ad_segment_timestamps: cachedProcessing.adSegmentTimestamps ?? null,
  } satisfies CachedProcessingData
}

export async function upsertCachedProcessingData({
  audioHash,
  adSegments,
  transcription,
  adSegmentTimestamps,
}: {
  audioHash: string
  adSegments?: string[] | null
  transcription?: string | null
  adSegmentTimestamps?: Array<[number, number]> | null
}) {
  await ensureProcessingTables()

  await db
    .insert(processingCache)
    .values({
      audioHash,
      adSegments: adSegments ?? null,
      transcription: transcription ?? null,
      adSegmentTimestamps: adSegmentTimestamps ?? null,
    })
    .onConflictDoUpdate({
      target: processingCache.audioHash,
      set: {
        adSegments: adSegments ?? null,
        transcription: transcription ?? null,
        adSegmentTimestamps: adSegmentTimestamps ?? null,
        updatedAt: sql`now()`,
      },
    })
}
