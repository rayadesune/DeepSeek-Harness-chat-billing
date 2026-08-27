/**
 * `billingTodaySpend` session-projection unit: per-session, per-Beijing-day
 * billed spend, folded eagerly by the DSH projection drive over committed
 * session events and checkpointed by the projection cache. The unit keeps only
 * the spend of the session's LATEST priced day (events are append-only and
 * chronological, so a day strictly older than the state's day never returns);
 * the aggregate "today" read sums the units whose `dayKey` matches the current
 * Beijing day — zero full-log scans once the fold is warm.
 *
 * The unit's fold shares {@link priceEvent} with the events-scan paths
 * (`computeTodaySpend`), so both price with the same table. The unit is
 * client-visible (`wire` = identity) because the persisted-cache read ladder
 * (`sessionProjectionCache.coldSnapshot` / registry `restore`) serves only
 * wired units; the wire value is the state itself.
 * @module @rayadesu/dsh-llm-billing/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ResolvedBilling } from './billing.ts'
import { addEventContribution, emptyTodaySpend, priceEvent } from './billing.ts'
import type { DeepSeekTodaySpend } from './types.ts'

/** The projection key this unit owns. */
export const BILLING_UNIT_KEY = 'billingTodaySpend'

/**
 * Per-session unit state: the Beijing day of the session's latest priced
 * event and that day's billed spend. `dayKey` is `''` while the session has no
 * priced usage, and the state only ever describes ONE day (the latest) —
 * plain JSON, as the persisted-cache contract requires.
 */
export interface BillingUnitState {
  /** Beijing-time calendar-day key of the state's spend; `''` for no priced usage. */
  dayKey: string
  /** The spend of the session's latest priced Beijing day. */
  spend: DeepSeekTodaySpend
}

const modelRowSchema = z.object({
  model: z.string(),
  displayName: z.string(),
  cost: z.number().nonnegative(),
  peakCost: z.number().nonnegative(),
  offPeakCost: z.number().nonnegative(),
  cacheHitInputTokens: z.number().int().nonnegative(),
  cacheMissInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheHitInputCost: z.number().nonnegative(),
  cacheMissInputCost: z.number().nonnegative(),
  outputCost: z.number().nonnegative(),
}).strict()

const todaySpendSchema = z.object({
  total: z.number().nonnegative(),
  models: z.array(modelRowSchema),
}).strict()

const billingUnitSchema = z.object({
  dayKey: z.string(),
  spend: todaySpendSchema,
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    billingTodaySpend: BillingUnitState
  }
  interface SessionProjectionMap {
    billingTodaySpend: BillingUnitState
  }
}

/**
 * The unit definition with a required `wire` — the shape {@link register}
 * accepts for a client-visible unit (the plain `ProjectionDefinition` type
 * leaves `wire` optional).
 */
export type BillingUnitDefinition =
  Omit<ProjectionDefinition<'billingTodaySpend', BillingUnitState>, 'wire'>
  & { wire: NonNullable<ProjectionDefinition<'billingTodaySpend', BillingUnitState>['wire']> }

/**
 * Build the `billingTodaySpend` unit for one resolved pricing table. The
 * pricing closure is fixed at registration; a pricing-table change therefore
 * prices only events folded after the change (historical spend keeps its
 * historical rates), unlike the events-scan paths which re-price the whole
 * log. Bump {@link ProjectionDefinition.stateVersion} whenever the state
 * shape or fold semantics change, so persisted checkpoint rows are discarded
 * instead of folded forward.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @returns the unit definition to register on `ctx.sessionProjections`.
 */
export function billingTodaySpendDefinition(
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
): BillingUnitDefinition {
  const names = new Map(catalog.map(model => [model.id, model.name]))
  return {
    key: BILLING_UNIT_KEY,
    stateVersion: 1,
    stateSchema: billingUnitSchema,
    init: () => ({ dayKey: '', spend: emptyTodaySpend() }),
    apply: (state, event) => {
      const priced = priceEvent(event, billing, names)
      if (priced === undefined) return state
      if (state.dayKey === priced.dayKey) {
        return { dayKey: state.dayKey, spend: addEventContribution(state.spend, priced) }
      }
      // The session log is append-only and chronological, so an event whose
      // Beijing day is strictly older than the state's day cannot legally
      // follow it; ignore defensively to keep the persisted fold
      // deterministic under reordered or clock-skewed timestamps.
      if (state.dayKey !== '' && priced.dayKey < state.dayKey) return state
      // First priced event, or the session's first priced event of a new day:
      // the state resets to that day's spend.
      return { dayKey: priced.dayKey, spend: addEventContribution(emptyTodaySpend(), priced) }
    },
    wire: { viewSchema: billingUnitSchema, view: state => state },
  }
}

/** Fold a unit from init over one session's event log (the detached cold recipe). */
export function foldBillingUnit(
  unit: Pick<ProjectionDefinition<'billingTodaySpend', BillingUnitState>, 'init' | 'apply'>,
  events: readonly SessionEvent[],
): BillingUnitState {
  let state = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return state
}
