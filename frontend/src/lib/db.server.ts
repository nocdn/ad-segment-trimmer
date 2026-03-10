import { Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"

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

export const db = new Kysely({
  dialect: new PostgresDialect({
    pool,
  }),
})

let authTablesReady: Promise<void> | null = null

async function createAuthTables() {
  await pool.query(`
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
}

export function ensureAuthTables() {
  if (!authTablesReady) {
    authTablesReady = createAuthTables()
  }

  return authTablesReady
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

  const result = await pool.query<AuthUserRecord>(
    `
      SELECT
        id,
        email,
        "emailVerified",
        name,
        image
      FROM "user"
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  )

  return result.rows[0] ?? null
}
