/**
 * Today-spend read path: the 60-second Beijing-day cache with in-flight
 * coalescing and a force bypass (plan A1), plus the two scan strategies that
 * compute the aggregate behind a cache miss:
 *
 * - projection path (plan C): live sessions read their eagerly folded
 *   `billingTodaySpend` projection cell; cold sessions resolve through the
 *   projection-cache ladder (cached row + tail replay + registry restore,
 *   with write-back) or, without the cache service, one detached local fold
 *   over a full `inspect`. Persisted revisions gate every cold read, so a
 *   session whose log did not change since the last resolution costs nothing.
 * - events path (plans A2/A3): collect only today's events (per-event
 *   Beijing-day filter during collection) with a hard cap, skipping sessions
 *   whose persisted revision is unchanged since the last scan.
 *
 * Both strategies run behind the same {@link TodaySpendCache}, so a miss
 * happens at most once per 60 seconds per process, and a manual refresh
 * (`force`) bypasses the time window but keeps the revision caches — an
 * unchanged log provably cannot change the aggregate.
 * @module @rayadesu/dsh-llm-billing/today-spend
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { ResolvedBilling } from './billing.ts'
import { beijingDayKey, computeTodaySpend, emptyTodaySpend, mergeTodaySpend } from './billing.ts'
import type { DeepSeekTodaySpend } from './types.ts'
import { BILLING_UNIT_KEY, foldBillingUnit, type BillingUnitState } from './projection.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Structural slice of a live session the scanner reads. */
export interface ScannerSession {
  readonly id: SessionId
  readonly events: readonly SessionEvent[]
}

/** Structural slice of a listed persisted session. */
export interface ScannerPersistedHeader {
  readonly id: SessionId
}

/** Structural slices of the optional services the scanner reads through. */
export interface TodaySpendScannerDeps {
  /** Resolves the live SessionStore at scan time (absent in headless assemblies). */
  sessions?: () => { list(): readonly ScannerSession[] } | undefined
  /** Resolves the persistence backend at scan time (absent without persistence). */
  persistence?: () => {
    listSnapshots(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
    inspect(id: SessionId): Promise<{ events: readonly SessionEvent[] }>
  } | undefined
  /** Resolves the session-projection registry at scan time (absent → events path). */
  projections?: () => {
    stateOf(session: ScannerSession, key: typeof BILLING_UNIT_KEY): BillingUnitState | undefined
  } | undefined
  /** Resolves the projection cache at scan time (absent → detached fold for cold sessions). */
  projectionCache?: () => {
    coldSnapshot(id: SessionId): Promise<{ values: Partial<Record<typeof BILLING_UNIT_KEY, BillingUnitState>> }>
  } | undefined
  /**
   * Registers the billing unit on the projection registry, called once before
   * the first projection-path scan. The registry builds cells lazily over the
   * in-memory log, so events committed before registration are folded on
   * first touch — late registration is safe by design.
   */
  ensureUnit?: () => void
  /** The billing unit's fold (the projection path's detached cold recipe). */
  unit: Pick<ProjectionDefinition<'billingTodaySpend', BillingUnitState>, 'init' | 'apply'>
  /** Hard cap on today's events collected by the events path. */
  maxEvents: number
  /** Warn sink for truncation and unreadable sessions. */
  logger: { warn(message: string): void }
  /** Pricing table resolved from the plugin config. */
  billing: ResolvedBilling
  /** Model display rows, in presentation order. */
  catalog: readonly { id: string; name: string }[]
}

/** Bounded parallel fan-out: run `run` over `items` with at most `limit` in flight. */
async function withConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  await Promise.all(Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) await run(job)
    },
  ))
}

/**
 * The A1 cache: one Beijing-day key + a 60s window, an in-flight promise that
 * coalesces concurrent misses, and a `force` bypass for the manual refresh
 * path. Cross-day invalidation is automatic (the day key changes); a failed
 * scan leaves the previous value in place and retries on the next call.
 */
export class TodaySpendCache {
  private cachedDayKey: string | undefined
  private cachedValue: DeepSeekTodaySpend | undefined
  private cachedAt = 0
  private inFlight: Promise<DeepSeekTodaySpend> | undefined

  /**
   * @param ttlMs - time window in milliseconds (default 60 000).
   * @param now - clock source (injectable for tests).
   * @param scan - the aggregate computation behind a miss.
   */
  constructor(
    private readonly scan: (dayKey: string) => Promise<DeepSeekTodaySpend>,
    private readonly ttlMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Read today's spend, cached per Beijing day within the TTL window.
   * @param force - bypass the time window (manual refresh); the day-key gate
   *   and the in-flight coalescing still apply to non-force callers.
   * @returns today's spend.
   */
  get(force = false): Promise<DeepSeekTodaySpend> {
    const now = this.now()
    const dayKey = beijingDayKey(now)
    if (!force && this.cachedDayKey === dayKey && this.cachedValue !== undefined
      && now.getTime() - this.cachedAt < this.ttlMs) {
      return Promise.resolve(this.cachedValue)
    }
    if (!force && this.inFlight !== undefined) return this.inFlight
    const run = (async (): Promise<DeepSeekTodaySpend> => {
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
    if (!force) this.inFlight = run
    return run
  }
}

/**
 * The aggregate computation behind a cache miss. Chooses the projection path
 * when the projection registry is composed, the events path otherwise; both
 * gate cold reads on persisted revisions so steady-state scans touch only
 * sessions whose logs actually changed.
 */
export class TodaySpendScanner {
  /** Cold sessions resolved on the projection path: id → revision + unit state. */
  private readonly coldResolved = new Map<SessionId, { revision: SessionPersistenceRevision; value: BillingUnitState }>()
  /** Cold sessions resolved on the events path: id → revision (events were collected). */
  private lastEventsScan: Map<SessionId, SessionPersistenceRevision> | undefined

  constructor(private readonly deps: TodaySpendScannerDeps) {}

  /**
   * Compute today's aggregate for one Beijing day.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns today's spend across every session.
   */
  async scan(dayKey: string): Promise<DeepSeekTodaySpend> {
    if (this.deps.projections?.() === undefined) return this.scanEvents(dayKey)
    this.deps.ensureUnit?.()
    return this.scanProjections(dayKey)
  }

  /** Projection path: eager cells for live sessions, revision-gated cold ladder for the rest. */
  private async scanProjections(dayKey: string): Promise<DeepSeekTodaySpend> {
    const { sessions, persistence, projections, projectionCache, unit, logger } = this.deps
    let total = emptyTodaySpend()
    const liveIds = new Set<SessionId>()
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          const state = projections?.()?.stateOf(session, BILLING_UNIT_KEY)
          if (state !== undefined && state.dayKey === dayKey) {
            total = mergeTodaySpend(total, state.spend)
          }
        }
      }
    }
    const persistenceService = persistence?.()
    if (persistenceService === undefined) return total
    const snapshots = await persistenceService.listSnapshots()
    const pending: { id: SessionId; revision: SessionPersistenceRevision }[] = []
    for (const { header, revision } of snapshots) {
      if (liveIds.has(header.id)) continue
      const resolved = this.coldResolved.get(header.id)
      if (resolved !== undefined && resolved.revision === revision) {
        if (resolved.value.dayKey === dayKey) total = mergeTodaySpend(total, resolved.value.spend)
        continue
      }
      pending.push({ id: header.id, revision })
    }
    await withConcurrency(pending, 8, async ({ id, revision }) => {
      let value: BillingUnitState | undefined
      const cache = projectionCache?.()
      if (cache !== undefined) {
        try {
          value = (await cache.coldSnapshot(id)).values[BILLING_UNIT_KEY]
        } catch (error: unknown) {
          logger.warn(`llm-billing: projection cold read for session ${id} failed: ${String(error)}`)
        }
      }
      if (value === undefined) {
        try {
          const inspection = await persistenceService.inspect(id)
          value = foldBillingUnit(unit, inspection.events)
        } catch (error: unknown) {
          // One unreadable session must not blank the whole-day aggregate.
          logger.warn(`llm-billing: skipping unreadable session ${id}: ${String(error)}`)
        }
      }
      if (value !== undefined) this.coldResolved.set(id, { revision, value })
    })
    for (const { id } of pending) {
      const resolved = this.coldResolved.get(id)
      if (resolved !== undefined && resolved.value.dayKey === dayKey) {
        total = mergeTodaySpend(total, resolved.value.spend)
      }
    }
    return total
  }

  /** Events path: collect only today's events (capped), gated by revisions. */
  private async scanEvents(dayKey: string): Promise<DeepSeekTodaySpend> {
    const { sessions, persistence, maxEvents, logger, billing, catalog } = this.deps
    const events: SessionEvent[] = []
    const liveIds = new Set<SessionId>()
    let truncated = false
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          for (const event of session.events) {
            if (beijingDayKey(new Date(event.time)) !== dayKey) continue
            events.push(event)
            if (events.length >= maxEvents) {
              truncated = true
              break
            }
          }
          if (truncated) break
        }
      }
    }
    const persistenceService = persistence?.()
    if (!truncated && persistenceService !== undefined) {
      const snapshots = await persistenceService.listSnapshots()
      for (const { header, revision } of snapshots) {
        if (liveIds.has(header.id)) continue
        if (this.lastEventsScan?.get(header.id) === revision) continue
        try {
          const inspection = await persistenceService.inspect(header.id)
          for (const event of inspection.events) {
            if (beijingDayKey(new Date(event.time)) !== dayKey) continue
            events.push(event)
            if (events.length >= maxEvents) {
              truncated = true
              break
            }
          }
        } catch (error: unknown) {
          // One unreadable session must not blank the whole-day aggregate.
          logger.warn(`llm-billing: skipping unreadable session ${header.id}: ${String(error)}`)
        }
        if (truncated) break
      }
      // Only a complete pass may advance the revision watermark: a truncated
      // pass left sessions unread, and recording them would skip their events
      // on the next scan.
      if (!truncated) {
        this.lastEventsScan = new Map(snapshots.map(snapshot => [snapshot.header.id, snapshot.revision]))
      }
    }
    if (truncated) logger.warn(`llm-billing: today's events exceeded ${maxEvents}; result truncated`)
    // The reference moment is derived from the day key (UTC midnight on that
    // date is 08:00 Beijing the same day), so the pricing re-check cannot
    // drift from the collection filter across a Beijing-day boundary.
    return computeTodaySpend(events, billing, catalog, new Date(`${dayKey}T00:00:00Z`))
  }
}
