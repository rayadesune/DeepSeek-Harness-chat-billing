/**
 * DeepSeek billing aggregation: the session/turn/today spend computations
 * over the pricing engine (`pricing.ts`) and the per-event fold state machine
 * (`fold.ts`). Pure functions over session events, so the whole spend is
 * testable without a key and the Remote gateway stays transport-free.
 *
 * The fold in {@link BillingFolder} / {@link applyBillingEvent} (see `fold.ts`)
 * and the per-event pricing in `pricing.ts` are the single source of truth the
 * events-scan paths, the session-projection unit, and the scanner all price
 * through, so a pricing-table change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/billing
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { DeepSeekSessionSpend, DeepSeekSessionTurnSpends, DeepSeekTodaySpend, DeepSeekTurnSpend } from './types.ts';
import type { ResolvedBilling } from './pricing.ts';
export * from './beijing-time.ts';
export * from './spend.ts';
export * from './pricing.ts';
export * from './fold.ts';
/**
 * Structural source of a session's durable inherited-prefix boundary. The
 * exact cut moved between DSH runtimes: since 0.1.2-alpha.4,
 * `SessionHeader.seedLength` was removed (the header now carries only
 * `isSeeded`: boolean) and the count moved to `Session.inheritedEventCount` /
 * `SessionHandle.inheritedEventCount`. The reader prefers that exact-count
 * field and otherwise falls back to the older `seedLength` on the durable
 * header, so the same plugin code prices correctly across the live-session
 * and handle surfaces it still meets.
 */
export interface ForkBoundarySource {
    /** 0.1.2-alpha.4+: `Session.inheritedEventCount` / `SessionHandle.inheritedEventCount`. */
    readonly inheritedEventCount?: number;
    /** ≤ 0.1.1-rc.2 live-session header: `SessionHeader.seedLength`. */
    readonly seedLength?: number;
    /** Durable header slice of a live session or opened handle (its `seedLength`). */
    readonly header?: {
        readonly seedLength?: number;
        readonly isSeeded?: boolean;
    };
}
/**
 * The durable inherited-prefix boundary of one session: the number of leading
 * events it inherited verbatim from its fork source, 0 for a session created
 * without a seed. A forked session (or any seeded replay) carries that count
 * in its session state; every event with `seq < seedLength` is a copy of an
 * event already billed in that source session, so pricing must skip them or
 * the same model output is counted once per copy. Accepts the durable field
 * of the live-session and handle surfaces (see {@link ForkBoundarySource}).
 * @param source - the session, header slice, or opened handle carrying the
 *   boundary; `undefined` reads as 0.
 * @returns the inherited-prefix length; 0 for an unseeded session.
 */
export declare function forkBoundaryOf(source: ForkBoundarySource | undefined): number;
/** Whether a durable header marks a fork-inherited (seeded) session across the live-session and handle surfaces. */
export declare function isSeededSession(header: {
    readonly seedLength?: number;
    readonly isSeeded?: boolean;
} | undefined): boolean;
/**
 * Price one session's complete event log at the official per-model rates,
 * with DSH's attempt semantics: every provider-reported sample (an
 * `assistant/message`'s usage, or an `assistant/attempt`'s stream usage)
 * contributes, a later sample for the same `(turn, step)` replaces the earlier
 * one, and `llm/retry-started` makes the retried attempt add.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param startSeq - when provided, only events with `seq >= startSeq`
 *   contribute: a forked session's inherited prefix (see {@link forkBoundaryOf})
 *   is skipped, so each model output is billed only in the session that
 *   produced it.
 * @returns the session's total cost plus one row per priced model.
 */
export declare function computeSessionSpend(events: readonly SessionEvent[], billing: ResolvedBilling, catalog: readonly {
    id: string;
    name: string;
}[], startSeq?: number): DeepSeekSessionSpend;
/**
 * Price one completed Turn's billed usage, identified by its closing
 * assistant message id. The turn's events are those between its `turn/start`
 * and `turn/end` (both matched by the message's own turn coordinate), priced
 * with the same attempt semantics as {@link computeSessionSpend}. A message
 * that cannot be located, a turn without bracketing `turn/start` / `turn/end`
 * events (for example after compaction), or a session with no priced usage
 * prices to zero.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param messageId - the closing assistant message's durable id.
 * @returns the turn's total cost in CNY.
 */
export declare function computeTurnSpend(events: readonly SessionEvent[], billing: ResolvedBilling, catalog: readonly {
    id: string;
    name: string;
}[], messageId: string): DeepSeekTurnSpend;
/**
 * Incremental single-pass fold of one session's completed-Turn costs, keyed by
 * the id of every assistant message inside each Turn. Feeding the fold only
 * the appended tail keeps a growing session's map current in O(new events)
 * instead of re-scanning the whole log per message.
 *
 * Semantics are exactly {@link computeTurnSpend}'s: a Turn is the
 * `turn/start`..`turn/end` range (matched by the event's own turn coordinate),
 * every priced event inside it contributes at its own timestamp's rate, and a
 * message outside any bracket contributes nothing.
 */
export declare class SessionTurnSpendFolder {
    private readonly billing;
    private readonly catalog;
    private readonly rows;
    private ids;
    /** Events of the open Turn, folded with the shared attempt semantics on close. */
    private events;
    private open;
    /** Events already fed; a shorter log resets the fold. */
    private cursor;
    /**
     * @param billing - resolved pricing with peak-hour windows.
     * @param catalog - model display rows, in presentation order.
     */
    constructor(billing: ResolvedBilling, catalog: readonly {
        id: string;
        name: string;
    }[]);
    /** How many events have been folded so far (the host's incremental cursor). */
    get processed(): number;
    /**
     * Fold every event from the cursor to the end of the log. A log shorter than
     * the cursor (rewritten session) restarts the fold from an empty state.
     * @param events - the session's complete event log, in seq order.
     */
    feed(events: readonly SessionEvent[]): void;
    /** The folded map; the fold stays usable afterwards. */
    finish(): DeepSeekSessionTurnSpends;
    /** Drop the fold state so the next feed starts from the log's beginning. */
    private reset;
}
/**
 * Price every completed Turn of one session in a single pass (the pure
 * equivalent of {@link SessionTurnSpendFolder}).
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @returns one row per assistant message inside a completed Turn, in log order.
 */
export declare function computeSessionTurnSpends(events: readonly SessionEvent[], billing: ResolvedBilling, catalog: readonly {
    id: string;
    name: string;
}[]): DeepSeekSessionTurnSpends;
/**
 * Price one session's log for the Beijing-time calendar day of `now`. Events
 * after the reference day are ignored; the fold's latest-day state then
 * answers the query exactly (empty when the session's latest priced day is not
 * the reference day). Pricing follows {@link applyBillingEvent} (attempt
 * samples with same-step replacement).
 *
 * The fold's `(turn, step)` replacement slot is per session, so callers must
 * pass ONE session's log; aggregate across sessions with
 * {@link mergeTodaySpend}.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param now - the reference moment whose Beijing-time calendar day is "today".
 * @returns today's total cost plus one row per priced model.
 */
export declare function computeTodaySpend(events: readonly SessionEvent[], billing: ResolvedBilling, catalog: readonly {
    id: string;
    name: string;
}[], now?: Date): DeepSeekTodaySpend;
//# sourceMappingURL=billing.d.ts.map