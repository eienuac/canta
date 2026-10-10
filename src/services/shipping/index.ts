/**
 * Shipping abstraction — manual rates now; swap for cargo API later.
 */
export type ShippingMethod = 'standard'

export type ShippingQuote = {
  method: ShippingMethod
  label: string
  cost: number
  eta: string
}

export const FREE_SHIPPING_THRESHOLD = 1500
export const STANDARD_SHIPPING_COST = 150

export function calculateShipping(input: {
  method: ShippingMethod
  subtotal: number
}): ShippingQuote {
  const cost = input.subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST
  return {
    method: 'standard',
    label: 'Standart Kargo',
    cost,
    eta: '2-4 iş günü',
  }
}

export function listShippingMethods(subtotal: number): ShippingQuote[] {
  return [calculateShipping({ method: 'standard', subtotal })]
}

export interface ShippingProvider {
  createShipment(orderId: string): Promise<{ trackingNumber: string }>
  track(trackingNumber: string): Promise<{ status: string }>
}

/** Placeholder for future Yurtiçi/Aras/MNG integration */
export class ManualShippingProvider implements ShippingProvider {
  async createShipment(_orderId: string): Promise<{ trackingNumber: string }> {
    throw new Error('Manual shipping — tracking assigned by admin')
  }
  async track(trackingNumber: string) {
    return { status: `Manuel takip: ${trackingNumber}` }
  }
}
