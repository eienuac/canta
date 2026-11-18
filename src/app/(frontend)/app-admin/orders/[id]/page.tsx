import { redirect, notFound } from 'next/navigation'
import { requireAppAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { formatPrice } from '@/lib/utils'
import { AdminOrderActions } from '@/components/admin/order-actions'
import { ORDER_STATUS_LABELS } from '@/lib/labels'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAppAdmin()
  if (!admin) redirect('/auth/login')

  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase.from('orders').select('*').eq('id', id).maybeSingle()
  if (!order) notFound()
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', id)
  const { data: payments } = await supabase
    .from('payments')
    .select('id, status, amount, paid_price, refunded_amount, installment, refund_state, refund_reference, superseded_at, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true })

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-3xl">{order.order_number}</h1>
      <p className="mt-2 text-sm text-muted">
        {ORDER_STATUS_LABELS[order.status] || order.status} · {order.payment_status} ·{' '}
        {formatPrice(Number(order.total))}
      </p>
      <ul className="mt-8 space-y-2 text-sm">
        {(items || []).map((item) => (
          <li key={item.id}>
            {item.product_name_snapshot} × {item.quantity} —{' '}
            {formatPrice(Number(item.unit_price_snapshot))}
          </li>
        ))}
      </ul>
      <AdminOrderActions
        orderId={order.id}
        status={order.status}
        trackingNumber={order.tracking_number}
        needsReview={order.needs_review}
        reviewReason={order.review_reason}
        payments={payments ?? []}
      />
    </div>
  )
}
