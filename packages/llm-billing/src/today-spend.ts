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
 * - events path (plans A2/A3): collect and price only today's events in one
 *   pass (per-event Beijing-day filter during collection) with a hard cap,
 *   skipping sessions whose persisted revision is unchanged since the last
 *   scan.
 *
 * Both strategies run behind the same {@link TodaySpendCache}, so a miss
 * happens at most once per 60 seconds per process, and a manual refresh
 * (`force`) bypasses the time window but keeps the revision caches — an
 * unchanged log provably cannot change the aggregate.
 *
 * Forked sessions never double-count: a fork child's log opens with a
 * verbatim copy of its source session's events (`header.seedLength` of them),
 * so the scanner prices only the child's OWN events (`seq >= seedLength`) on
 * every path — the projection path bypasses the eager cell for a seeded
 * session and folds its own events instead (the cell covers the inherited
 * prefix too), and the cold ladder skips the projection cache for a seeded
 * session (its cached row predates the boundary and covers inherited events).
 * The boundary is the durable session header, so a resumed fork child keeps
 * its original boundary and an unseeded session stays at 0.
 * @module @rayadesu/dsh-llm-billing/today-spend
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { ResolvedBilling } from './billing.ts'
import { beijingDayKey, emptyTodaySpend, forkBoundaryOf, mergeTodaySpend, priceEvent, SpendAccumulator } from './billing.ts'
import type { DeepSeekTodaySessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from './types.ts'
import { BILLING_UNIT_KEY, foldOwnBilling, type BillingUnitState } from './projection.ts'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/**
 * Fold one session's durable display title: the latest `session/title`
 * event's text (last-wins, matching the `title` projection), or `null` before
 * the first title lands. The fold runs over the complete log, so an explicit
 * user rename is picked up as soon as its event commits.
 * @param events - one session's complete event log.
 * @returns the session's current title, or `null` when untitled.
 */
export function foldSessionTitle(events: readonly SessionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    // `session/title` joined the SessionEvent union after the npm
    // 0.1.1-rc.2 baseline this package builds against; read its payload
    // through the structural escape hatch (runtime logs carry it).
    if ((event as { type: string }).type !== 'session/title') continue
    const data = (event as { data: { title?: unknown } }).data
    return typeof data.title === 'string' ? data.title : null
  }
  return null
}

/** Structural slice of a live session the scanner reads. */
export interface ScannerSession {
  readonly id: SessionId
  readonly events: readonly SessionEvent[]
  /** Durable header slice; `seedLength` marks a fork child's inherited prefix. */
  readonly header?: { readonly seedLength?: number }
}

/** Structural slice of a listed persisted session (the snapshot header is a full SessionHeader). */
export interface ScannerPersistedHeader {
  readonly id: SessionId
  /** Durable fork boundary carried by the snapshot header; absent for an unseeded session. */
  readonly seedLength?: number
}

/** Structural slices of the optional services the scanner reads through. */
export interface TodaySpendScannerDeps {
  /** Resolves the live SessionStore at scan time (absent in headless assemblies). */
  sessions?: () => { list(): readonly ScannerSession[] } | undefined
  /** Resolves the persistence backend at scan time (absent without persistence). */
  persistence?: () => {
    listSnapshots(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
    inspect(id: SessionId): Promise<{ meta: { seedLength?: number }; events: readonly SessionEvent[] }>
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

/**
 * Bounded parallel fan-out: run `run` over `items` with at most `limit` in
 * flight. A shared index counter hands each worker its next job, so the
 * dispatch is O(n) overall (array `shift()` would be O(n) per pop).
 */
async function withConcurrency<T>(
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
    if (!force && this.inFlight !== undefined) return this.inFlight
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
  /** Cold sessions resolved on the projection path: id → revision + unit state + title. */
  private readonly coldResolved = new Map<SessionId, { revision: SessionPersistenceRevision; value: BillingUnitState; title: string | null }>()
  /** Cold sessions resolved on the events path: id → revision (events were collected). */
  private lastEventsScan: Map<SessionId, SessionPersistenceRevision> | undefined
  /** Live fork children priced on the projection path: id → own-events count + folded state. */
  private readonly ownStates = new Map<SessionId, { count: number; state: BillingUnitState }>()

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

  /**
   * Compute today's per-session spend for one Beijing day, sorted by cost
   * descending. Sessions with no priced usage on the day are omitted; each
   * row carries the session's durable title folded from its log.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns today's per-session rows, highest first.
   */
  async scanSessions(dayKey: string): Promise<DeepSeekTodaySessionsSpend> {
    const rows = this.deps.projections?.() === undefined
      ? await this.scanSessionsEvents(dayKey)
      : await this.scanSessionsProjections(dayKey)
    rows.sort((left, right) => right.total - left.total)
    return { sessions: rows }
  }

  /**
   * Resolve one cold session's billing unit state and display title through
   * the projection-cache ladder (cached row first, then a detached local
   * fold over a full inspect). A cache-served value carries no title (the
   * ladder only stores projection values), so such rows report `title: null`
   * until the session is inspected again. A SEEDED session (fork child)
   * skips the ladder entirely: its cached row was folded over the inherited
   * prefix too, so it always detaches through inspect with the durable
   * boundary applied to the local fold.
   * @param id - the cold session's id.
   * @param seedLength - the durable inherited-prefix boundary (0 for unseeded).
   * @returns the resolved state and title, or `undefined` when unreadable.
   */
  private async resolveCold(id: SessionId, seedLength: number): Promise<{ value: BillingUnitState; title: string | null } | undefined> {
    const { persistence, projectionCache, unit, logger } = this.deps
    const persistenceService = persistence?.()
    if (persistenceService === undefined) return undefined
    if (seedLength <= 0) {
      const cache = projectionCache?.()
      if (cache !== undefined) {
        try {
          const value = (await cache.coldSnapshot(id)).values[BILLING_UNIT_KEY]
          if (value !== undefined) return { value, title: null }
        } catch (error: unknown) {
          logger.warn(`llm-billing: projection cold read for session ${id} failed: ${String(error)}`)
        }
      }
    }
    try {
      const inspection = await persistenceService.inspect(id)
      return { value: foldOwnBilling(unit, inspection.events, seedLength), title: foldSessionTitle(inspection.events) }
    } catch (error: unknown) {
      // One unreadable session must not blank the whole-day aggregate.
      logger.warn(`llm-billing: skipping unreadable session ${id}: ${String(error)}`)
      return undefined
    }
  }

  /**
   * Fold one fork child's OWN events (its log minus the inherited prefix)
   * with the billing unit, incrementally: the fold is reused while the log
   * length is unchanged and only the new tail is applied when it grows.
   * @param id - the session id (the own-state cache key).
   * @param events - the session's complete log.
   * @param seedLength - the inherited-prefix boundary.
   * @returns the unit state over the session's own events.
   */
  private ownBillingState(id: SessionId, events: readonly SessionEvent[], seedLength: number): BillingUnitState {
    const cached = this.ownStates.get(id)
    const ownCount = events.length - seedLength
    if (cached !== undefined && cached.count === ownCount) return cached.state
    let state: BillingUnitState
    if (cached !== undefined && cached.count < ownCount) {
      state = cached.state
      for (const event of events) {
        if (event.seq < seedLength + cached.count) continue
        state = this.deps.unit.apply(state, event)
      }
    } else {
      state = foldOwnBilling(this.deps.unit, events, seedLength)
    }
    this.ownStates.set(id, { count: ownCount, state })
    return state
  }

  /** Projection path: eager cells for live sessions, revision-gated cold ladder for the rest. */
  private async scanProjections(dayKey: string): Promise<DeepSeekTodaySpend> {
    const { sessions, persistence, projections } = this.deps
    // Services resolve once per scan, not per session / per cold task.
    const projectionsService = projections?.()
    let total = emptyTodaySpend()
    const liveIds = new Set<SessionId>()
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          const seedLength = forkBoundaryOf(session.header)
          // A fork child's eager cell covers its inherited prefix too; price
          // its own events directly instead.
          const state = seedLength > 0
            ? this.ownBillingState(session.id, session.events, seedLength)
            : projectionsService?.stateOf(session, BILLING_UNIT_KEY)
          if (state !== undefined && state.dayKey === dayKey) {
            total = mergeTodaySpend(total, state.spend)
          }
        }
      }
    }
    const persistenceService = persistence?.()
    if (persistenceService === undefined) return total
    const snapshots = await persistenceService.listSnapshots()
    const pending: { id: SessionId; revision: SessionPersistenceRevision; seedLength: number }[] = []
    for (const { header, revision } of snapshots) {
      if (liveIds.has(header.id)) continue
      const seedLength = forkBoundaryOf(header)
      const resolved = this.coldResolved.get(header.id)
      if (resolved !== undefined && resolved.revision === revision) {
        if (resolved.value.dayKey === dayKey) total = mergeTodaySpend(total, resolved.value.spend)
        continue
      }
      pending.push({ id: header.id, revision, seedLength })
    }
    await withConcurrency(pending, 8, async ({ id, revision, seedLength }) => {
      const resolved = await this.resolveCold(id, seedLength)
      if (resolved !== undefined) this.coldResolved.set(id, { revision, ...resolved })
    })
    for (const { id } of pending) {
      const resolved = this.coldResolved.get(id)
      if (resolved !== undefined && resolved.value.dayKey === dayKey) {
        total = mergeTodaySpend(total, resolved.value.spend)
      }
    }
    return total
  }

  /**
   * Events path: price today's events in a single pass (per-event Beijing-day
   * filter during collection, hard cap), gated by revisions. A fork child's
   * inherited prefix (`seq < seedLength`) is skipped, so each model output is
   * priced only in its source session.
   */
  private async scanEvents(dayKey: string): Promise<DeepSeekTodaySpend> {
    const { sessions, persistence, maxEvents, logger, billing, catalog } = this.deps
    const names = new Map(catalog.map(model => [model.id, model.name]))
    const accumulator = new SpendAccumulator()
    const liveIds = new Set<SessionId>()
    let collected = 0
    let truncated = false
    const collect = (events: readonly SessionEvent[], seedLength: number): void => {
      for (const event of events) {
        if (event.seq < seedLength) continue
        if (beijingDayKey(new Date(event.time)) !== dayKey) continue
        collected += 1
        if (collected > maxEvents) {
          truncated = true
          return
        }
        const priced = priceEvent(event, billing, names)
        if (priced !== undefined) accumulator.add(priced)
      }
    }
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          collect(session.events, forkBoundaryOf(session.header))
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
          collect(inspection.events, forkBoundaryOf(inspection.meta))
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
    return accumulator.finish()
  }

  /**
   * Projection-path per-session scan: eager cells for live sessions (title
   * folded from the live log, so a rename is reflected immediately),
   * revision-gated cold ladder for the rest (title resolved on inspect,
   * `null` when served from the projection cache). A fork child's row prices
   * its OWN events only (the cell covers the inherited prefix too).
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns unsorted per-session rows for the day.
   */
  private async scanSessionsProjections(dayKey: string): Promise<DeepSeekTodaySessionSpend[]> {
    const { sessions, persistence, projections } = this.deps
    const projectionsService = projections?.()
    const rows = new Map<SessionId, DeepSeekTodaySessionSpend>()
    const liveIds = new Set<SessionId>()
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          const seedLength = forkBoundaryOf(session.header)
          const state = seedLength > 0
            ? this.ownBillingState(session.id, session.events, seedLength)
            : projectionsService?.stateOf(session, BILLING_UNIT_KEY)
          if (state !== undefined && state.dayKey === dayKey) {
            rows.set(session.id, {
              sessionId: session.id,
              title: foldSessionTitle(session.events),
              total: state.spend.total,
            })
          }
        }
      }
    }
    const persistenceService = persistence?.()
    if (persistenceService === undefined) return [...rows.values()]
    const snapshots = await persistenceService.listSnapshots()
    const pending: { id: SessionId; revision: SessionPersistenceRevision; seedLength: number }[] = []
    for (const { header, revision } of snapshots) {
      if (liveIds.has(header.id)) continue
      const seedLength = forkBoundaryOf(header)
      const resolved = this.coldResolved.get(header.id)
      if (resolved !== undefined && resolved.revision === revision) {
        if (resolved.value.dayKey === dayKey) {
          rows.set(header.id, { sessionId: header.id, title: resolved.title, total: resolved.value.spend.total })
        }
        continue
      }
      pending.push({ id: header.id, revision, seedLength })
    }
    await withConcurrency(pending, 8, async ({ id, revision, seedLength }) => {
      const resolved = await this.resolveCold(id, seedLength)
      if (resolved !== undefined) this.coldResolved.set(id, { revision, ...resolved })
    })
    for (const { id } of pending) {
      const resolved = this.coldResolved.get(id)
      if (resolved !== undefined && resolved.value.dayKey === dayKey) {
        rows.set(id, { sessionId: id, title: resolved.title, total: resolved.value.spend.total })
      }
    }
    return [...rows.values()]
  }

  /**
   * Events-path per-session scan: price today's events in a single pass,
   * accumulating per session (per-event Beijing-day filter during collection,
   * hard cap), gated by revisions. A fork child's inherited prefix
   * (`seq < seedLength`) is skipped, so each row is the session's OWN spend.
   * Titles fold from each session's complete log — a `session/title` event
   * can predate today — so a rename is reflected as soon as the session's log
   * is re-read.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns unsorted per-session rows for the day.
   */
  private async scanSessionsEvents(dayKey: string): Promise<DeepSeekTodaySessionSpend[]> {
    const { sessions, persistence, maxEvents, logger, billing, catalog } = this.deps
    const names = new Map(catalog.map(model => [model.id, model.name]))
    const rows = new Map<SessionId, { title: string | null; total: number }>()
    const liveIds = new Set<SessionId>()
    let collected = 0
    let truncated = false
    const collect = (id: SessionId, events: readonly SessionEvent[], seedLength: number): void => {
      let row = rows.get(id)
      if (row === undefined) {
        row = { title: foldSessionTitle(events), total: 0 }
        rows.set(id, row)
      }
      for (const event of events) {
        if (event.seq < seedLength) continue
        if (beijingDayKey(new Date(event.time)) !== dayKey) continue
        collected += 1
        if (collected > maxEvents) {
          truncated = true
          return
        }
        const priced = priceEvent(event, billing, names)
        if (priced !== undefined) row.total += priced.cost
      }
    }
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          collect(session.id, session.events, forkBoundaryOf(session.header))
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
          collect(header.id, inspection.events, forkBoundaryOf(inspection.meta))
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
    return [...rows.entries()]
      .filter(([, row]) => row.total > 0)
      .map(([sessionId, row]) => ({ sessionId, title: row.title, total: row.total }))
  }
}
