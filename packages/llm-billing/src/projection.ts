/**
 * `billingTodaySpend` session-projection unit: per-session billed spend,
 * folded eagerly by the DSH projection drive over committed session events and
 * checkpointed by the projection cache. The state keeps the session's LATEST
 * priced Beijing day, its whole-session total, the fork boundary, the latest
 * request model, and the last priced attempt sample (DSH's same-step
 * replacement rule); the aggregate "today" read sums the units whose `dayKey`
 * matches the current Beijing day — zero full-log scans once the fold is warm.
 *
 * The unit's fold IS the shared pricing fold ({@link applyBillingEvent}), so
 * the projection path and the events-scan paths cannot drift. The unit is
 * client-visible (`wire` = identity) because the persisted-cache read ladder
 * (`sessionProjectionCache.cachedSnapshot` / registry `restore`) serves only
 * wired units, and because the browser half reads this value through
 * `useProjection` instead of polling a Remote; the wire value is the state
 * itself.
 * @module @rayadesu/dsh-llm-billing/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { BillingFoldState, ResolvedBilling } from './billing.ts'
import { applyBillingEvent, emptyBillingFoldState } from './billing.ts'

/** The projection key this unit owns. */
export const BILLING_UNIT_KEY = 'billingTodaySpend'

/**
 * The unit's state is the shared billing fold state: the latest priced
 * Beijing day, the whole-session total, the fork boundary, the latest request
 * model, and the last priced attempt sample. Plain JSON, as the
 * persisted-cache contract requires. The fold is boundary-aware: it prices
 * only the session's OWN events (a fork child's inherited prefix is skipped),
 * so both totals match the Remote paths and the client can read them without
 * a Remote call.
 */
export type BillingUnitState = BillingFoldState

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

/**
 * The advisory tally of usage that could not be billed at its own rate (see
 * `DeepSeekTodaySpend.unpriced` / `.estimated`). Declared here because the
 * unit's schemas are `.strict()`: an undeclared key REJECTS the whole unit
 * rather than being stripped, so adding these fields to the fold without
 * declaring them here would fail every projection fold the moment a sample
 * went unpriced.
 */
const usageTallySchema = z.object({
  events: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  models: z.array(z.string()),
}).strict()

const todaySpendSchema = z.object({
  total: z.number().nonnegative(),
  models: z.array(modelRowSchema),
  unpriced: usageTallySchema.optional(),
  estimated: usageTallySchema.optional(),
}).strict()

const billingUnitSchema = z.object({
  dayKey: z.string(),
  spend: todaySpendSchema,
  session: todaySpendSchema,
  inheritedEventCount: z.number().int().nonnegative(),
  model: z.string(),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    dayKey: z.string(),
    spend: todaySpendSchema,
  }).strict().nullable(),
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
 * Build the `billingTodaySpend` unit for one resolved pricing table. Published
 * rate revisions travel inside the closure and are resolved per sample
 * timestamp, so a re-priced series bills its own history correctly however late
 * a log is folded; only a configuration change (editing `billing.models`) is
 * fixed at registration, and it re-prices just the events folded afterwards
 * (the events-scan paths re-price the whole log). Bump
 * {@link ProjectionDefinition.stateVersion} whenever the state shape or fold
 * semantics change, so persisted checkpoint rows are discarded instead of
 * folded forward.
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
    // v4: rate revisions resolved per sample timestamp (the V4 Flash series is
    // re-priced from 2026-09-10 12:00 Beijing), on top of v3's DSH-aligned
    // attempt pricing, v2's boundary-aware fold, and the whole-session total.
    // A row checkpointed by the previous version priced every sample at one
    // flat pair of rates, so rows folded after the re-pricing instant would
    // keep the superseded rates: bumping discards them and refolds.
    stateVersion: 4,
    stateSchema: billingUnitSchema,
    init: (_header?: SessionHeader, inheritedEventCount?: SessionLogOffset) =>
      emptyBillingFoldState(Number(inheritedEventCount ?? 0)),
    apply: (state, event) => applyBillingEvent(state, event, billing, names),
    wire: { viewSchema: billingUnitSchema, view: state => state },
  }
}

/** The fold halves of a billing unit, as the detached cold recipes call them. */
export interface BillingUnitFold {
  /**
   * Initial state for the empty log. DSH ≤ 0.1.1-rc.2 declared `init()` with
   * no parameters; 0.1.2-alpha.5+ passes the Session header and inherited
   * count. Detached folds call it with no arguments and apply the boundary
   * themselves (see {@link foldOwnBilling}), so both call shapes stay valid.
   */
  init(...metadata: never[]): BillingUnitState
  /** Pure transition: previous state + one committed event → next state. */
  apply(state: BillingUnitState, event: SessionEvent): BillingUnitState
}

/** Fold a unit from init over one session's event log (the detached cold recipe). */
export function foldBillingUnit(
  unit: BillingUnitFold,
  events: readonly SessionEvent[],
): BillingUnitState {
  let state = unit.init()
  for (const event of events) state = unit.apply(state, event)
  return state
}

/**
 * Fold a unit from init over one session's OWN events only: the complete log
 * minus its inherited fork prefix (`seq < seedLength`). A forked child's
 * prefix is a verbatim copy of events already billed in its source session,
 * so the detached cold recipe must skip it, or the same model output is
 * priced once per copy.
 * @param unit - the billing unit's fold halves.
 * @param events - the session's complete event log (in seq order).
 * @param seedLength - the durable inherited-prefix boundary
 *   ({@link forkBoundaryOf}); 0 for an unseeded session.
 * @returns the unit state folded over the session's own events.
 */
export function foldOwnBilling(
  unit: BillingUnitFold,
  events: readonly SessionEvent[],
  seedLength = 0,
): BillingUnitState {
  let state = unit.init()
  for (const event of events) {
    if (event.seq < seedLength) continue
    state = unit.apply(state, event)
  }
  return state
}
