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
import { z } from 'zod';
import { applyBillingEvent, emptyBillingFoldState } from "./billing.js";
/** The projection key this unit owns. */
export const BILLING_UNIT_KEY = 'billingTodaySpend';
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
}).strict();
/**
 * The advisory tally of usage that could not be billed at its own rate (see
 * `DeepSeekTodaySpend.unpriced`). Declared here because the
 * unit's schemas are `.strict()`: an undeclared key REJECTS the whole unit
 * rather than being stripped, so adding these fields to the fold without
 * declaring them here would fail every projection fold the moment a sample
 * went unpriced.
 */
const usageTallySchema = z.object({
    events: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    models: z.array(z.string()),
}).strict();
const todaySpendSchema = z.object({
    total: z.number().nonnegative(),
    models: z.array(modelRowSchema),
    unpriced: usageTallySchema.optional(),
}).strict();
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
}).strict();
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
export function billingTodaySpendDefinition(billing, catalog) {
    const names = new Map(catalog.map(model => [model.id, model.name]));
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
        init: (_header, inheritedEventCount) => emptyBillingFoldState(Number(inheritedEventCount ?? 0)),
        apply: (state, event) => applyBillingEvent(state, event, billing, names),
        wire: { viewSchema: billingUnitSchema, view: state => state },
    };
}
/** Fold a unit from init over one session's event log (the detached cold recipe). */
export function foldBillingUnit(unit, events) {
    let state = unit.init();
    for (const event of events)
        state = unit.apply(state, event);
    return state;
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
export function foldOwnBilling(unit, events, seedLength = 0) {
    let state = unit.init();
    for (const event of events) {
        if (event.seq < seedLength)
            continue;
        state = unit.apply(state, event);
    }
    return state;
}
//# sourceMappingURL=projection.js.map