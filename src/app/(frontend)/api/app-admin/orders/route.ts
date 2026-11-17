import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAppAdmin } from '@/lib/admin'
import { publicErrorMessage } from '@/lib/errors'
import { ORDER_STATUS_LABELS } from '@/lib/labels'
import {
  adminUpdateOrderStatus,
  approvePaymentReview,
  recordManualRefund,
} from '@/services/orders'
import type { OrderStatus } from '@/types/database'

const statusSchema = z.enum(Object.keys(ORDER_STATUS_LABELS) as [OrderStatus, ...OrderStatus[]])

const bodySchema = z.union([
  z.object({
    action: z.literal('status').optional(),
    orderId: z.string().uuid(),
    status: statusSchema,
    trackingNumber: z.string().max(100).optional(),
  }),
  z.object({
    action: z.literal('approve_review'),
    orderId: z.string().uuid(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('record_refund'),
    paymentId: z.string().uuid(),
    reference: z.string().trim().min(3).max(100),
  }),
])

export async function PATCH(request: Request) {
  const admin = await requireAppAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = bodySchema.parse(await request.json())

    if (body.action === 'approve_review') {
      await approvePaymentReview(body.orderId, admin.user.id, body.note)
    } else if (body.action === 'record_refund') {
      const result = await recordManualRefund(body.paymentId, admin.user.id, body.reference)
      return NextResponse.json({ ok: true, ...result })
    } else {
      await adminUpdateOrderStatus({
        orderId: body.orderId,
        status: body.status,
        trackingNumber: body.trackingNumber,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: publicErrorMessage(e, 'İşlem yapılamadı.') }, { status: 400 })
  }
}
