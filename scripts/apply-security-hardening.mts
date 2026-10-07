/**
 * Applies supabase/migrations/003_security_hardening.sql.
 * Credentials come from .env.local — nothing is passed on the CLI.
 *
 * Usage: npx tsx --env-file=.env.local scripts/apply-security-hardening.mts
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const sql = readFileSync(new URL('../supabase/migrations/003_security_hardening.sql', import.meta.url), 'utf8')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(sql)
  console.log('003_security_hardening applied')
} finally {
  await client.end()
}
