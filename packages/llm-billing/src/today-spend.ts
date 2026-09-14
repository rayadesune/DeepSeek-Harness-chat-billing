/**
 * Today-spend read path: the 60-second Beijing-day cache with in-flight
 * coalescing and a force bypass (plan A1), plus the two scan strategies that
 * compute the aggregate behind a cache miss:
 *
 * - projection path (plan C): live sessions read their eagerly folded
 *   `billingTodaySpend` projection cell; cold sessions are answered from the
 *   zero-I/O projection-cache row whenever that row's own day is not the
 *   queried one, and otherwise resolved through one detached local fold over
 *   a full `inspect`. Persisted revisions gate every cold read, so a session
 *   whose log did not change since the last resolution costs nothing — and a
 *   failed resolution is remembered by revision instead of being retried on
 *   every scan.
 * - events path (plans A2/A3): collect and price only today's events in one
 *   pass (per-event Beijing-day filter during collection) with a hard cap,
 *   adopting the fold it already priced for a session whose persisted revision
 *   is unchanged since the last pass.
 *
 * Both strategies run behind the same {@link TodaySpendCache}, so a miss
 * happens at most once per 60 seconds per process, and a manual refresh
 * (`force`) bypasses the time window but keeps the revision caches — an
 * unchanged log provably cannot change the aggregate. That proof is what makes
 * a revision gate a CACHE: both strategies therefore adopt the resolution they
 * remember for an unchanged revision instead of skipping the session, so an
 * unchanged log costs no I/O and still contributes its full spend (and title)
 * to the aggregate and the ranking on every scan.
 *
 * The per-session ranking is a per-CONVERSATION ranking: a subagent child is
 * work the delegating conversation paid for, not a session the user opened, so
 * every subagent row is folded into the row of the top-level session at the
 * root of its `parentSession` chain (see {@link rollUpSubagentSpend}). The
 * aggregate is unaffected — it sums the same sessions either way.
 *
 * Forked sessions never double-count: a fork child's log opens with a
 * verbatim copy of its source session's events (its inherited boundary), so
 * the scanner prices only the child's OWN events on every path. The
 * `billingTodaySpend` unit is boundary-aware (its state carries the inherited
 * cut, and `apply` skips events below it), so the eager cell is correct for a
 * fork child; the cold path skips the projection cache for a seeded session
 * (its cached row may predate the boundary) and folds its own events with the
 * durable cut instead. The boundary is the durable session state, read across
 * both DSH runtime families — a resumed fork child keeps its original
 * boundary and an unseeded session stays at 0.
 *
 * The live `Session` log surface changed in 0.1.2-alpha.4: `Session.events`
 * was removed and replaced by `Session.snapshotEvents()` / `ownEvents()`, and
 * `SessionHeader.seedLength` moved to `Session.inheritedEventCount` (the
 * persistence `inspect` result carries it alongside `meta`). Reads go through
 * {@link liveSessionEvents} / {@link forkBoundaryOf}, which accept both
 * families structurally, so the scanner runs on the ≤ 0.1.1-rc.2 npm baseline
 * and on the newer runtime.
 * @module @rayadesu/dsh-llm-billing/today-spend
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { ResolvedBilling } from './billing.ts'
import { beijingDayKey, beijingPartsOf, BillingFolder, emptyTodaySpend, forkBoundaryOf, isSeededSession, mergeTodaySpend } from './billing.ts'
import type { BillingFoldState } from './billing.ts'
import type { DeepSeekTodaySessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from './types.ts'
import { BILLING_UNIT_KEY, foldOwnBilling, type BillingUnitFold, type BillingUnitState } from './projection.ts'

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

/**
 * Structural slice of a session's durable lineage: the header fields DSH
 * stamps on a delegation child (`origin: 'subagent'`, the delegating session's
 * id, and the depth that survives persistence). All three are read
 * structurally, so the scanner works on every runtime family — a log written
 * before the fields existed simply carries none of them and reads as a
 * top-level session.
 */
export interface SessionLineage {
  /** The session this one was forked from or delegated by; absent for a top-level session. */
  readonly parentSession?: SessionId
  /** DSH's subagent-child classification (`childSessionMeta` stamps it). */
  readonly origin?: 'subagent'
  /** Delegation depth: absent (zero) at the top level, parent depth + 1 for a subagent child. */
  readonly delegationDepth?: number
}

/**
 * Whether one session's durable header marks it as a subagent child. Either
 * marker is enough: `origin` is DSH's navigation classification and
 * `delegationDepth` is its persisted recursion budget, so a header carrying
 * only the depth (or only the origin) is still a delegation child. A session
 * created without either — an ordinary session, a user fork, or a cold resume
 * — is top-level.
 * @param header - the session's lineage slice; `undefined` reads as top-level.
 * @returns true when the session was created as a subagent child.
 */
export function isSubagentSession(header: SessionLineage | undefined): boolean {
  if (header === undefined) return false
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

/**
 * The top-level session one session's ranking row belongs to: the session
 * itself for a top-level session, and for a subagent child the first ancestor
 * up the `parentSession` chain that is not itself a subagent child. A
 * multi-generation delegation (a subagent that spawned subagents) therefore
 * lands on the same root row as its parent, and a child whose parent header is
 * unknown is attributed to the parent id its own header names — the parent is
 * authoritative even when its log is not part of this scan.
 * @param id - the session whose row is being attributed.
 * @param lineage - lineage of every session this scan saw, by id.
 * @returns the session id whose ranking row the input belongs to.
 */
export function topLevelSessionOf(
  id: SessionId,
  lineage: ReadonlyMap<SessionId, SessionLineage>,
): SessionId {
  let current = id
  // A malformed log could claim a delegation cycle; each step visits a
  // distinct ancestor, so a repeat ends the walk instead of spinning.
  const seen = new Set<SessionId>([current])
  for (;;) {
    const header = lineage.get(current)
    if (!isSubagentSession(header)) return current
    const parent = header?.parentSession
    if (parent === undefined || seen.has(parent)) return current
    seen.add(parent)
    current = parent
  }
}

/**
 * Fold every subagent child's row into the top-level row it belongs to
 * ({@link topLevelSessionOf}), so the ranking lists conversations rather than
 * every delegation a conversation started. A child's spend is added to its
 * ancestor's `total`; the ancestor's `ownTotal` keeps its own spend only. A
 * top-level session whose own day was empty but whose subagents priced
 * something still gets a row (with `ownTotal` 0), carrying the title the scan
 * resolved for it in `titles`.
 * @param rows - one row per session that priced something today (own spends).
 * @param lineage - lineage of every session this scan saw, by id.
 * @param titles - resolved display titles by session id; a session absent from
 *   the map has no resolved title and its created row reports `null`.
 * @returns the merged rows, sorted by `total` descending.
 */
export function rollUpSubagentSpend(
  rows: readonly DeepSeekTodaySessionSpend[],
  lineage: ReadonlyMap<SessionId, SessionLineage>,
  titles: ReadonlyMap<SessionId, string | null> = new Map(),
): DeepSeekTodaySessionSpend[] {
  const merged = new Map<SessionId, DeepSeekTodaySessionSpend>()
  for (const row of rows) {
    const target = topLevelSessionOf(row.sessionId, lineage)
    const carried = merged.get(target)
    if (carried === undefined) {
      // A row's own session keeps its own total as `ownTotal`; a row created
      // for an ancestor that priced nothing today carries zero there.
      merged.set(target, target === row.sessionId
        ? row
        : { sessionId: target, title: titles.get(target) ?? null, total: row.total, ownTotal: 0 })
      continue
    }
    merged.set(target, { ...carried, total: carried.total + row.total })
  }
  return [...merged.values()].sort((left, right) => right.total - left.total)
}

/**
 * Structural slice of a live session's header: the fork boundary of both DSH
 * runtime families plus the delegation lineage the ranking roll-up reads.
 */
export interface SessionHeaderSlice extends SessionLineage {
  /** ≤ 0.1.1-rc.2: the durable fork boundary carried by the header; absent for an unseeded session. */
  readonly seedLength?: number
  /** 0.1.2-alpha.4+: whether the session has a fork-inherited prefix. */
  readonly isSeeded?: boolean
}

/**
 * Structural slice of a live session the scanner reads, accepting both DSH
 * runtime families: the ≤ 0.1.1-rc.2 baseline exposes the log as
 * `events` (+ `header.seedLength`), while 0.1.2-alpha.4+ exposes
 * `snapshotEvents()` and `inheritedEventCount` (and dropped the header field).
 */
export interface ScannerSession {
  readonly id: SessionId
  /** ≤ 0.1.1-rc.2: the full event log snapshot. */
  readonly events?: readonly SessionEvent[]
  /** 0.1.2-alpha.4+: materialize an immutable log snapshot; no args = the full current log. */
  snapshotEvents?(fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
  /** 0.1.2-alpha.4+: the durable inherited-prefix length (0 for an unseeded session). */
  readonly inheritedEventCount?: number
  /** Durable header slice: `seedLength` (older runtime) or `isSeeded` (newer runtime), plus lineage. */
  readonly header?: SessionHeaderSlice
}

/**
 * Read one live session's complete event log across both runtime families.
 * @throws when the session exposes neither the legacy `events` snapshot nor
 *   the newer `snapshotEvents()` reader — an unknown runtime surface must
 *   fail loudly rather than silently price an empty log.
 */
export function liveSessionEvents(session: ScannerSession): readonly SessionEvent[] {
  if (session.events !== undefined) return session.events
  // Optional-call form keeps the receiver bound (snapshotEvents uses `this`).
  if (session.snapshotEvents !== undefined) return session.snapshotEvents()
  throw new Error('llm-billing: session log surface is neither Session.events nor Session.snapshotEvents')
}

/** Structural slice of a listed persisted session (the snapshot header is a full SessionHeader). */
export interface ScannerPersistedHeader extends SessionHeaderSlice {
  readonly id: SessionId
  /** Session format generation; part of the projection-cache record identity. */
  readonly version?: number
  /** Session creation time; part of the projection-cache record identity. */
  readonly createdAt?: number
  /** Working directory recorded on the header; part of the projection-cache record identity. */
  readonly cwd?: string
}

/** One stored-session read: the full event log plus the durable inherited boundary. */
export interface ScannerPersistedRead {
  readonly events: readonly SessionEvent[]
  /** Inherited-prefix length (fork seed length); 0 for an unseeded session. */
  readonly seedLength: number
}

/** ≤ 0.1.1-rc.2 persistence slice: service-level `inspect` / `listSnapshots`. */
export interface ScannerPersistenceLegacy {
  listSnapshots(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
  inspect(id: SessionId): Promise<{
    meta?: SessionHeaderSlice
    /** 0.1.2-alpha.4+: the exact inherited cut travels beside, not inside, the header. */
    inheritedEventCount?: number
    events: readonly SessionEvent[]
  }>
}

/**
 * One handle read result across DSH generations. The handle seam first
 * returned the bare event array; since `9b78f99dec` (2026-09-06, in the
 * 0.1.5-alpha.1 checkout) it returns `{ eventState, events }`. Both shapes are
 * accepted so the same build serves the npm alpha line and the checkout.
 */
export type ScannerHandleRead =
  | readonly SessionEvent[]
  | { readonly events: readonly SessionEvent[] }

/**
 * Unwrap a handle read across both return shapes.
 * @param read - the handle's read result.
 * @returns the event array.
 */
export function handleReadEvents(read: ScannerHandleRead): readonly SessionEvent[] {
  // `Array.isArray` does not narrow readonly arrays out of a union, so the
  // branches are asserted explicitly.
  if (Array.isArray(read)) return read as readonly SessionEvent[]
  return (read as { readonly events: readonly SessionEvent[] }).events
}

/** 0.1.2-alpha.5+ handle-based persistence slice: service-level `list` / `open` + `SessionHandle`. */
export interface ScannerPersistenceHandle {
  list(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
  open(id: SessionId, access: 'read'): Promise<{
    readonly header?: SessionHeaderSlice
    /** 0.1.2-alpha.5+: the handle carries the exact inherited cut beside the header. */
    readonly inheritedEventCount?: number
    read(): Promise<ScannerHandleRead>
    close(): Promise<void>
  }>
}

/** Structural union the scanner reads through, accepting both persistence runtime families. */
export type ScannerPersistence = ScannerPersistenceLegacy | ScannerPersistenceHandle

function isHandlePersistence(persistence: ScannerPersistence): persistence is ScannerPersistenceHandle {
  return typeof (persistence as Partial<ScannerPersistenceHandle>).open === 'function'
}

/**
 * List every stored session snapshot across both persistence runtime families:
 * `listSnapshots` (≤ 0.1.1-rc.2) or `list` (0.1.2-alpha.5+).
 * @param persistence - the persistence service slice.
 * @returns one snapshot per stored session.
 */
export function persistenceListSnapshots(
  persistence: ScannerPersistence,
): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]> {
  return isHandlePersistence(persistence)
    ? persistence.list()
    : (persistence as ScannerPersistenceLegacy).listSnapshots()
}

/**
 * Read one stored session's complete event log and durable inherited boundary
 * across both persistence runtime families: legacy `inspect` (≤ 0.1.1-rc.2)
 * or `open` + handle `read` (0.1.2-alpha.5+; the handle is closed after the
 * read). Both throw when the session does not exist.
 * @param persistence - the persistence service slice.
 * @param id - the stored session to read.
 * @returns the session's complete event log plus its inherited-prefix boundary.
 */
export async function persistenceInspect(
  persistence: ScannerPersistence,
  id: SessionId,
): Promise<ScannerPersistedRead> {
  if (isHandlePersistence(persistence)) {
    const handle = await persistence.open(id, 'read')
    try {
      return { events: handleReadEvents(await handle.read()), seedLength: forkBoundaryOf(handle) }
    } finally {
      await handle.close()
    }
  }
  const inspection = await (persistence as ScannerPersistenceLegacy).inspect(id)
  return { events: inspection.events, seedLength: forkBoundaryOf(inspection) }
}

/** Structural slices of the optional services the scanner reads through. */
export interface TodaySpendScannerDeps {
  /** Resolves the live SessionStore at scan time (absent in headless assemblies). */
  sessions?: () => { list(): readonly ScannerSession[] } | undefined
  /** Resolves the persistence backend at scan time (absent without persistence). */
  persistence?: () => ScannerPersistence | undefined
  /** Resolves the session-projection registry at scan time (absent → events path). */
  projections?: () => {
    stateOf(session: ScannerSession, key: typeof BILLING_UNIT_KEY): BillingUnitState | undefined
  } | undefined
  /**
   * Resolves the projection cache at scan time (absent → detached fold for
   * cold sessions). Only the zero-I/O `cachedSnapshot` reader is used: it
   * serves already-checkpointed wire rows without touching a session log.
   */
  projectionCache?: () => {
    cachedSnapshot(
      header: ScannerPersistedHeader,
      inheritedEventCount: number,
      keys?: readonly string[],
    ): { readonly asOfSeq: number; readonly values: Partial<Record<typeof BILLING_UNIT_KEY, BillingUnitState>> } | undefined
  } | undefined
  /**
   * Registers the billing unit on the projection registry, called once before
   * the first projection-path scan. The registry builds cells lazily over the
   * in-memory log, so events committed before registration are folded on
   * first touch — late registration is safe by design.
   */
  ensureUnit?: () => void
  /** The billing unit's fold (the projection path's detached cold recipe). */
  unit: BillingUnitFold
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
/** Bounded parallel fan-out for cold-session resolution. */
export const COLD_RESOLVE_CONCURRENCY = 8

/** The live SessionStore slice a scan reads (resolved once per scan). */
type SessionStore = NonNullable<ReturnType<NonNullable<TodaySpendScannerDeps['sessions']>>>
/** The projection-registry slice a scan reads (absent → events path). */
type ProjectionsService = NonNullable<ReturnType<NonNullable<TodaySpendScannerDeps['projections']>>>
/** One stored snapshot as listed by either persistence runtime family. */
type StoredSnapshot = { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }
/** One cold session pending resolution: its header, durable revision, and fork flag. */
type ColdPending = { header: ScannerPersistedHeader; revision: SessionPersistenceRevision; seeded: boolean }

/**
 * Bounded-map eviction: drop the oldest inserted entry once `size` reached
 * `limit`. Evicting one entry (instead of clearing) keeps the other sessions'
 * resolved state warm across scans.
 */
function evictOldest<K, V>(map: Map<K, V>, limit: number): void {
  if (map.size < limit) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

/**
 * One day's aggregate plus its per-session ranking, computed in a single pass:
 * the aggregate is the sum of the rows, so both reads share every session
 * read, unit fold, and title fold.
 */
export interface TodaySpendDetail {
  /** Today's spend across every session. */
  aggregate: DeepSeekTodaySpend
  /** Today's per-session rows, sorted by cost descending. */
  sessions: DeepSeekTodaySessionSpend[]
}

/**
 * One cold session's resolution, as {@link TodaySpendScanner} remembers it: the
 * persisted revision the resolution read, the session's OWN-events billing fold
 * (its fork boundary already applied), and the display title folded from the
 * same read. The revision is the adoption gate — a later scan adopts the entry
 * only while the session's persisted revision is unchanged, which is exactly
 * the proof that re-reading the log could not change the fold.
 */
export interface ColdResolution {
  /** The persisted revision this resolution read. */
  readonly revision: SessionPersistenceRevision
  /** The session's own-events fold (`BillingUnitState` names the same shape). */
  readonly fold: BillingFoldState
  /** The session's display title from the same read; `null` when untitled or unresolved. */
  readonly title: string | null
}

/**
 * The aggregate computation behind a cache miss. Chooses the projection path
 * when the projection registry is composed, the events path otherwise; both
 * gate cold reads on persisted revisions AND adopt the fold they already hold
 * for an unchanged log, so steady-state scans re-read only sessions whose logs
 * actually changed while every unchanged session keeps contributing.
 */
export class TodaySpendScanner {
  /**
   * Cold sessions resolved by either strategy: id → the persisted revision the
   * resolution saw, the session's OWN-events fold, and its folded title.
   *
   * The two strategies differ in how they PRICE a cold log (an eager projection
   * cell plus the cache ladder, or a local fold over the read log), never in
   * what an unchanged log contributes to the day — so one memory serves both.
   * The projection path reuses the resolved unit; the events path reuses the
   * fold it priced on the previous pass. A strategy that skipped an unchanged
   * log WITHOUT adopting its remembered fold would silently drop that session
   * from the aggregate and the ranking on every scan after the first.
   */
  private readonly coldResolved = new Map<SessionId, ColdResolution>()
  /** Cold sessions whose resolution failed: id → revision (retried only when the log changes). */
  private readonly coldFailed = new Map<SessionId, SessionPersistenceRevision>()

  constructor(private readonly deps: TodaySpendScannerDeps) {}

  /**
   * Remember one cold session's resolution, bounded by
   * {@link COLD_RESOLVE_CACHE_LIMIT}: evicting the oldest entry (instead of
   * clearing) keeps the other sessions' resolved state warm across scans.
   */
  private rememberCold(id: SessionId, resolution: ColdResolution): void {
    evictOldest(this.coldResolved, COLD_RESOLVE_CACHE_LIMIT)
    this.coldResolved.set(id, resolution)
  }

  /**
   * Compute today's aggregate for one Beijing day.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns today's spend across every session.
   */
  async scan(dayKey: string): Promise<DeepSeekTodaySpend> {
    return (await this.scanDetail(dayKey)).aggregate
  }

  /**
   * Compute today's per-session spend for one Beijing day, sorted by cost
   * descending. One row per top-level session: sessions with no priced usage
   * on the day are omitted (unless their subagents priced something, which the
   * roll-up merges into their row), every subagent session is folded into the
   * top-level session that delegated it, and each row carries the session's
   * durable title folded from its log.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns today's per-session rows, highest first.
   */
  async scanSessions(dayKey: string): Promise<DeepSeekTodaySessionsSpend> {
    return { sessions: (await this.scanDetail(dayKey)).sessions }
  }

  /**
   * Compute the day's aggregate AND its per-session ranking in ONE pass: the
   * aggregate is the sum of the rows, so the two reads share every session
   * read, unit fold, and title fold instead of scanning twice. Chooses the
   * projection path when the projection registry is composed, the events path
   * otherwise.
   *
   * The aggregate sums every priced session, subagents included — the ranking's
   * subagent roll-up only regroups rows, so neither total moves.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns the aggregate plus per-session rows sorted by cost descending.
   */
  async scanDetail(dayKey: string): Promise<TodaySpendDetail> {
    if (this.deps.projections?.() === undefined) return this.scanDetailEvents(dayKey)
    this.deps.ensureUnit?.()
    return this.scanDetailProjections(dayKey)
  }

  /**
   * Resolve one cold session's billing fold state and display title.
   *
   * The zero-I/O projection-cache row answers the query directly whenever its
   * own latest priced day is NOT the queried day: the row then proves the
   * session contributed nothing to the queried day, so the log is never read.
   * When the row IS the queried day (or no usable row exists) the session is
   * inspected and folded locally, because the row may trail the log (a crash
   * between the last checkpoint and the session's last event).
   *
   * A cache-served value carries no title (the ladder only stores projection
   * values), so such rows report `title: null`. A SEEDED session (fork child)
   * skips the cache entirely: its cached row was folded over the inherited
   * prefix too, so it always detaches through inspect with the durable
   * boundary (the inspect result's inherited count or `meta.seedLength`,
   * depending on the runtime family) applied to the local fold.
   * @param header - the listed session header (the cache identity witness).
   * @param seeded - whether the session carries a fork-inherited prefix.
   * @param dayKey - the Beijing-time day being aggregated.
   * @returns the resolved fold state and title, or `undefined` when unreadable.
   */
  private async resolveCold(
    header: ScannerPersistedHeader,
    seeded: boolean,
    dayKey: string,
  ): Promise<{ fold: BillingUnitState; title: string | null } | undefined> {
    const { persistence, projectionCache, logger } = this.deps
    if (!seeded) {
      const cache = projectionCache?.()
      if (cache !== undefined) {
        try {
          const value = cache.cachedSnapshot(header, 0, [BILLING_UNIT_KEY])?.values[BILLING_UNIT_KEY]
          if (value !== undefined && value.dayKey !== dayKey) return { fold: value, title: null }
        } catch (error: unknown) {
          logger.warn(`llm-billing: projection cache read for session ${header.id} failed: ${String(error)}`)
        }
      }
    }
    const persistenceService = persistence?.()
    if (persistenceService === undefined) return undefined
    try {
      const read = await persistenceInspect(persistenceService, header.id)
      return {
        fold: foldOwnBilling(this.deps.unit, read.events, read.seedLength),
        title: foldSessionTitle(read.events),
      }
    } catch (error: unknown) {
      // One unreadable session must not blank the whole-day aggregate.
      logger.warn(`llm-billing: skipping unreadable session ${header.id}: ${String(error)}`)
      return undefined
    }
  }

  /**
   * Live-session entries of one projection-path scan: each session with its
   * eager `billingTodaySpend` cell. The cell is boundary-aware (the unit skips
   * a fork child's inherited prefix), so a fork child reads the same own-event
   * spend a non-fork session does.
   */
  private *liveBillingEntries(
    store: SessionStore,
    projections: ProjectionsService | undefined,
  ): Generator<{ session: ScannerSession; state: BillingUnitState | undefined }> {
    for (const session of store.list()) {
      yield { session, state: projections?.stateOf(session, BILLING_UNIT_KEY) }
    }
  }

  /**
   * Cold-ladder adopt: for every stored session not live, either the
   * revision-gated resolution already in {@link coldResolved} is adopted
   * (unchanged log costs nothing and still counts) or the session is queued
   * behind a bounded parallel fan-out, resolved, remembered, and then adopted.
   * A session whose resolution failed is remembered too (by revision), so an
   * unreadable log is not re-read on every scan; a changed revision retries it.
   * One unreadable session never blanks the whole-day aggregate.
   * @param liveIds - ids of sessions already folded from the live store.
   * @param snapshots - stored snapshot list (either runtime family).
   * @param dayKey - the Beijing-time day being aggregated.
   * @param adopt - fold one resolved cold session into the scan's result.
   */
  private async coldAdopt(
    liveIds: ReadonlySet<SessionId>,
    snapshots: readonly StoredSnapshot[],
    dayKey: string,
    adopt: (id: SessionId, resolved: { fold: BillingUnitState; title: string | null }) => void,
  ): Promise<void> {
    const persistenceAvailable = this.deps.persistence?.() !== undefined
    const pending: ColdPending[] = []
    for (const { header, revision } of snapshots) {
      if (liveIds.has(header.id)) continue
      const seeded = isSeededSession(header)
      const resolved = this.coldResolved.get(header.id)
      if (resolved !== undefined && resolved.revision === revision) {
        adopt(header.id, resolved)
        continue
      }
      if (this.coldFailed.get(header.id) === revision) continue
      pending.push({ header, revision, seeded })
    }
    await withConcurrency(pending, COLD_RESOLVE_CONCURRENCY, async ({ header, revision, seeded }) => {
      const resolved = await this.resolveCold(header, seeded, dayKey)
      if (resolved !== undefined) {
        this.coldFailed.delete(header.id)
        this.rememberCold(header.id, { revision, ...resolved })
      } else if (persistenceAvailable) {
        evictOldest(this.coldFailed, COLD_FAILED_CACHE_LIMIT)
        this.coldFailed.set(header.id, revision)
      }
    })
    for (const { header } of pending) {
      const resolved = this.coldResolved.get(header.id)
      if (resolved !== undefined) adopt(header.id, resolved)
    }
  }

  /**
   * Events-path collection shared by both aggregate and per-session scans:
   * fold each session's log with the shared pricing fold (attempt samples with
   * same-step replacement) and announce the session's latest-day spend. A
   * persisted session whose log did not change since it was last resolved is
   * answered from {@link coldResolved} instead of being re-read: it keeps
   * counting toward the aggregate and the ranking at zero cost, which is what
   * makes the revision gate a cache rather than a way to lose sessions. A fork
   * child's inherited prefix (`seq < seedLength`) is skipped, so each model
   * output is priced only in its source session. The hard cap counts the
   * queried day's events; a truncated pass remembers nothing it read, so the
   * next one re-reads whatever this one cut short.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @param onSession - adopt one session's fold, title, and lineage.
   * @returns whether the hard cap truncated the scan.
   */
  private async collectTodayEvents(
    dayKey: string,
    onSession: (id: SessionId, fold: BillingFoldState, title: string | null, lineage: SessionLineage) => void,
  ): Promise<boolean> {
    const { sessions, persistence, maxEvents, logger, billing, catalog } = this.deps
    const liveIds = new Set<SessionId>()
    let collected = 0
    let truncated = false
    /** Price one complete log, announce it, and return what to remember. */
    const collect = (
      id: SessionId,
      events: readonly SessionEvent[],
      seedLength: number,
      lineage: SessionLineage,
    ): { fold: BillingFoldState; title: string | null } => {
      const folder = new BillingFolder(billing, catalog, seedLength)
      for (const event of events) {
        // The cap counts the queried day's events; the fold still sees every
        // event up to the cap (model tracking and attempt replacement need
        // the surrounding events).
        if (beijingPartsOf(event.time).dayKey === dayKey) {
          collected += 1
          if (collected > maxEvents) {
            truncated = true
            break
          }
        }
        folder.add(event)
      }
      const fold = folder.fold
      const title = foldSessionTitle(events)
      onSession(id, fold, title, lineage)
      return { fold, title }
    }
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const session of store.list()) {
          liveIds.add(session.id)
          collect(session.id, liveSessionEvents(session), forkBoundaryOf(session), session.header ?? {})
          if (truncated) break
        }
      }
    }
    const persistenceService = persistence?.()
    if (!truncated && persistenceService !== undefined) {
      const snapshots = await persistenceListSnapshots(persistenceService)
      for (const { header, revision } of snapshots) {
        if (liveIds.has(header.id)) continue
        const resolved = this.coldResolved.get(header.id)
        if (resolved !== undefined && resolved.revision === revision) {
          // Unchanged log: adopt the fold (and title) already priced for this
          // exact revision — the session still counts, at zero I/O.
          onSession(header.id, resolved.fold, resolved.title, header)
          continue
        }
        try {
          const read = await persistenceInspect(persistenceService, header.id)
          const priced = collect(header.id, read.events, read.seedLength, header)
          // A MAXED pass folds one log only partially: remembering it (or its
          // revision) would pin the partial result, so the next pass re-reads.
          if (!truncated) this.rememberCold(header.id, { revision, ...priced })
        } catch (error: unknown) {
          // One unreadable session must not blank the whole-day aggregate.
          logger.warn(`llm-billing: skipping unreadable session ${header.id}: ${String(error)}`)
        }
        if (truncated) break
      }
    }
    if (truncated) logger.warn(`llm-billing: today's events exceeded ${maxEvents}; result truncated`)
    return truncated
  }

  /**
   * Projection path, one pass for both outputs: eager cells for live sessions
   * (title folded from the live log, so a rename is reflected immediately),
   * revision-gated cold ladder for the rest (title resolved on inspect, `null`
   * when answered from the projection cache). A fork child's cell covers its
   * inherited prefix, so its own-events fold supplies both outputs. Lineage
   * (which session delegated which) comes from the same headers the boundary
   * does, so the ranking's subagent roll-up costs no extra read.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns the aggregate plus per-session rows, sorted by cost descending.
   */
  private async scanDetailProjections(dayKey: string): Promise<TodaySpendDetail> {
    const { sessions, persistence, projections } = this.deps
    // Services resolve once per scan, not per session / per cold task.
    const projectionsService = projections?.()
    let aggregate = emptyTodaySpend()
    const rows = new Map<SessionId, DeepSeekTodaySessionSpend>()
    const lineage = new Map<SessionId, SessionLineage>()
    const titles = new Map<SessionId, string | null>()
    const liveIds = new Set<SessionId>()
    if (sessions !== undefined) {
      const store = sessions()
      if (store !== undefined) {
        for (const { session, state } of this.liveBillingEntries(store, projectionsService)) {
          liveIds.add(session.id)
          lineage.set(session.id, session.header ?? {})
          // The eager cell carries no title; fold it from the live log for
          // every live session, not just today's payers, so a parent that
          // delegated but priced nothing itself still titles its merged row.
          const title = foldSessionTitle(liveSessionEvents(session))
          titles.set(session.id, title)
          if (state === undefined || state.dayKey !== dayKey) continue
          aggregate = mergeTodaySpend(aggregate, state.spend)
          rows.set(session.id, {
            sessionId: session.id,
            title,
            total: state.spend.total,
            ownTotal: state.spend.total,
          })
        }
      }
    }
    const persistenceService = persistence?.()
    if (persistenceService !== undefined) {
      const snapshots = await persistenceListSnapshots(persistenceService)
      for (const { header } of snapshots) {
        if (liveIds.has(header.id)) continue
        lineage.set(header.id, header)
      }
      await this.coldAdopt(liveIds, snapshots, dayKey, (id, resolved) => {
        // A resolved title is worth keeping even when the session priced
        // nothing today: its subagents' rows merge into this session's row.
        if (resolved.title !== null && !titles.has(id)) titles.set(id, resolved.title)
        if (resolved.fold.dayKey !== dayKey) return
        aggregate = mergeTodaySpend(aggregate, resolved.fold.spend)
        rows.set(id, { sessionId: id, title: resolved.title, total: resolved.fold.spend.total, ownTotal: resolved.fold.spend.total })
      })
    }
    return { aggregate, sessions: rollUpSubagentSpend([...rows.values()], lineage, titles) }
  }

  /**
   * Events path, one pass for both outputs: price today's events (per-event
   * Beijing-day filter during collection, hard cap), revision-gated so an
   * unchanged log is adopted from {@link coldResolved} instead of re-read. A
   * fork child's inherited prefix (`seq < seedLength`) is skipped, so each
   * model output is priced only in its source session. Titles fold from each
   * session's complete log — a `session/title` event can predate today — so a
   * rename is reflected as soon as the session's log is re-read, and an
   * unchanged session keeps the title its earlier read folded. Lineage comes
   * from the same headers, which the ranking roll-up needs.
   * @param dayKey - the Beijing-time calendar-day key to aggregate.
   * @returns the aggregate plus per-session rows, sorted by cost descending.
   */
  private async scanDetailEvents(dayKey: string): Promise<TodaySpendDetail> {
    let aggregate = emptyTodaySpend()
    const rows: DeepSeekTodaySessionSpend[] = []
    const lineage = new Map<SessionId, SessionLineage>()
    const titles = new Map<SessionId, string | null>()
    await this.collectTodayEvents(dayKey, (id, fold, title, sessionLineage) => {
      lineage.set(id, sessionLineage)
      // Titles cover every session the pass accounted for (not only today's
      // payers), so a parent that delegated without pricing anything itself is
      // titled even when its own row comes from the roll-up.
      titles.set(id, title)
      if (fold.dayKey !== dayKey) return
      aggregate = mergeTodaySpend(aggregate, fold.spend)
      rows.push({ sessionId: id, title, total: fold.spend.total, ownTotal: fold.spend.total })
    })
    return { aggregate, sessions: rollUpSubagentSpend(rows, lineage, titles) }
  }
}
