/**
 * The read-path cache: one 60-second Beijing-day window per process with
 * in-flight coalescing and stale-while-revalidate, plus the bounded fan-out
 * helper the cold scan parallelises with. Split out of `today-spend.ts` — it is
 * the one piece that knows nothing about sessions at all.
 * @module @rayadesu/dsh-llm-billing/cache
 */

import { beijingDayKey } from './billing.ts'
import type { DeepSeekTodaySpend } from './types.ts'

/**
 * Bounded parallel fan-out: run `run` over `items` with at most `limit` in
 * flight. A shared index counter hands each worker its next job, so the
 * dispatch is O(n) overall (array `shift()` would be O(n) per pop). The cold
 * scan parallelises its session reads through this.
 */
export async function withConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const total = items.length
  let next = 0
  await Promise.all(Array.from(
    { length: Math.min(limit, total) },
    async () => {
      for (let job = next; job < total; job = next) {
        next += 1
        await run(items[job]!)
      }
    },
  ))
}

/**
 * How many sessions one uninterrupted slice of a scan may fold before the scan
 * hands the host's event loop back.
 */
export const SCAN_YIELD_SESSIONS = 8

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
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

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
export class TodaySpendCache<T = DeepSeekTodaySpend> {
  private cachedDayKey: string | undefined
  private cachedValue: T | undefined
  private cachedAt = 0
  private inFlight: Promise<T> | undefined

  /**
   * @param scan - the aggregate computation behind a miss.
   * @param ttlMs - time window in milliseconds (default 60 000).
   * @param now - clock source (injectable for tests).
   */
  constructor(
    private readonly scan: (dayKey: string) => Promise<T>,
    private readonly ttlMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
  get(force = false): Promise<T> {
    const now = this.now()
    const dayKey = beijingDayKey(now)
    // Only the queried day's value is servable: yesterday's total is not
    // today's, so a rollover blocks exactly like a cold read.
    const cached = this.cachedDayKey === dayKey ? this.cachedValue : undefined
    if (!force && cached !== undefined) {
      if (now.getTime() - this.cachedAt < this.ttlMs) return Promise.resolve(cached)
      // Stale, same day: serve it now and refresh behind it. The background
      // pass must not surface as an unhandled rejection.
      if (this.inFlight === undefined) void this.run(dayKey).catch(() => undefined)
      return Promise.resolve(cached)
    }
    // No value for the queried day (or a forced read): a scan already in
    // flight is fresh by definition, so a forced caller joins it instead of
    // starting a second pass.
    if (this.inFlight !== undefined) return this.inFlight
    return this.run(dayKey)
  }

  /**
   * Run one scan and publish its result.
   *
   * `cachedAt` is stamped when the scan COMPLETES, not when it starts: a pass
   * slower than the TTL would otherwise be born expired, and every read after
   * it would start another pass back-to-back.
   * @param dayKey - the Beijing day the pass aggregates.
   * @returns the freshly scanned value.
   */
  private run(dayKey: string): Promise<T> {
    const run = this.scan(dayKey).then((value) => {
      this.cachedDayKey = dayKey
      this.cachedValue = value
      this.cachedAt = this.now().getTime()
      return value
    }).finally(() => { this.inFlight = undefined })
    this.inFlight = run
    return run
  }
}

/** Max session-ids kept in the scanner's cold-resolution cache before eviction. */
export const COLD_RESOLVE_CACHE_LIMIT = 1024
/** Max session-ids kept in the scanner's cold-failure cache before eviction. */
export const COLD_FAILED_CACHE_LIMIT = 1024
/**
 * How long a failed cold resolution is remembered before it is retried even
 * though the log is unchanged. Most read failures are transient (a lock held
 * during a concurrent write), so remembering them forever would cost a session
 * for the rest of the process.
 */
export const COLD_FAILED_RETRY_MS = 300_000
/** Bounded parallel fan-out for cold-session resolution. */
export const COLD_RESOLVE_CONCURRENCY = 8

/** The live SessionStore slice a scan reads (resolved once per scan). */