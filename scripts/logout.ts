import { db, ensureAuthTables, pool } from "#/lib/db.server"
import { session } from "#/lib/db/schema"

async function main() {
  await ensureAuthTables()

  const deletedSessions = await db.delete(session).returning({ id: session.id })

  console.log(
    deletedSessions.length === 0
      ? "No active sessions found."
      : `Deleted ${deletedSessions.length} session${deletedSessions.length === 1 ? "" : "s"}. You are now logged out.`
  )
}

try {
  await main()
} finally {
  await pool.end()
}
