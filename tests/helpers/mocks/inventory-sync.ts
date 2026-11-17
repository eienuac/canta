/** Real inventory RPC wrappers; only the Payload CMS stock write is stubbed. */
export async function withStubbedCmsStock(importOriginal: () => Promise<unknown>) {
  const original = (await importOriginal()) as typeof import('@/services/inventory/sync')
  return { ...original, decrementCmsStock: async () => true }
}
