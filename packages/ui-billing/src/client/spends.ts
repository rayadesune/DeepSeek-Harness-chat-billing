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

import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel, DeepSeekUnpricedUsage } from '@rayadesu/dsh-llm-billing/types'

/** Merge two unpriced tallies (pure); an absent side stays absent. */
function addUnpriced(
  left: DeepSeekUnpricedUsage | undefined,
  right: DeepSeekUnpricedUsage | undefined,
): DeepSeekUnpricedUsage | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return {
    events: left.events + right.events,
    tokens: left.tokens + right.tokens,
    models: [...new Set([...left.models, ...right.models])],
  }
}

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
  const unpriced = addUnpriced(own.unpriced, delegated.unpriced)
  return {
    total: own.total + delegated.total,
    models: [...rows.values()],
    // Carried, not summed away: the conversation's unpriced usage has to survive
    // the merge, or a session whose ONLY usage was unlisted would report "no
    // usage" here while the today row beside it says the opposite.
    ...(unpriced === undefined ? {} : { unpriced }),
  }
}
