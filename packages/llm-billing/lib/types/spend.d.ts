/**
 * Spend arithmetic: how two spends combine, how one is inverted, and how the
 * samples that could NOT be priced are tallied beside them. Pure, and knowing
 * nothing about rates, timezones or event shapes — the pricing engine
 * (`billing.ts`) owns all of that.
 * @module @rayadesu/dsh-llm-billing/spend
 */
import type { BillingEventContribution } from './pricing.ts';
import type { DeepSeekTodaySpend } from './types.ts';
/** A spend with no priced usage. */
export declare function emptyTodaySpend(): DeepSeekTodaySpend;
/** Note one sample that matched no pricing row and was therefore not billed. */
export declare function noteUnpriced(spend: DeepSeekTodaySpend, model: string, tokens: number): DeepSeekTodaySpend;
/**
 * Mutable model-row accumulator behind every spend fold. Rows keep first-seen
 * model order — the same shape a pure `addEventContribution` chain produces —
 * so the single-pass scan path and the pure public paths cannot diverge. One
 * `Map` lookup per contribution instead of a per-event array copy: the huge
 * event-log folds allocate one row object per model, not one intermediate
 * array per event.
 */
export declare class SpendAccumulator {
    private readonly rows;
    private total;
    /** Add one priced contribution. */
    add(priced: BillingEventContribution): void;
    /** The folded spend; the accumulator stays usable afterwards. */
    finish(): DeepSeekTodaySpend;
}
/** The additive inverse of one spend (pure): used to replace a priced sample. */
export declare function negateSpend(spend: DeepSeekTodaySpend): DeepSeekTodaySpend;
/**
 * Subtract one spend from another (pure). Rows that cancel out completely are
 * dropped so a replaced sample leaves no zero row behind.
 * @param target - the spend to subtract from.
 * @param source - the spend to remove.
 * @returns the difference.
 */
export declare function subtractSpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend;
/** The contribution as a one-row spend (the shape a sample keeps for replacement). */
export declare function contributionSpend(priced: BillingEventContribution): DeepSeekTodaySpend;
/**
 * Merge one priced event's contribution into an accumulator spend (pure:
 * returns a new spend, never mutates its input).
 * @param spend - the accumulator (per session and day, or across sessions).
 * @param priced - the priced contribution to add.
 * @returns the merged spend.
 */
export declare function addEventContribution(spend: DeepSeekTodaySpend, priced: BillingEventContribution): DeepSeekTodaySpend;
/**
 * Sum two spends (per session and day, or across sessions) into one (pure:
 * returns a new spend, never mutates its inputs).
 * @param target - the accumulator spend.
 * @param source - the spend to add.
 * @returns the summed spend.
 */
export declare function mergeTodaySpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend;
//# sourceMappingURL=spend.d.ts.map