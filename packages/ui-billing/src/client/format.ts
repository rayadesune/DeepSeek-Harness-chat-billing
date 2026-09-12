/**
 * Shared display formatting for the billing badges: the balance-line currency
 * prefix, the CNY spend amount renderer, and the token-count renderer. Both the
 * header badge and the per-turn cost label format through these, so the two
 * entries cannot drift apart.
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

/**
 * A token count in DSH's own compact notation: `517` / `12.2K` / `517K` / `1.2M`.
 *
 * Mirrors ui-chat's `formatTokens` (`packages/client/ui-chat/src/client/chat/
 * token-format.ts`) rule for rule, so one shell never renders the same count two
 * ways. That rule reads: below 1e3 the plain integer (no digit grouping); below
 * 1e6 the shared `number.thousand` unit (`{value}K`); otherwise the shared
 * `number.million` unit (`{value}M`). A scaled value keeps one decimal while it
 * is below 100 and rounds to a whole number from 100 up (`12.2K`, but `517K`),
 * and there is no third unit, so 1.2e9 renders as `1200M` — exactly as DSH
 * renders it. The unit letters are identical in both DSH dictionaries, so they
 * are literals here rather than a locale lookup into the shared vocabulary.
 * @param count - the token count to render.
 * @returns the compact count, without the label's own ` tok` suffix.
 */
export function formatTokens(count: number): string {
  const scaled = (value: number): string =>
    value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  if (count < 1_000) return String(count)
  if (count < 1_000_000) return `${scaled(count / 1_000)}K`
  return `${scaled(count / 1_000_000)}M`
}

/** Every billed token bucket of one priced model row. */
export interface TokenBuckets {
  /** Cache-hit input tokens. */
  cacheHitInputTokens: number
  /** Cache-miss input tokens (uncached input plus cache writes). */
  cacheMissInputTokens: number
  /** Output tokens (reasoning included). */
  outputTokens: number
}

/**
 * The total billed tokens of a priced row: the three buckets summed. Tokens are
 * already counted per bucket when they were priced, so a cache-hit input token
 * and an output token are both one token here — the number answers "how many
 * tokens did this cost", not "how many characters were sent".
 * @param row - one priced model row.
 * @returns the row's total token count.
 */
export function rowTokens(row: TokenBuckets): number {
  return row.cacheHitInputTokens + row.cacheMissInputTokens + row.outputTokens
}
