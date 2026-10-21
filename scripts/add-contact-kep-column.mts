/**
 * Add KEP address column to Payload site settings.
 * Usage: npx tsx --env-file=.env.local scripts/add-contact-kep-column.mts
 */
import pg from 'pg'

const { Client } = pg
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()
await c.query(`
  alter table if exists payload.site_settings
    add column if not exists contact_kep varchar;
`)
await c.end()
console.log('payload.site_settings.contact_kep is ready')
