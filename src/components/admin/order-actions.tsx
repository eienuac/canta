'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

import { ORDER_STATUS_LABELS, reviewReasonLabel } from '@/lib/labels'
import { formatPrice } from '@/lib/utils'

const STATUSES = Object.keys(ORDER_STATUS_LABELS)

export type AdminPaymentRow = {
  id: string
  status: string
  amount: number
  paid_price: number | null
  installment: number | null
  refund_state: string
  refund_reference: string | null
  superseded_at: string | null
  created_at: string
}

async function patchOrder(body: Record<string, unknown>) {
  const res = await fetch('/api/app-admin/orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'İşlem yapılamadı')
  return data
}

export function AdminOrderActions({
  orderId,
  status,
  trackingNumber,
  needsReview = false,
  reviewReason = null,
  payments = [],
}: {
  orderId: string
  status: string
  trackingNumber?: string | null
  needsReview?: boolean
  reviewReason?: string | null
  payments?: AdminPaymentRow[]
}) {
  const router = useRouter()
  const [nextStatus, setNextStatus] = useState(status)
  const [tracking, setTracking] = useState(trackingNumber || '')
  const [note, setNote] = useState('')
  const [refundRefs, setRefundRefs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      await patchOrder(body)
      toast.success(success)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'İşlem yapılamadı')
    } finally {
      setBusy(false)
    }
  }

  const refundable = payments.filter((p) => p.status === 'paid' && p.refund_state !== 'succeeded')

  return (
    <div className="mt-10 max-w-xl space-y-6">
      {(status === 'payment_review' || needsReview) && (
        <div className="space-y-3 border border-amber-400 bg-amber-50 p-5 text-sm">
          <p className="font-medium text-espresso">İnceleme gerekiyor</p>
          {reviewReason && <p className="text-muted">{reviewReasonLabel(reviewReason)}</p>}
          {status === 'payment_review' && (
            <>
              <p className="text-muted">
                Ödeme alındı. Onaylarsanız stok düşülür ve sipariş &quot;Ödeme Alındı&quot; olur. Stok
                yetersizse onay reddedilir; bu durumda iyzico panelinden iade yapıp aşağıdan kaydedin.
              </p>
              <Input placeholder="Not (isteğe bağlı)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                type="button"
                disabled={busy}
                onClick={() => run({ action: 'approve_review', orderId, note }, 'Sipariş onaylandı')}
              >
                Ödemeyi onayla ve siparişi tamamla
              </Button>
            </>
          )}
        </div>
      )}

      {payments.length > 0 && (
        <div className="space-y-3 border border-border p-5 text-sm">
          <p className="font-medium text-espresso">Ödemeler</p>
          <ul className="space-y-3">
            {payments.map((p) => (
              <li key={p.id} className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p>
                  {p.status} · {formatPrice(Number(p.paid_price ?? p.amount))}
                  {p.installment && p.installment > 1 ? ` · ${p.installment} taksit` : ''}
                  {p.superseded_at ? ' · eski deneme' : ''}
                  {p.refund_state !== 'none' ? ` · iade: ${p.refund_state}` : ''}
                  {p.refund_reference ? ` (${p.refund_reference})` : ''}
                </p>
                {refundable.some((r) => r.id === p.id) && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="iyzico iade referansı"
                      value={refundRefs[p.id] ?? ''}
                      onChange={(e) => setRefundRefs((s) => ({ ...s, [p.id]: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || !(refundRefs[p.id] ?? '').trim()}
                      onClick={() =>
                        run(
                          { action: 'record_refund', paymentId: p.id, reference: refundRefs[p.id] },
                          'İade kaydedildi'
                        )
                      }
                    >
                      İadeyi kaydet
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            İadeyi önce iyzico panelinden yapın, sonra referans numarasıyla buradan kaydedin.
          </p>
        </div>
      )}

      <div className="space-y-4 border border-border p-5">
        <div>
          <Label>Durum</Label>
          <select
            className="mt-1 h-11 w-full border border-border bg-ivory px-3 text-sm"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s] || s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Tracking number</Label>
          <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
        <Button
          type="button"
          disabled={busy}
          onClick={() => run({ orderId, status: nextStatus, trackingNumber: tracking }, 'Sipariş güncellendi')}
        >
          Kaydet
        </Button>
      </div>
    </div>
  )
}
