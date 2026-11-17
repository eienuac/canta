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
  const hooks: Record<string, (q: Query) => void> = {}
  const state = { rpcError: false, rpcCalls: [] as string[] }

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
      hooks[`${this.table}:${this.op}`]?.(this)
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
      return { data: fn(args), error: null }
    },
  }

  return { client, tables, hooks, state }
}
