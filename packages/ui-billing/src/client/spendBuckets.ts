/**
 * The composer spend card's three bucket amounts, derived from the pushed
 * `billingTodaySpend` projection. The host fold already prices every sample
 * into the three disjoint billing buckets (cache-hit input, cache-miss input —
 * which includes cache writes, output including reasoning), so the card sums
 * the session's priced model rows instead of adding a Remote call or a second
 * fold. Keeping the derivation here (pure, no React) lets the sum and its
 * float reconciliation be tested on their own.
 * @module @rayadesu/dsh-client-ui-billing/spendBuckets
 */

import type { DeepSeekSessionSpendModel, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'

/** One priced row's cost split across the three billing buckets, in CNY. */
export interface SpendBuckets {
  /** Uncached (cache-miss) input cost, cache writes included. */
  uncachedInput: number
  /** Cache-hit (cache-read) input cost. */
  cacheRead: number
  /** Output cost, reasoning included. */
  output: number
  /** Billed total the three rows must add up to. */
  total: number
}

/** Sum one model row's three bucket costs. */
function bucketsOf(row: DeepSeekSessionSpendModel): [number, number, number] {
  return [row.cacheMissInputCost, row.cacheHitInputCost, row.outputCost]
}

/**
 * Fold one spend's model rows into the card's three bucket amounts.
 *
 * The rows carry float costs, so the three independently rendered values can
 * miss the displayed total by one unit in the last rendered decimal after each
 * is formatted to four decimals. The residual is absorbed by the largest
 * bucket — the only one where a 1e-4 nudge cannot be seen — so the card's rows
 * always add up to the total it shows in its header.
 * @param spend - the session bucket of the `billingTodaySpend` projection
 *   (the session's own events, every Beijing day).
 * @returns the three bucket totals plus the billed total.
 */
export function spendBucketsOf(spend: DeepSeekTodaySpend): SpendBuckets {
  let uncachedInput = 0
  let cacheRead = 0
  let output = 0
  for (const row of spend.models) {
    const [miss, hit, out] = bucketsOf(row)
    uncachedInput += miss
    cacheRead += hit
    output += out
  }
  const total = spend.total
  const residual = total - (uncachedInput + cacheRead + output)
  if (residual !== 0) {
    if (uncachedInput >= cacheRead && uncachedInput >= output) uncachedInput += residual
    else if (cacheRead >= output) cacheRead += residual
    else output += residual
  }
  return { uncachedInput, cacheRead, output, total }
}

/** Whether a spend has any priced amount to show (a zero card stays hidden). */
export function hasBilledSpend(spend: DeepSeekTodaySpend): boolean {
  return spend.total > 0 || spend.models.length > 0
}
