/**
 * Additive merge of a conversation's two spend halves: the session's OWN billed
 * spend (live, from the pushed `billingTodaySpend` projection or the
 * `billing/getSessionSpend` fallback) and the delegated-subagent subtotal
 * (`billing/getDelegatedSpend`). The panel shows one amount for the whole
 * conversation, so the two must be summed before rendering — and the per-model
 * rows must be summed the same way, or the breakdown would no longer add up to
 * the amount above it.
 *
 * Pure addition only: no pricing, no timezone, no fork-boundary knowledge lives
 * here (the host owns all of that), so this cannot drift from the host's own
 * sums.
 */

import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel } from '@rayadesu/dsh-llm-billing/types'

/** Sum two model rows of the same wire model (display name taken from the first). */
function addRows(left: DeepSeekSessionSpendModel, right: DeepSeekSessionSpendModel): DeepSeekSessionSpendModel {
  return {
    ...left,
    cost: left.cost + right.cost,
    peakCost: left.peakCost + right.peakCost,
    offPeakCost: left.offPeakCost + right.offPeakCost,
    cacheHitInputTokens: left.cacheHitInputTokens + right.cacheHitInputTokens,
    cacheMissInputTokens: left.cacheMissInputTokens + right.cacheMissInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheHitInputCost: left.cacheHitInputCost + right.cacheHitInputCost,
    cacheMissInputCost: left.cacheMissInputCost + right.cacheMissInputCost,
    outputCost: left.outputCost + right.outputCost,
  }
}

/**
 * Sum one conversation's own spend and its delegated-subagent subtotal.
 * @param own - the session's own billed spend.
 * @param delegated - the delegated subtotal from the last `getDelegatedSpend` read.
 * @returns the merged spend (own model order first, then newly seen models).
 */
export function sumSpends(own: DeepSeekSessionSpend, delegated: DeepSeekSessionSpend): DeepSeekSessionSpend {
  const rows = new Map<string, DeepSeekSessionSpendModel>()
  for (const row of own.models) rows.set(row.model, row)
  for (const row of delegated.models) {
    const existing = rows.get(row.model)
    rows.set(row.model, existing === undefined ? row : addRows(existing, row))
  }
  return { total: own.total + delegated.total, models: [...rows.values()] }
}
