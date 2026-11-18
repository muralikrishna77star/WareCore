// Bundle weights are handled as whole grams-style integers (thousandths), so
// the screen never shows a total that floating-point rounding has altered. The
// database repeats the check with exact numerics and has the final say.

/** '3.250' becomes 3250. Returns null unless the text is a plain weight with up to 3 decimals. */
export function toThousandths(text: string): number | null {
  const value = text.trim()
  if (!/^[0-9]+(\.[0-9]{1,3})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
}

/** 3250 becomes '3.250'. */
export function fromThousandths(value: number): string {
  const whole = Math.floor(value / 1000)
  return `${whole}.${String(value % 1000).padStart(3, '0')}`
}

/** Splits a weight equally, with any remainder on the last bundle: 10.000 in 3 gives 3.333, 3.333, 3.334. */
export function splitEqually(total: string, count: number): string[] {
  const thousandths = toThousandths(total)
  if (thousandths === null || !Number.isInteger(count) || count < 1) return []
  const each = Math.floor(thousandths / count)
  return Array.from({ length: count }, (_, i) =>
    fromThousandths(i === count - 1 ? thousandths - each * (count - 1) : each))
}

/** Adds weights exactly. Returns null if any weight is not valid. */
export function sumWeights(weights: string[]): string | null {
  let total = 0
  for (const weight of weights) {
    const value = toThousandths(weight)
    if (value === null) return null
    total += value
  }
  return fromThousandths(total)
}
