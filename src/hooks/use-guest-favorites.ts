'use client'

import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'sc_guest_favorites'
const EMPTY: string[] = []

const listeners = new Set<() => void>()
let cache: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY }

function parse(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : EMPTY
  } catch {
    return EMPTY
  }
}

/** Snapshot must be referentially stable while localStorage is unchanged. */
function snapshot(): string[] {
  const raw = localStorage.getItem(KEY)
  if (raw !== cache.raw) cache = { raw, ids: parse(raw) }
  return cache.ids
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function write(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids))
  listeners.forEach((l) => l())
}

/** Guest favorites in localStorage, shared by every component that uses the hook. */
export function useGuestFavorites() {
  const ids = useSyncExternalStore(subscribe, snapshot, () => EMPTY)

  const has = useCallback((productId: string) => ids.includes(productId), [ids])

  const toggle = useCallback((productId: string) => {
    const current = snapshot()
    const next = current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]
    write(next)
    return next.includes(productId)
  }, [])

  const clear = useCallback(() => write([]), [])

  return { ids, has, toggle, clear }
}
