/**
 * Shared display formatting for the billing badges: the balance-line currency
 * prefix, the CNY spend amount renderer, the token-count renderer, and the
 * cache-hit percentage. Both the header badge and the per-turn cost label
 * format through these, so the two entries cannot drift apart.
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

/**
 * CNY amount, up to four decimals with trailing zeros trimmed. The balance line's
 * renderer; spend figures go through {@link formatSpendSignificant} instead.
 */
export function formatSpend(amount: number): string {
  return `¥${amount.toFixed(4).replace(/\.?0+$/, '')}`
}

/**
 * CNY spend amount at a fixed number of SIGNIFICANT digits (default three),
 * trailing zeros trimmed, prefixed with `¥` — and never finer than the panel's
 * own four-decimal resolution.
 *
 * Every spend figure the plugin renders goes through this: the day's own amount
 * and its three bucket costs, this session's spend and the parenthesized today
 * share after it, the per-model rows and their bucket breakdowns, the ranking
 * amounts, and the badge's own spend line. Four decimals are noise at these
 * magnitudes — their last digits move with every request (`¥0.5068` → `¥0.507`)
 * — while the four-decimal bound keeps a microscopic amount from growing a long
 * `¥0.00002` string that would widen its column: an amount that rounds to zero
 * there reads `¥0`. Only the BALANCE line keeps {@link formatSpend}'s plain four
 * decimals, because remaining credit is a balance, not a spend measurement.
 * @param amount - the amount to render.
 * @param digits - significant digits to keep (default 3).
 * @returns the rendered amount, e.g. `¥9.58`, `¥0.507`, `¥1230`, `¥0`.
 */
export function formatSpendSignificant(amount: number, digits = 3): string {
  if (!Number.isFinite(amount) || amount === 0) return '¥0'
  // `toPrecision` yields the significant digits; `toFixed(4)` then clamps the
  // result to the resolution every other amount in the panel uses, which also
  // drops anything below ¥0.0001 to zero.
  return `¥${Number(Number(amount.toPrecision(digits)).toFixed(4))}`
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

/** Round a cache-read ratio to exact percentage units, with positive ties rounded up. */
function roundedPercentUnits(cacheReadTokens: number, denominator: number, decimalPlaces: 0 | 1): number {
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10
  const scale = unitsPerPercent * 100
  const doubledScale = scale * 2
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  const denominatorRemainder = denominator % doubledScale
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / doubledScale)
    if (cacheReadTokens >= threshold) lower = candidate
    else upper = candidate - 1
  }
  return lower
}

/** Percentage units back to text, dropping a redundant trailing `.0`. */
function displayPercentUnits(units: number, decimalPlaces: 0 | 1): string {
  if (decimalPlaces === 0) return String(units)
  const whole = Math.floor(units / 10)
  const tenths = units % 10
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`
}

/**
 * The cache-hit share of one prompt, in DSH's own percentage rule.
 *
 * Mirrors ui-chat's `formatCacheHitPercent`
 * (`packages/client/ui-chat/src/client/chat/token-format.ts`) rule for rule, so
 * one shell never prints the same ratio two ways: an integer percentage by
 * default, and — because a partial hit must never round up to a full one — just
 * enough extra decimals to stay below 100 when integer rounding would reach it
 * (`99`, `99.5`, `99.95`, …). The rounding runs in integer arithmetic with
 * positive ties going up, so it does not ride on binary-float precision.
 *
 * The ratio is over PROMPT-side tokens only (cache read over cache read plus
 * uncached input, the split DSH's own `billedInputTokens` makes); output tokens
 * never enter the denominator.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact aggregate prompt-side tokens.
 * @param decimalPlaces - ordinary-ratio precision; a partial hit that would
 * round to 100 automatically uses enough additional precision to stay honest.
 * @returns percentage text without its `%`, or null when there was no prompt input.
 */
export function formatCacheHitPercent(
  cacheReadTokens: number,
  promptTokens: number,
  decimalPlaces: 0 | 1 = 0,
): string | null {
  if (promptTokens === 0) return null
  const missedInputTokens = promptTokens - cacheReadTokens
  if (missedInputTokens === 0) return '100'

  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
  const fullHitUnits = decimalPlaces === 0 ? 100 : 1_000
  if (roundedUnits < fullHitUnits) return displayPercentUnits(roundedUnits, decimalPlaces)

  let distinguishingPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(promptTokens / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    distinguishingPlaces += 1
  }
  const denominatorOnes = promptTokens % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
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
