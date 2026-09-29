/**
 * The single-pass fold state machine that turns a committed event log into a
 * session's billed spend. Consumes the pricing primitives in `pricing.ts`
 * (`priceUsage` / `reportUnpricedModel`) and the spend algebra in `spend.ts`
 * (`addEventContribution` / `subtractSpend` / `noteUnpriced` / `emptyTodaySpend`);
 * every scan path prices through {@link applyBillingEvent} so a pricing-table
 * change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/fold
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { DeepSeekTodaySpend } from './types.ts';
import type { ResolvedBilling } from './pricing.ts';
/**
 * One priced attempt sample kept for same-step replacement: DSH can report the
 * same `(turn, step)` twice (an `assistant/attempt` stream and the
 * `assistant/message` that assembles from it), and a later sample replaces the
 * earlier one instead of adding to it. `llm/retry-started` clears the slot, so
 * a retried attempt adds rather than replaces (both requests were billed).
 */
export interface BillingFoldSample {
    /** Turn of the producing attempt. */
    turn: number;
    /** Step of the producing attempt. */
    step: number;
    /** Beijing day of the sample's timestamp. */
    dayKey: string;
    /** The sample's contribution as a one-row spend (subtracted on replacement). */
    spend: DeepSeekTodaySpend;
}
/**
 * Plain-JSON fold state of one session's billed spend: the latest priced day,
 * the whole-session total, the fork boundary, the model of the latest request
 * (needed to price an `assistant/attempt`, which carries no route), and the
 * last sample kept for replacement.
 */
export interface BillingFoldState {
    /** Beijing-time calendar-day key of `spend`; `''` for no priced usage. */
    dayKey: string;
    /** The spend of the session's latest priced Beijing day (own events only). */
    spend: DeepSeekTodaySpend;
    /** The spend of the session's OWN events across every day. */
    session: DeepSeekTodaySpend;
    /** Fork-inherited prefix length; events below it belong to the source session. */
    inheritedEventCount: number;
    /** Wire model of the latest `request/header`; `''` before the first one. */
    model: string;
    /** Latest priced attempt sample, for same-step replacement. */
    last: BillingFoldSample | null;
}
/** The empty fold state for one fork boundary. */
export declare function emptyBillingFoldState(inheritedEventCount?: number): BillingFoldState;
/**
 * Fold one committed event into a session's billed-spend state.
 *
 * Priced samples come from `assistant/message` (its own reported usage, or the
 * stream's last usage chunk) and `assistant/attempt` (the stream's last usage
 * chunk, priced with the model of the latest `request/header`, since an
 * attempt carries no route). A sample for the same `(turn, step)` replaces the
 * previous one; `llm/retry-started` closes the replacement slot so a retried
 * attempt adds. Every other event is inert and returns the same state
 * reference.
 * @param state - the previous fold state.
 * @param event - the committed event.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the next state (the same reference when nothing was priced).
 */
export declare function applyBillingEvent(state: BillingFoldState, event: SessionEvent, billing: ResolvedBilling, names: ReadonlyMap<string, string>): BillingFoldState;
/**
 * Mutable wrapper over {@link applyBillingEvent} for the pure pricing paths:
 * feed events in order, read the folded spend.
 */
export declare class BillingFolder {
    private readonly billing;
    private state;
    /**
     * @param billing - resolved pricing with peak-hour windows.
     * @param catalog - model display rows, in presentation order.
     * @param inheritedEventCount - fork boundary to skip (default 0).
     */
    constructor(billing: ResolvedBilling, catalog: readonly {
        id: string;
        name: string;
    }[], inheritedEventCount?: number);
    private readonly names;
    /** Fold one event. */
    add(event: SessionEvent): void;
    /** Fold every event, in order. */
    addAll(events: readonly SessionEvent[]): void;
    /** The folded state (live reference; do not mutate). */
    get fold(): BillingFoldState;
}
//# sourceMappingURL=fold.d.ts.map