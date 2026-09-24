/**
 * Spend arithmetic: how two spends combine, how one is inverted, and how the
 * samples that could NOT be priced are tallied beside them. Pure, and knowing
 * nothing about rates, timezones or event shapes — the pricing engine
 * (`billing.ts`) owns all of that.
 * @module @rayadesu/dsh-llm-billing/spend
 */

import type { BillingEventContribution } from './pricing.ts'
import type { DeepSeekSessionSpendModel, DeepSeekTodaySpend, DeepSeekUnpricedUsage } from './types.ts'

/** A spend with no priced usage. */
export function emptyTodaySpend(): DeepSeekTodaySpend {
  return { total: 0, models: [] }
}

/** Sum two usage tallies (pure); an absent side stays absent. */
function mergeUsageTally(
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

/** Add one affected sample to a tally (pure). */
function addUsageTally(
  previous: DeepSeekUnpricedUsage | undefined,
  model: string,
  tokens: number,
): DeepSeekUnpricedUsage {
  const models = previous?.models ?? []
  return {
    events: (previous?.events ?? 0) + 1,
    tokens: (previous?.tokens ?? 0) + tokens,
    models: models.includes(model) ? models : [...models, model],
  }
}

/**
 * The advisory tallies carried BESIDE the priced rows, summed over `spends` as
 * a partial you can spread into any spend literal. Keys stay absent rather
 * than becoming `undefined` (`exactOptionalPropertyTypes`), so a fully priced
 * spend stays structurally identical to what every existing test asserts.
 */
function usageTalliesOf(spends: readonly DeepSeekTodaySpend[]): {
  unpriced?: DeepSeekUnpricedUsage | undefined
} {
  let unpriced: DeepSeekUnpricedUsage | undefined
  for (const spend of spends) unpriced = mergeUsageTally(unpriced, spend.unpriced)
  return { ...(unpriced === undefined ? {} : { unpriced }) }
}

/** Note one sample that matched no pricing row and was therefore not billed. */
export function noteUnpriced(spend: DeepSeekTodaySpend, model: string, tokens: number): DeepSeekTodaySpend {
  return {
    total: spend.total,
    models: spend.models,
    unpriced: addUsageTally(spend.unpriced, model, tokens),
  }
}

/** The today-spend shape of a single priced contribution. */
function contributionModel(priced: BillingEventContribution): DeepSeekSessionSpendModel {
  return {
    model: priced.model,
    displayName: priced.displayName,
    cost: priced.cost,
    peakCost: priced.peakCost,
    offPeakCost: priced.offPeakCost,
    cacheHitInputTokens: priced.cacheHitInputTokens,
    cacheMissInputTokens: priced.cacheMissInputTokens,
    outputTokens: priced.outputTokens,
    cacheHitInputCost: priced.cacheHitInputCost,
    cacheMissInputCost: priced.cacheMissInputCost,
    outputCost: priced.outputCost,
  }
}

/** Sum two model rows of the same model (pure). */
function mergeModelRows(left: DeepSeekSessionSpendModel, right: DeepSeekSessionSpendModel): DeepSeekSessionSpendModel {
  return {
    model: left.model,
    displayName: left.displayName,
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
 * Mutable model-row accumulator behind every spend fold. Rows keep first-seen
 * model order — the same shape a pure `addEventContribution` chain produces —
 * so the single-pass scan path and the pure public paths cannot diverge. One
 * `Map` lookup per contribution instead of a per-event array copy: the huge
 * event-log folds allocate one row object per model, not one intermediate
 * array per event.
 */
export class SpendAccumulator {
  private readonly rows = new Map<string, DeepSeekSessionSpendModel>()
  private total = 0

  /** Add one priced contribution. */
  add(priced: BillingEventContribution): void {
    const row = contributionModel(priced)
    const existing = this.rows.get(priced.model)
    this.rows.set(priced.model, existing === undefined ? row : mergeModelRows(existing, row))
    this.total += priced.cost
  }

  /** The folded spend; the accumulator stays usable afterwards. */
  finish(): DeepSeekTodaySpend {
    return { total: this.total, models: [...this.rows.values()] }
  }
}

/** The additive inverse of one spend (pure): used to replace a priced sample. */
export function negateSpend(spend: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const negate = (value: number): number => -value
  return {
    total: negate(spend.total),
    // Carried, not inverted: the tallies are counts of what was missed, not
    // billed amounts, so subtracting a priced sample cannot cancel them.
    ...usageTalliesOf([spend]),
    models: spend.models.map(row => ({
      ...row,
      cost: negate(row.cost),
      peakCost: negate(row.peakCost),
      offPeakCost: negate(row.offPeakCost),
      cacheHitInputTokens: negate(row.cacheHitInputTokens),
      cacheMissInputTokens: negate(row.cacheMissInputTokens),
      outputTokens: negate(row.outputTokens),
      cacheHitInputCost: negate(row.cacheHitInputCost),
      cacheMissInputCost: negate(row.cacheMissInputCost),
      outputCost: negate(row.outputCost),
    })),
  }
}

/**
 * Subtract one spend from another (pure). Rows that cancel out completely are
 * dropped so a replaced sample leaves no zero row behind.
 * @param target - the spend to subtract from.
 * @param source - the spend to remove.
 * @returns the difference.
 */
export function subtractSpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const rows = new Map<string, DeepSeekSessionSpendModel>()
  for (const row of target.models) rows.set(row.model, row)
  for (const row of source.models) {
    const existing = rows.get(row.model)
    if (existing === undefined) continue
    const next = mergeModelRows(existing, negateSpend({ total: 0, models: [row] }).models[0]!)
    if (next.cost === 0 && next.cacheHitInputTokens === 0 && next.cacheMissInputTokens === 0 && next.outputTokens === 0) {
      rows.delete(row.model)
    } else {
      rows.set(row.model, next)
    }
  }
  return { total: target.total - source.total, models: [...rows.values()], ...usageTalliesOf([target]) }
}


/** The contribution as a one-row spend (the shape a sample keeps for replacement). */
export function contributionSpend(priced: BillingEventContribution): DeepSeekTodaySpend {
  return { total: priced.cost, models: [contributionModel(priced)] }
}


/**
 * Merge one priced event's contribution into an accumulator spend (pure:
 * returns a new spend, never mutates its input).
 * @param spend - the accumulator (per session and day, or across sessions).
 * @param priced - the priced contribution to add.
 * @returns the merged spend.
 */
export function addEventContribution(
  spend: DeepSeekTodaySpend,
  priced: BillingEventContribution,
): DeepSeekTodaySpend {
  const row = contributionModel(priced)
  const rows = spend.models.map(existing => existing.model === priced.model ? mergeModelRows(existing, row) : existing)
  if (!rows.some(existing => existing.model === priced.model)) rows.push(row)
  return { total: spend.total + priced.cost, models: rows, ...usageTalliesOf([spend]) }
}

/**
 * Sum two spends (per session and day, or across sessions) into one (pure:
 * returns a new spend, never mutates its inputs).
 * @param target - the accumulator spend.
 * @param source - the spend to add.
 * @returns the summed spend.
 */
export function mergeTodaySpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const rows = new Map<string, DeepSeekSessionSpendModel>()
  for (const row of target.models) rows.set(row.model, row)
  for (const row of source.models) {
    const existing = rows.get(row.model)
    rows.set(row.model, existing === undefined ? row : mergeModelRows(existing, row))
  }
  return { total: target.total + source.total, models: [...rows.values()], ...usageTalliesOf([target, source]) }
}
