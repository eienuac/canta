/**
 * Reset Payload CMS (/admin) password.
 *
 * Usage:
 *   npx tsx scripts/reset-payload-password.mts you@email.com "YeniSifre123!"
 *
 * Requires DATABASE_URL + PAYLOAD_SECRET (from .env.local).
 */
import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import { getPayload } from 'payload'
import config from '../src/payload.config.ts'

loadEnv({ path: resolve(process.cwd(), '.env.local') })
loadEnv({ path: resolve(process.cwd(), '.env') })

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]
  if (!email || !password) {
    console.error('Usage: npx tsx scripts/reset-payload-password.mts <email> <new-password>')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters')
    process.exit(1)
  }

  const payload = await getPayload({ config })
  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  })

  if (!found.docs.length) {
    console.log(`No user found for ${email} — creating admin...`)
    await payload.create({
      collection: 'users',
      data: {
        email,
        password,
        role: 'admin',
        name: 'Admin',
      },
    })
    console.log(`Created admin: ${email}`)
  } else {
    await payload.update({
      collection: 'users',
      id: found.docs[0].id,
      data: { password },
    })
    console.log(`Password updated for: ${email}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
