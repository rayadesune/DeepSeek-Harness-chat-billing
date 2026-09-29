/**
 * Shared display formatting for the billing badges: the balance-line currency
 * prefix, the CNY spend amount renderer, the token-count renderer, and the
 * cache-hit percentage. Both the header badge and the per-turn cost label
 * format through these, so the two entries cannot drift apart.
 */
import type { DeepSeekBalance } from '@rayadesu/dsh-llm-billing/types';
/** Currency prefix for one balance line; unknown codes render as a literal prefix. */
export declare function currencySymbol(currency: string): string;
/** The primary balance line, or undefined when the provider reports none. */
export declare function primaryLine(balance: DeepSeekBalance): {
    symbol: string;
    total: string;
} | undefined;
/**
 * CNY amount, up to four decimals with trailing zeros trimmed. The turn-cost
 * label's renderer; the balance line reuses the provider's own string, and
 * other spend figures go through {@link formatSpendSignificant} instead.
 *
 * The trailing-zero trim is anchored to the decimal part on purpose: a pattern
 * that also swallowed an integer `0` (`/\.?0+$/`) turned a whole amount of
 * zero into a bare `¥`, since every digit of `0.0000` is a trailing zero.
 */
export declare function formatSpend(amount: number): string;
/**
 * CNY spend amount at a fixed number of SIGNIFICANT digits (default three),
 * trailing zeros trimmed, prefixed with `¥` — and never finer than the panel's
 * own four-decimal resolution.
 *
 * Every spend figure the plugin renders goes through this: the day's own amount
 * and its three bucket costs, this session's spend and the parenthesized today
 * share after it, the per-model rows and their bucket breakdowns, the ranking
 * amounts, and the badge's own spend line. Four decimals are noise at these
 * magnitudes — their last digits move with every request (`¥0.5068` → `¥0.507`)
 * — while the four-decimal bound keeps a microscopic amount from growing a long
 * `¥0.00002` string that would widen its column: an amount that rounds to zero
 * there reads `¥0`. Only the BALANCE line keeps {@link formatSpend}'s plain four
 * decimals, because remaining credit is a balance, not a spend measurement.
 * @param amount - the amount to render.
 * @param digits - significant digits to keep (default 3).
 * @returns the rendered amount, e.g. `¥9.58`, `¥0.507`, `¥1230`, `¥0`.
 */
export declare function formatSpendSignificant(amount: number, digits?: number): string;
/**
 * A token count in DSH's own compact notation: `517` / `12.2K` / `517K` / `1.2M`.
 *
 * Mirrors ui-chat's `formatTokens` (`packages/client/ui-chat/src/client/chat/
 * token-format.ts`) rule for rule, so one shell never renders the same count two
 * ways. That rule reads: below 1e3 the plain integer (no digit grouping); below
 * 1e6 the shared `number.thousand` unit (`{value}K`); otherwise the shared
 * `number.million` unit (`{value}M`). A scaled value keeps one decimal while it
 * is below 100 and rounds to a whole number from 100 up (`12.2K`, but `517K`),
 * and there is no third unit, so 1.2e9 renders as `1200M` — exactly as DSH
 * renders it. The unit letters are identical in both DSH dictionaries, so they
 * are literals here rather than a locale lookup into the shared vocabulary.
 * @param count - the token count to render.
 * @returns the compact count, without the label's own ` tok` suffix.
 */
export declare function formatTokens(count: number): string;
/**
 * The cache-hit share of one prompt, in DSH's own percentage rule.
 *
 * Mirrors ui-chat's `formatCacheHitPercent`
 * (`packages/client/ui-chat/src/client/chat/token-format.ts`) rule for rule, so
 * one shell never prints the same ratio two ways: an integer percentage by
 * default, and — because a partial hit must never round up to a full one — just
 * enough extra decimals to stay below 100 when integer rounding would reach it
 * (`99`, `99.5`, `99.95`, …). The rounding runs in integer arithmetic with
 * positive ties going up, so it does not ride on binary-float precision.
 *
 * The ratio is over PROMPT-side tokens only (cache read over cache read plus
 * uncached input, the split DSH's own `billedInputTokens` makes); output tokens
 * never enter the denominator.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact aggregate prompt-side tokens.
 * @param decimalPlaces - ordinary-ratio precision; a partial hit that would
 * round to 100 automatically uses enough additional precision to stay honest.
 * @returns percentage text without its `%`, or null when there was no prompt input.
 */
export declare function formatCacheHitPercent(cacheReadTokens: number, promptTokens: number, decimalPlaces?: 0 | 1): string | null;
/** Every billed token bucket of one priced model row. */
export interface TokenBuckets {
    /** Cache-hit input tokens. */
    cacheHitInputTokens: number;
    /** Cache-miss input tokens (uncached input plus cache writes). */
    cacheMissInputTokens: number;
    /** Output tokens (reasoning included). */
    outputTokens: number;
}
/**
 * The total billed tokens of a priced row: the three buckets summed. Tokens are
 * already counted per bucket when they were priced, so a cache-hit input token
 * and an output token are both one token here — the number answers "how many
 * tokens did this cost", not "how many characters were sent".
 * @param row - one priced model row.
 * @returns the row's total token count.
 */
export declare function rowTokens(row: TokenBuckets): number;
//# sourceMappingURL=format.d.ts.map