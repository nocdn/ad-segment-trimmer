import { db, ensureAppTables, pool } from "#/lib/db.server"
import { sql } from "drizzle-orm"
import { stdin as input, stdout as output } from "node:process"
import { createInterface } from "node:readline/promises"

async function confirmPrune() {
  const readline = createInterface({ input, output })

  try {
    const answer = await readline.question(
      "This will delete every row from every table and cannot be undone. Continue? [y/N] "
    )

    return ["y", "yes"].includes(answer.trim().toLowerCase())
  } finally {
    readline.close()
  }
}

async function main() {
  const confirmed = await confirmPrune()

  if (!confirmed) {
    console.log("Prune aborted.")
    return
  }

  await ensureAppTables()

  await db.execute(
    sql.raw(`
    TRUNCATE TABLE
      session,
      account,
      verification,
      apikey,
      history,
      processing_cache,
      "user"
    RESTART IDENTITY CASCADE
  `)
  )

  console.log("All rows deleted from all tables.")
}

try {
  await main()
} finally {
  await pool.end()
}
