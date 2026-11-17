/**
 * An error whose message is written for the customer (business rule: empty cart, out of
 * stock, invalid coupon, …). Only these — and input validation errors — may be shown to
 * the client; every other error (database, payment provider, configuration) is replaced
 * by a generic message so internals are never leaked.
 */
export class PublicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicError'
  }
}

/** Message that is safe to return to the client. Log the original error server-side. */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PublicError) return error.message
  if (error instanceof Error && error.name === 'ZodError') {
    const issues = (error as Error & { issues?: Array<{ message?: string }> }).issues
    return issues?.[0]?.message || fallback
  }
  return fallback
}

/** Normalize thrown values (PostgrestError, Zod, Error) into a message string. Server-side logging only. */
export function getErrorMessage(error: unknown, fallback = 'Failed'): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object') {
    const maybe = error as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    if (typeof maybe.message === 'string' && maybe.message) {
      const parts = [maybe.message]
      if (typeof maybe.code === 'string' && maybe.code) parts.push(`(${maybe.code})`)
      if (typeof maybe.details === 'string' && maybe.details) parts.push(maybe.details)
      if (typeof maybe.hint === 'string' && maybe.hint) parts.push(maybe.hint)
      return parts.join(' — ')
    }
    if (typeof maybe.error === 'string' && maybe.error) return maybe.error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}
