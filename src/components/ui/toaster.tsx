'use client'

import { Toaster } from 'sonner'

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        style: {
          background: '#2c5c4f',
          color: '#f5f3ec',
          border: 'none',
          borderRadius: 0,
        },
      }}
    />
  )
}
