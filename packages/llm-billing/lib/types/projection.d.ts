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
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { BillingFoldState, ResolvedBilling } from './billing.ts';
/** The projection key this unit owns. */
export declare const BILLING_UNIT_KEY = "billingTodaySpend";
/**
 * The unit's state is the shared billing fold state: the latest priced
 * Beijing day, the whole-session total, the fork boundary, the latest request
 * model, and the last priced attempt sample. Plain JSON, as the
 * persisted-cache contract requires. The fold is boundary-aware: it prices
 * only the session's OWN events (a fork child's inherited prefix is skipped),
 * so both totals match the Remote paths and the client can read them without
 * a Remote call.
 */
export type BillingUnitState = BillingFoldState;
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        billingTodaySpend: BillingUnitState;
    }
    interface SessionProjectionMap {
        billingTodaySpend: BillingUnitState;
    }
}
/**
 * The unit definition with a required `wire` — the shape {@link register}
 * accepts for a client-visible unit (the plain `ProjectionDefinition` type
 * leaves `wire` optional).
 */
export type BillingUnitDefinition = Omit<ProjectionDefinition<'billingTodaySpend', BillingUnitState>, 'wire'> & {
    wire: NonNullable<ProjectionDefinition<'billingTodaySpend', BillingUnitState>['wire']>;
};
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
export declare function billingTodaySpendDefinition(billing: ResolvedBilling, catalog: readonly {
    id: string;
    name: string;
}[]): BillingUnitDefinition;
/** The fold halves of a billing unit, as the detached cold recipes call them. */
export interface BillingUnitFold {
    /**
     * Initial state for the empty log. DSH ≤ 0.1.1-rc.2 declared `init()` with
     * no parameters; 0.1.2-alpha.5+ passes the Session header and inherited
     * count. Detached folds call it with no arguments and apply the boundary
     * themselves (see {@link foldOwnBilling}), so both call shapes stay valid.
     */
    init(...metadata: never[]): BillingUnitState;
    /** Pure transition: previous state + one committed event → next state. */
    apply(state: BillingUnitState, event: SessionEvent): BillingUnitState;
}
/** Fold a unit from init over one session's event log (the detached cold recipe). */
export declare function foldBillingUnit(unit: BillingUnitFold, events: readonly SessionEvent[]): BillingUnitState;
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
export declare function foldOwnBilling(unit: BillingUnitFold, events: readonly SessionEvent[], seedLength?: number): BillingUnitState;
//# sourceMappingURL=projection.d.ts.map