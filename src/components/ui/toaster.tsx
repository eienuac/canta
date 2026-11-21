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
        // Sonner's default description colour is dark grey, unreadable on the green toast.
        classNames: {
          description: 'text-[#f5f3ec]/85!',
          icon: 'text-[#f5f3ec]!',
          actionButton: 'bg-[#f5f3ec]! text-[#2c5c4f]!',
          cancelButton: 'bg-transparent! text-[#f5f3ec]!',
          closeButton: 'bg-[#2c5c4f]! text-[#f5f3ec]! border-[#f5f3ec]/30!',
        },
      }}
    />
  )
}
