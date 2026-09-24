/**
 * The read-path cache: one 60-second Beijing-day window per process with
 * in-flight coalescing, plus the bounded fan-out helper the cold scan parallelises
 * with. Split out of `today-spend.ts` — it is the one piece that knows nothing
 * about sessions at all.
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
 * The A1 cache: one Beijing-day key + a 60s window, an in-flight promise that
 * coalesces concurrent misses, and a `force` bypass for the manual refresh
 * path. Cross-day invalidation is automatic (the day key changes); a failed
 * scan leaves the previous value in place and retries on the next call.
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
   * @param force - bypass the time window (manual refresh); the day-key gate
   *   and the in-flight coalescing still apply to non-force callers.
   * @returns today's spend.
   */
  get(force = false): Promise<T> {
    const now = this.now()
    const dayKey = beijingDayKey(now)
    if (!force && this.cachedDayKey === dayKey && this.cachedValue !== undefined
      && now.getTime() - this.cachedAt < this.ttlMs) {
      return Promise.resolve(this.cachedValue)
    }
    // A scan already in flight is fresh by definition, so a forced caller
    // joins it instead of starting a second pass.
    if (this.inFlight !== undefined) return this.inFlight
    const run = (async (): Promise<T> => {
      try {
        const value = await this.scan(dayKey)
        this.cachedDayKey = dayKey
        this.cachedValue = value
        this.cachedAt = now.getTime()
        return value
      } finally {
        this.inFlight = undefined
      }
    })()
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