import { NextResponse } from 'next/server'
import { requireAppAdmin } from '@/lib/admin'

export async function GET() {
  const admin = await requireAppAdmin()
  return NextResponse.json({ isAdmin: Boolean(admin) })
}
