/**
 * The composer spend card's three bucket amounts, derived from the pushed
 * `billingTodaySpend` projection. The host fold already prices every sample
 * into the three disjoint billing buckets (cache-hit input, cache-miss input —
 * which includes cache writes, output including reasoning), so the card sums
 * the session's priced model rows instead of adding a Remote call or a second
 * fold. Keeping the derivation here (pure, no React) lets the sum and its
 * float reconciliation be tested on their own.
 * @module @rayadesu/dsh-client-ui-billing/spendBuckets
 */
import { formatCacheHitPercent } from "./format.js";
/** Sum one model row's three bucket costs. */
function bucketsOf(row) {
    return [row.cacheMissInputCost, row.cacheHitInputCost, row.outputCost];
}
/**
 * Fold one spend's model rows into the card's three bucket amounts.
 *
 * The rows carry float costs, so the three independently rendered values can
 * miss the displayed total by one unit in the last rendered decimal after each
 * is formatted to four decimals. The residual is absorbed by the largest
 * bucket — the only one where a 1e-4 nudge cannot be seen — so the card's rows
 * always add up to the total it shows in its header.
 * @param spend - the session bucket of the `billingTodaySpend` projection
 *   (the session's own events, every Beijing day).
 * @returns the three bucket totals plus the billed total.
 */
export function spendBucketsOf(spend) {
    let uncachedInput = 0;
    let cacheRead = 0;
    let output = 0;
    for (const row of spend.models) {
        const [miss, hit, out] = bucketsOf(row);
        uncachedInput += miss;
        cacheRead += hit;
        output += out;
    }
    const total = spend.total;
    const residual = total - (uncachedInput + cacheRead + output);
    if (residual !== 0) {
        if (uncachedInput >= cacheRead && uncachedInput >= output)
            uncachedInput += residual;
        else if (cacheRead >= output)
            cacheRead += residual;
        else
            output += residual;
    }
    return { uncachedInput, cacheRead, output, total };
}
/** Whether a spend has any priced amount to show (a zero card stays hidden). */
export function hasBilledSpend(spend) {
    return spend.total > 0 || spend.models.length > 0;
}
/**
 * Fold one spend's model rows into the three bucket TOKEN counts — the token
 * side of {@link spendBucketsOf}, so a surface that shows both (the panel's
 * today rows) reads one bucket's tokens and its cost from the same rows.
 *
 * No reconciliation is needed here: tokens are integers, so the three counts
 * always add up to the total the token line shows.
 * @param spend - the day's (or one session's) priced rows.
 * @returns the three bucket token counts.
 */
export function tokenBucketsOf(spend) {
    let uncachedInput = 0;
    let cacheRead = 0;
    let output = 0;
    for (const row of spend.models) {
        uncachedInput += row.cacheMissInputTokens;
        cacheRead += row.cacheHitInputTokens;
        output += row.outputTokens;
    }
    return { uncachedInput, cacheRead, output };
}
/**
 * The cache-hit share of one spend, in DSH's own percentage rule — the ratio of
 * the cache-read bucket to every PROMPT-side bucket (uncached input with cache
 * writes folded in, plus cache read), output excluded, exactly the split DSH's
 * `billedInputTokens` makes. Rendered by {@link formatCacheHitPercent}, i.e. an
 * integer percent that grows decimals only to keep a partial hit below 100.
 * @param spend - the day's priced rows.
 * @returns the percentage text without its `%`, or null when the spend billed no prompt input.
 */
export function cacheHitPercentOf(spend) {
    const tokens = tokenBucketsOf(spend);
    return formatCacheHitPercent(tokens.cacheRead, tokens.cacheRead + tokens.uncachedInput);
}
//# sourceMappingURL=spendBuckets.js.map