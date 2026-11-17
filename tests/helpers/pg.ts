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
