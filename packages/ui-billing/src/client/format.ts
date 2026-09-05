/**
 * Shared display formatting for the billing badges: the balance-line currency
 * prefix and the CNY spend amount renderer. Both the header badge and the
 * per-turn cost label format through these, so the two entries cannot drift
 * apart.
 */
import type { DeepSeekBalance } from '@rayadesu/dsh-llm-billing/types'

/** Currency prefix for one balance line; unknown codes render as a literal prefix. */
export function currencySymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/** The primary balance line, or undefined when the provider reports none. */
export function primaryLine(balance: DeepSeekBalance): { symbol: string; total: string } | undefined {
  const line = balance.lines[0]
  if (line === undefined) return undefined
  return { symbol: currencySymbol(line.currency), total: line.total }
}

/** CNY amount, up to four decimals with trailing zeros trimmed. */
export function formatSpend(amount: number): string {
  return `¥${amount.toFixed(4).replace(/\.?0+$/, '')}`
}
