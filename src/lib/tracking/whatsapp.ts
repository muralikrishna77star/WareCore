// Builds the pre-written pickup message. Staff send it from their own WhatsApp,
// so nothing here contacts WhatsApp or any other service.

/**
 * Returns the number in international form, digits only, or null if it can't
 * be a phone number. A 10-digit number is taken to be Indian.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length === 10) return `91${digits}`
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

export interface PickupMessage {
  pickup_no: string
  company_name: string
  warehouse_name: string
  customer_name: string
  bundle_count: number
  total_quantity: string
  unit: string | null
  ready: boolean
}

export function pickupMessageText(pickup: PickupMessage): string {
  const bundles = `${pickup.bundle_count} ${pickup.bundle_count === 1 ? 'bundle' : 'bundles'}`
  const weight = `${pickup.total_quantity}${pickup.unit ? ` ${pickup.unit}` : ''}`
  return [
    `${pickup.company_name}: pickup ${pickup.pickup_no}`,
    `Customer: ${pickup.customer_name}`,
    `Material: ${bundles}, ${weight}`,
    `Collect from: ${pickup.warehouse_name}`,
    pickup.ready ? 'Status: Ready for pickup' : 'Status: Being prepared',
  ].join('\n')
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}
