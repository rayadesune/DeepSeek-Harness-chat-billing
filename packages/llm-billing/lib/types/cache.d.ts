/**
 * The read-path cache: one 60-second Beijing-day window per process with
 * in-flight coalescing and stale-while-revalidate, plus the bounded fan-out
 * helper the cold scan parallelises with. Split out of `today-spend.ts` — it is
 * the one piece that knows nothing about sessions at all.
 * @module @rayadesu/dsh-llm-billing/cache
 */
import type { DeepSeekTodaySpend } from './types.ts';
/**
 * Bounded parallel fan-out: run `run` over `items` with at most `limit` in
 * flight. A shared index counter hands each worker its next job, so the
 * dispatch is O(n) overall (array `shift()` would be O(n) per pop). The cold
 * scan parallelises its session reads through this.
 */
export declare function withConcurrency<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void>;
/**
 * How many sessions one uninterrupted slice of a scan may fold before the scan
 * hands the host's event loop back.
 */
export declare const SCAN_YIELD_SESSIONS = 8;
/**
 * Hand the host's event loop back between session folds.
 *
 * The folds are synchronous CPU work — the pricing fold and `foldSessionTitle`
 * walk a whole log without an `await` — and they run on the same main loop that
 * serves the GUI's own round trips (switching model, creating a session). A
 * scan that never yields blocks those requests for its entire duration, which
 * is exactly what a cold scan did. `setImmediate` schedules the continuation
 * for the check phase, so the poll phase is served first: pending I/O — the
 * GUI's requests among it — completes before the next slice of folding.
 */
export declare function yieldToEventLoop(): Promise<void>;
/**
 * The A1 cache: one Beijing-day key + a 60s window, an in-flight promise that
 * coalesces concurrent misses, a stale-while-revalidate path so a lapsed window
 * never makes a plain reader wait on the day's scan, and a `force` bypass that
 * makes a reader wait for a fresh scan instead. Cross-day invalidation is
 * automatic (the day key changes, and the previous day's value is never
 * served); a failed scan leaves the previous value in place and retries on the
 * next call.
 * @typeParam T - the cached aggregate's value shape (the spend or its
 *   per-session breakdown).
 */
export declare class TodaySpendCache<T = DeepSeekTodaySpend> {
    private readonly scan;
    private readonly ttlMs;
    private readonly now;
    private cachedDayKey;
    private cachedValue;
    private cachedAt;
    private inFlight;
    /**
     * @param scan - the aggregate computation behind a miss.
     * @param ttlMs - time window in milliseconds (default 60 000).
     * @param now - clock source (injectable for tests).
     */
    constructor(scan: (dayKey: string) => Promise<T>, ttlMs?: number, now?: () => Date);
    /**
     * Read today's spend, cached per Beijing day within the TTL window.
     *
     * Two reads share this entry point, and `force` is the switch between them —
     * its two values are exactly the two policies a caller can want, so there is
     * no third mode:
     *
     * - **plain (`force: false`)** — stale-while-revalidate. A value for the
     *   queried day is returned AT ONCE; once its window has lapsed the scan that
     *   refreshes it runs behind the answer. This is the read for everything the
     *   user did not just cause: a mount, a panel open, a poll, a session switch.
     * - **forced (`force: true`)** — recompute now and WAIT: both the window and
     *   the stale shortcut are bypassed. This is the read for a manual refresh and
     *   for a settled turn, which have just changed the answer and must not be
     *   handed the value from before they ran. A plain read there would report the
     *   day's pre-turn figure one turn late.
     *
     * A day with no value yet (the first read of the day, or a Beijing-day
     * rollover — yesterday's total is never served as today's) waits either way,
     * because there is nothing honest to show. A failed revalidation leaves the
     * previous value in place, and a pass already in flight is joined rather than
     * duplicated.
     * @param force - `true` recomputes now and waits; `false` serves the value on
     *   hand and refreshes behind it.
     * @returns today's spend.
     */
    get(force?: boolean): Promise<T>;
    /**
     * Run one scan and publish its result.
     *
     * `cachedAt` is stamped when the scan COMPLETES, not when it starts: a pass
     * slower than the TTL would otherwise be born expired, and every read after
     * it would start another pass back-to-back.
     * @param dayKey - the Beijing day the pass aggregates.
     * @returns the freshly scanned value.
     */
    private run;
}
/** Max session-ids kept in the scanner's cold-resolution cache before eviction. */
export declare const COLD_RESOLVE_CACHE_LIMIT = 1024;
/** Max session-ids kept in the scanner's cold-failure cache before eviction. */
export declare const COLD_FAILED_CACHE_LIMIT = 1024;
/**
 * How long a failed cold resolution is remembered before it is retried even
 * though the log is unchanged. Most read failures are transient (a lock held
 * during a concurrent write), so remembering them forever would cost a session
 * for the rest of the process.
 */
export declare const COLD_FAILED_RETRY_MS = 300000;
/** Bounded parallel fan-out for cold-session resolution. */
export declare const COLD_RESOLVE_CONCURRENCY = 8;
/** The live SessionStore slice a scan reads (resolved once per scan). */ 
//# sourceMappingURL=cache.d.ts.map