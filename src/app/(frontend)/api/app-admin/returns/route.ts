import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAppAdmin } from '@/lib/admin'
import { publicErrorMessage } from '@/lib/errors'
import { RETURN_STATUS_LABELS } from '@/lib/labels'
import { updateReturnStatus } from '@/services/returns'

const statusSchema = z.enum(Object.keys(RETURN_STATUS_LABELS) as [string, ...string[]])

export async function PATCH(request: Request) {
  const admin = await requireAppAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = z
      .object({ returnId: z.string().uuid(), status: statusSchema, adminNotes: z.string().max(1000).optional() })
      .parse(await request.json())

    await updateReturnStatus(body.returnId, body.status, body.adminNotes)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'İade talebi güncellenemedi.') }, { status: 400 })
  }
}
