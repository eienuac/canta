/**
 * Local PostgreSQL for SQL-level tests (RPC concurrency, migrations).
 *
 * Set TEST_DATABASE_URL to a throw-away LOCAL database, e.g.
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/canta_test
 * Tests are skipped when it is unset. Any non-local host is refused, so these tests can
 * never run against Supabase / production.
 */
import { Pool } from 'pg'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function testDatabaseUrl(): string | null {
  const raw = process.env.TEST_DATABASE_URL?.trim()
  if (!raw) return null
  const host = new URL(raw).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`TEST_DATABASE_URL must point to a local database (got host "${host}")`)
  }
  return raw
}

export function createTestPool(): Pool {
  const url = testDatabaseUrl()
  if (!url) throw new Error('TEST_DATABASE_URL is not set')
  return new Pool({ connectionString: url, max: 40 })
}

const MIGRATIONS_DIR = 'supabase/migrations'

/** Drops the Supabase-like schemas and recreates them from tests/sql/supabase-stub.sql. */
export async function resetSupabaseSchema(pool: Pool): Promise<void> {
  const { readFileSync } = await import('node:fs')
  await pool.query(`
    drop schema if exists public cascade; create schema public;
    drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists payload cascade;
  `)
  await pool.query(readFileSync('tests/sql/supabase-stub.sql', 'utf8'))
}

/** Applies the real migration files in order; `filter` selects which (by file name). */
export async function applyMigrations(pool: Pool, filter: (file: string) => boolean = () => true): Promise<void> {
  const { readFileSync, readdirSync } = await import('node:fs')
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().filter(filter)
  for (const file of files) await pool.query(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'))
}
