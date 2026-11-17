/**
 * Minimal in-memory stand-in for the Supabase service-role client, covering the query
 * builder calls used by the services under test. Every query yields once before it runs
 * (so concurrent callers interleave like real network calls), and each single statement
 * (filter + update) executes atomically — like one SQL UPDATE in Postgres.
 *
 * The inventory RPCs mirror supabase/migrations/002 (their real SQL is covered by
 * tests/sql/inventory.test.ts against PostgreSQL).
 */
import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
type Result = { data: unknown; error: { message: string; code?: string; details?: string } | null }

const UNIQUE: Record<string, string[]> = {
  inventory_ledger: ['idempotency_key'],
  orders: ['idempotency_key', 'order_number'],
  payments: ['idempotency_key'],
}

export type FakeDb = ReturnType<typeof createFakeSupabase>

export function createFakeSupabase() {
  const tables: Record<string, Row[]> = {
    orders: [],
    order_items: [],
    payments: [],
    inventory: [],
    inventory_ledger: [],
    coupons: [],
    coupon_usages: [],
    cart_items: [],
    carts: [],
    profiles: [],
  }
  /** Per `table:op` hook: throw to simulate a transport failure, or return a result (e.g. `{ data: null, error }`) to simulate a database error. */
  const hooks: Record<string, (q: Query) => void | Result> = {}
  const state = { rpcError: false, rpcCalls: [] as string[], rateLimitHits: new Map<string, number>() }

  const tick = () => new Promise<void>((r) => setImmediate(r))

  class Query implements PromiseLike<Result> {
    op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    filters: Filter[] = []
    mode: 'many' | 'maybe' | 'single' = 'many'
    limitN: number | null = null
    values: Row | Row[] | null = null

    constructor(readonly table: string) {}

    select() {
      return this
    }
    insert(v: Row | Row[]) {
      this.op = 'insert'
      this.values = Array.isArray(v) ? v : [v]
      return this
    }
    update(v: Row) {
      this.op = 'update'
      this.values = v
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    eq(k: string, v: unknown) {
      this.filters.push((r) => r[k] === v)
      return this
    }
    neq(k: string, v: unknown) {
      this.filters.push((r) => r[k] !== v)
      return this
    }
    lt(k: string, v: string | number) {
      this.filters.push((r) => (r[k] as string | number) < v)
      return this
    }
    gte(k: string, v: string | number) {
      this.filters.push((r) => (r[k] as string | number) >= v)
      return this
    }
    in(k: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[k]))
      return this
    }
    order() {
      return this
    }
    limit(n: number) {
      this.limitN = n
      return this
    }
    maybeSingle() {
      this.mode = 'maybe'
      return this
    }
    single() {
      this.mode = 'single'
      return this
    }

    private async run(): Promise<Result> {
      await tick()
      const hooked = hooks[`${this.table}:${this.op}`]?.(this)
      if (hooked) return hooked
      const rows = (tables[this.table] ??= [])
      let data: Row[]
      if (this.op === 'insert') {
        data = (this.values as Row[]).map((v) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...v,
        }))
        for (const d of data) {
          for (const col of UNIQUE[this.table] ?? []) {
            if (d[col] != null && rows.some((r) => r[col] === d[col])) {
              return {
                data: null,
                error: {
                  message: `duplicate key value violates unique constraint "${this.table}_${col}_key"`,
                  code: '23505',
                },
              }
            }
          }
        }
        rows.push(...data)
      } else {
        const matched = rows.filter((r) => this.filters.every((f) => f(r)))
        if (this.op === 'update') matched.forEach((r) => Object.assign(r, this.values))
        if (this.op === 'delete') tables[this.table] = rows.filter((r) => !matched.includes(r))
        data = matched
      }
      if (this.limitN != null) data = data.slice(0, this.limitN)
      if (this.mode === 'maybe') return { data: data[0] ? { ...data[0] } : null, error: null }
      if (this.mode === 'single') {
        return data[0] ? { data: { ...data[0] }, error: null } : { data: null, error: { message: '0 rows' } }
      }
      return { data: data.map((d) => ({ ...d })), error: null }
    }

    then<A = Result, B = never>(
      onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
    ): PromiseLike<A | B> {
      return this.run().then(onfulfilled, onrejected)
    }
  }

  const inv = (sku: unknown) => tables.inventory.find((r) => r.sku === sku) as
    | { quantity: number; reserved_quantity: number }
    | undefined
  const ledgerHas = (key: unknown) => tables.inventory_ledger.some((r) => r.idempotency_key === key)
  const ledger = (row: Row) => tables.inventory_ledger.push({ id: randomUUID(), ...row })

  const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {
    reserve_inventory: ({ p_sku, p_qty, p_idempotency_key }) => {
      if (ledgerHas(p_idempotency_key)) return true
      const r = inv(p_sku)
      const q = Number(p_qty)
      if (!r || r.quantity - r.reserved_quantity < q) return false
      r.reserved_quantity += q
      ledger({ sku: p_sku, delta: q, reason: 'reserve', idempotency_key: p_idempotency_key })
      return true
    },
    commit_inventory: ({ p_sku, p_qty, p_order_id, p_idempotency_key }) => {
      if (ledgerHas(p_idempotency_key)) return true
      const r = inv(p_sku)
      const q = Number(p_qty)
      if (!r || r.quantity < q) return false
      r.quantity -= q
      r.reserved_quantity = Math.max(r.reserved_quantity - q, 0)
      ledger({ sku: p_sku, order_id: p_order_id, delta: -q, reason: 'commit', idempotency_key: p_idempotency_key })
      return true
    },
    release_inventory: ({ p_sku, p_qty, p_idempotency_key }) => {
      if (ledgerHas(p_idempotency_key)) return true
      const r = inv(p_sku)
      const q = Number(p_qty)
      if (!r) return false
      r.reserved_quantity = Math.max(r.reserved_quantity - q, 0)
      ledger({ sku: p_sku, delta: -q, reason: 'release', idempotency_key: p_idempotency_key })
      return true
    },
    coupon_claim_ok: () => true,
    // Simplified mirror of public.finalize_paid_order (migration 008; the real SQL incl. the
    // Payload CMS stock is covered by tests/sql/payment-integrity.test.ts).
    finalize_paid_order: (a) => finalizePaidOrder(a),
    approve_payment_review: (a) => {
      const o = tables.orders.find((r) => r.id === a.p_order_id) as Order | undefined
      if (!o) throw new Error('order not found')
      if (o.status !== 'payment_review' || o.payment_status !== 'paid') {
        throw new Error('order is not awaiting payment review')
      }
      commitOrderStock(o)
      Object.assign(o, {
        status: 'payment_received',
        stock_committed_at: new Date().toISOString(),
        needs_review: false,
        reviewed_by: a.p_admin_id,
      })
      return { result: 'approved' }
    },
    record_manual_refund: (a) => {
      if (!String(a.p_reference ?? '').trim()) throw new Error('refund reference is required')
      const pay = tables.payments.find((p) => p.id === a.p_payment_id)
      if (!pay) throw new Error('payment not found')
      if (pay.status !== 'paid' || pay.refund_state === 'succeeded') throw new Error('payment is not refundable')
      Object.assign(pay, { refund_state: 'succeeded', refund_reference: String(a.p_reference).trim() })
      const open = tables.payments.filter(
        (p) => p.order_id === pay.order_id && p.status === 'paid' && p.refund_state !== 'succeeded'
      ).length
      const o = tables.orders.find((r) => r.id === pay.order_id)!
      if (open === 0) Object.assign(o, { payment_status: 'refunded', needs_review: false })
      else o.needs_review = tables.payments.some((p) => p.order_id === o.id && p.refund_state === 'required')
      return { result: 'refunded', order_fully_refunded: open === 0 }
    },
    // Mirrors public.rate_limit_hit: true while the key is within its limit.
    rate_limit_hit: ({ p_key, p_limit }) => {
      const key = String(p_key)
      const count = (state.rateLimitHits.get(key) ?? 0) + 1
      state.rateLimitHits.set(key, count)
      return count <= Number(p_limit)
    },
  }

  type Order = Row & { id: string; total: number; currency: string; payment_status: string; status: string }

  function commitOrderStock(o: Order) {
    const items = tables.order_items.filter((i) => i.order_id === o.id)
    for (const it of items) {
      const sku = it.product_sku_snapshot as string
      const qty = Number(it.quantity)
      if (ledgerHas(`order:${o.id}:commit:${sku}`)) continue
      const live =
        [`${o.idempotency_key}:reserve:${sku}`, `late:${o.id}:reserve:${sku}`, `review:${o.id}:reserve:${sku}`].some(
          ledgerHas
        ) && ![`${o.idempotency_key}:release:${sku}`, `cancel:${o.id}:release:${sku}`].some(ledgerHas)
      const r = inv(sku)
      if (!r) throw new Error(`insufficient stock for ${sku}`)
      if (!live) {
        if (r.quantity - r.reserved_quantity < qty) throw new Error(`insufficient stock for ${sku}`)
        r.reserved_quantity += qty
        ledger({ sku, order_id: o.id, delta: qty, reason: 'reserve', idempotency_key: `review:${o.id}:reserve:${sku}` })
      }
      if (r.quantity < qty || r.reserved_quantity < qty) throw new Error(`cannot commit stock for ${sku}`)
      r.quantity -= qty
      r.reserved_quantity -= qty
      ledger({ sku, order_id: o.id, delta: -qty, reason: 'commit', idempotency_key: `order:${o.id}:commit:${sku}` })
    }
  }

  function finalizePaidOrder(a: Record<string, unknown>) {
    const o = tables.orders.find((r) => r.id === a.p_order_id) as Order | undefined
    if (!o) throw new Error(`order ${String(a.p_order_id)} not found`)
    const attempts = tables.payments
      .filter((p) => p.order_id === o.id)
      .filter((p) => (a.p_token != null ? p.provider_payment_id === a.p_token : !p.superseded_at))
    const pay = attempts[attempts.length - 1]
    if (!pay) throw new Error(a.p_token != null ? 'payment token mismatch' : 'payment not found')
    if (pay.status === 'paid') return { result: 'duplicate' }

    Object.assign(pay, {
      status: 'paid',
      price: a.p_price,
      paid_price: a.p_paid_price,
      installment: a.p_installment,
      provider_reference: a.p_provider_reference ?? pay.provider_reference,
      raw_response: a.p_summary,
    })

    if (o.payment_status === 'paid') {
      pay.refund_state = 'required'
      o.needs_review = true
      o.review_reason = 'DUPLICATE_PAYMENT'
      return { result: 'duplicate_payment' }
    }

    const price = a.p_price == null ? null : Number(a.p_price)
    const paid = a.p_paid_price == null ? null : Number(a.p_paid_price)
    let reason: string | null = null
    if (a.p_currency != null && String(a.p_currency).toUpperCase() !== String(o.currency).toUpperCase()) {
      reason = 'CURRENCY_MISMATCH'
    } else if (price == null || Math.abs(price - Number(o.total)) > 0.01) reason = 'AMOUNT_MISMATCH'
    else if (paid == null || paid + 0.01 < price) reason = 'PAID_LESS_THAN_PRICE'
    else if (o.payment_status !== 'pending') reason = 'LATE_PAYMENT'
    else if (
      o.cart_id &&
      tables.orders.some(
        (x) =>
          x.cart_id === o.cart_id &&
          x.id !== o.id &&
          x.payment_status === 'paid' &&
          Number(x.total) === Number(o.total) &&
          Math.abs(Date.parse(String(x.created_at)) - Date.parse(String(o.created_at))) < 7_200_000
      )
    ) {
      reason = 'POSSIBLE_DUPLICATE_ORDER'
    }
    if (reason) {
      Object.assign(o, { payment_status: 'paid', status: 'payment_review', needs_review: true, review_reason: reason })
      return { result: 'review', reason }
    }

    const snapshot = {
      inventory: structuredClone(tables.inventory),
      ledger: structuredClone(tables.inventory_ledger),
    }
    try {
      commitOrderStock(o)
    } catch (err) {
      tables.inventory = snapshot.inventory // savepoint rollback
      tables.inventory_ledger = snapshot.ledger
      Object.assign(o, {
        payment_status: 'paid',
        status: 'payment_review',
        needs_review: true,
        review_reason: `STOCK: ${(err as Error).message}`,
      })
      return { result: 'review', reason: 'STOCK' }
    }
    Object.assign(o, { payment_status: 'paid', status: 'payment_received', stock_committed_at: new Date().toISOString() })

    if (o.coupon_code) {
      const coupon = tables.coupons.find((c) => c.code === o.coupon_code)
      if (coupon && !tables.coupon_usages.some((u) => u.order_id === o.id)) {
        tables.coupon_usages.push({ id: randomUUID(), coupon_id: coupon.id, order_id: o.id, user_id: o.user_id })
      }
    }
    if (o.cart_id) tables.cart_items = tables.cart_items.filter((i) => i.cart_id !== o.cart_id)
    return { result: 'paid' }
  }

  const client = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Record<string, unknown>): Promise<Result> => {
      await tick()
      state.rpcCalls.push(name)
      if (state.rpcError && name.endsWith('_inventory')) {
        return { data: null, error: { message: `Could not find the function public.${name} in the schema cache` } }
      }
      const fn = rpcs[name]
      if (!fn) return { data: null, error: { message: `unknown rpc ${name}` } }
      try {
        return { data: fn(args), error: null }
      } catch (err) {
        return { data: null, error: { message: (err as Error).message } }
      }
    },
  }

  return { client, tables, hooks, state }
}
