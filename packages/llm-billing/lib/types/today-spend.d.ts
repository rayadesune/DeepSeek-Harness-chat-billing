/**
 * Today-spend read path: the 60-second Beijing-day cache with in-flight
 * coalescing and a force bypass (plan A1), plus the two scan strategies that
 * compute the aggregate behind a cache miss:
 *
 * - projection path (plan C): live sessions read their eagerly folded
 *   `billingTodaySpend` projection cell; cold sessions are answered from the
 *   zero-I/O projection-cache row whenever that row's own day is not the
 *   queried one, and otherwise resolved through one detached local fold over
 *   a full `open` + handle read. Persisted revisions gate every cold read, so a session
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
 * durable cut instead. The boundary is the durable session state, read from the
 * live-session and handle surfaces — a resumed fork child keeps its original
 * boundary and an unseeded session stays at 0.
 *
 * The live `Session` log surface changed in 0.1.2-alpha.4: `Session.events`
 * was removed and replaced by `Session.snapshotEvents()` / `ownEvents()`, and
 * `SessionHeader.seedLength` moved to `Session.inheritedEventCount` (the
 * opened `SessionHandle` carries it alongside `header`). Reads go through
 * {@link liveSessionEvents} / {@link forkBoundaryOf}, which accept the
 * live-session and handle shapes structurally, so the scanner runs on the
 * older `events` runtime and on the newer `snapshotEvents` runtime.
 * @module @rayadesu/dsh-llm-billing/today-spend
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence';
import type { ResolvedBilling } from './billing.ts';
import type { BillingFoldState } from './billing.ts';
import type { DeepSeekTodaySessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from './types.ts';
import { BILLING_UNIT_KEY, type BillingUnitFold, type BillingUnitState } from './projection.ts';
import { type SessionLineage } from './session-lineage.ts';
import type { ScannerPersistedHeader, ScannerPersistence, ScannerSession } from './persistence.ts';
export * from './session-lineage.ts';
export * from './persistence.ts';
export * from './cache.ts';
export interface TodaySpendScannerDeps {
    /** Resolves the live SessionStore at scan time (absent in headless assemblies). */
    sessions?: () => {
        list(): readonly ScannerSession[];
    } | undefined;
    /** Resolves the persistence backend at scan time (absent without persistence). */
    persistence?: () => ScannerPersistence | undefined;
    /** Resolves the session-projection registry at scan time (absent → events path). */
    projections?: () => {
        stateOf(session: ScannerSession, key: typeof BILLING_UNIT_KEY): BillingUnitState | undefined;
    } | undefined;
    /**
     * Resolves the projection cache at scan time (absent → detached fold for
     * cold sessions). Only the zero-I/O `cachedSnapshot` reader is used: it
     * serves already-checkpointed wire rows without touching a session log.
     */
    projectionCache?: () => {
        cachedSnapshot(header: ScannerPersistedHeader, inheritedEventCount: number, keys?: readonly string[]): {
            readonly asOfSeq: number;
            readonly values: Partial<Record<typeof BILLING_UNIT_KEY, BillingUnitState>>;
        } | undefined;
    } | undefined;
    /**
     * Registers the billing unit on the projection registry, called once before
     * the first projection-path scan. The registry builds cells lazily over the
     * in-memory log, so events committed before registration are folded on
     * first touch — late registration is safe by design.
     */
    ensureUnit?: () => void;
    /** The billing unit's fold (the projection path's detached cold recipe). */
    unit: BillingUnitFold;
    /** Hard cap on today's events collected by the events path. */
    maxEvents: number;
    /** Warn sink for truncation and unreadable sessions. */
    logger: {
        warn(message: string): void;
    };
    /** Pricing table resolved from the plugin config. */
    billing: ResolvedBilling;
    /** Model display rows, in presentation order. */
    catalog: readonly {
        id: string;
        name: string;
    }[];
}
/**
 * One day's aggregate plus its per-session ranking, computed in a single pass:
 * the aggregate is the sum of the rows, so both reads share every session
 * read, unit fold, and title fold.
 */
export interface TodaySpendDetail {
    /** Today's spend across every session. */
    aggregate: DeepSeekTodaySpend;
    /** Today's per-session rows, sorted by cost descending. */
    sessions: DeepSeekTodaySessionSpend[];
    /** The Beijing day this pass was computed for (the key its day filters used). */
    dayKey: string;
    /**
     * WHOLE-session own spend of every session this pass priced, by id: all days
     * the log covers, the fork prefix already excluded, subagents not yet merged.
     * The ranking only reports the queried day, but the same fold carries the
     * whole-session total, so a conversation read ({@link delegatedSpendOf}) costs
     * no second scan.
     */
    ownSpend: ReadonlyMap<SessionId, DeepSeekTodaySpend>;
    /** Lineage of every session this pass saw, by id: the delegation tree's shape. */
    lineage: ReadonlyMap<SessionId, SessionLineage>;
    /**
     * Durable creation instant of every session this pass saw, by id (absent when
     * the header carried none). The panel's today share is gated on the session
     * having been created BEFORE the queried day, which this answers without
     * another read.
     */
    createdAt: ReadonlyMap<SessionId, number>;
}
/**
 * The merged whole-session spend of every subagent session delegated FROM one
 * session, transitively: the subagent subtotal a conversation's own log cannot
 * price. Only sessions DSH marked as delegation children count, so a user fork
 * (which names a `parentSession` too) is never billed into its source. A
 * malformed lineage that points back at the queried session is ignored rather
 * than counted twice.
 * @param id - the session whose delegated subtree to sum.
 * @param ownSpend - whole-session own spend per session, from one scan pass.
 * @param lineage - lineage per session, from the same pass.
 * @returns the merged subtree spend; empty when the session delegated nothing priced.
 */
export declare function delegatedSpendOf(id: SessionId, ownSpend: ReadonlyMap<SessionId, DeepSeekTodaySpend>, lineage: ReadonlyMap<SessionId, SessionLineage>): DeepSeekTodaySpend;
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
    readonly revision: SessionPersistenceRevision;
    /** The session's own-events fold (`BillingUnitState` names the same shape). */
    readonly fold: BillingFoldState;
    /** The session's display title from the same read; `null` when untitled or unresolved. */
    readonly title: string | null;
}
/**
 * The aggregate computation behind a cache miss. Chooses the projection path
 * when the projection registry is composed, the events path otherwise; both
 * gate cold reads on persisted revisions AND adopt the fold they already hold
 * for an unchanged log, so steady-state scans re-read only sessions whose logs
 * actually changed while every unchanged session keeps contributing.
 */
export declare class TodaySpendScanner {
    private readonly deps;
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
    private readonly coldResolved;
    /**
     * Cold sessions whose resolution failed, id → the revision it failed at plus
     * when. Keyed by revision too, so an unchanged log is not re-read every scan,
     * but the retry is TIME-boxed: a purely revision-keyed failure would hide a
     * session permanently when its log never changes again.
     */
    private readonly coldFailed;
    constructor(deps: TodaySpendScannerDeps);
    /**
     * Remember one cold session's resolution, bounded by
     * {@link COLD_RESOLVE_CACHE_LIMIT}: evicting the oldest entry (instead of
     * clearing) keeps the other sessions' resolved state warm across scans.
     */
    private rememberCold;
    /**
     * Compute today's aggregate for one Beijing day.
     * @param dayKey - the Beijing-time calendar-day key to aggregate.
     * @returns today's spend across every session.
     */
    scan(dayKey: string): Promise<DeepSeekTodaySpend>;
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
    scanSessions(dayKey: string): Promise<DeepSeekTodaySessionsSpend>;
    /**
     * Compute the day's aggregate AND its per-session ranking in ONE pass: the
     * aggregate is the sum of the rows, so the two reads share every session
     * read, unit fold, and title fold instead of scanning twice. Chooses the
     * projection path when the projection registry is composed, the events path
     * otherwise.
     *
     * The aggregate sums every priced session, subagents included — the ranking's
     * subagent roll-up only regroups rows, so neither total moves. Both paths
     * fold in slices and hand the host's event loop back every
     * {@link SCAN_YIELD_SESSIONS} sessions, so a long scan never starves the
     * GUI's own round trips.
     * @param dayKey - the Beijing-time calendar-day key to aggregate.
     * @returns the aggregate plus per-session rows sorted by cost descending.
     */
    scanDetail(dayKey: string): Promise<TodaySpendDetail>;
    /**
     * Resolve one cold session's billing fold state and display title.
     *
     * The zero-I/O projection-cache row answers the query directly whenever its
     * own latest priced day is NOT the queried day: the row then proves the
     * session contributed nothing to the queried day, so the log is never read.
     * When the row IS the queried day (or no usable row exists) the session is
     * opened and folded locally, because the row may trail the log (a crash
     * between the last checkpoint and the session's last event).
     *
     * A cache-served value carries no title (the ladder only stores projection
     * values), so such rows report `title: null`. A SEEDED session (fork child)
     * skips the cache entirely: its cached row was folded over the inherited
     * prefix too, so it always detaches through a handle read with the durable
     * boundary (the handle's `inheritedEventCount` or `header.seedLength`,
     * depending on the runtime family) applied to the local fold.
     * @param header - the listed session header (the cache identity witness).
     * @param seeded - whether the session carries a fork-inherited prefix.
     * @param dayKey - the Beijing-time day being aggregated.
     * @returns the resolved fold state and title, or `undefined` when unreadable.
     */
    private resolveCold;
    /**
     * Live-session entries of one projection-path scan: each session with its
     * eager `billingTodaySpend` cell. The cell is boundary-aware (the unit skips
     * a fork child's inherited prefix), so a fork child reads the same own-event
     * spend a non-fork session does.
     */
    private liveBillingEntries;
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
    private coldAdopt;
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
    private collectTodayEvents;
    /**
     * Projection path, one pass for both outputs: eager cells for live sessions
     * (title folded from the live log, so a rename is reflected immediately),
     * revision-gated cold ladder for the rest (title resolved on the handle read, `null`
     * when answered from the projection cache). A fork child's cell covers its
     * inherited prefix, so its own-events fold supplies both outputs. Lineage
     * (which session delegated which) comes from the same headers the boundary
     * does, so the ranking's subagent roll-up costs no extra read.
     * @param dayKey - the Beijing-time calendar-day key to aggregate.
     * @returns the aggregate plus per-session rows, sorted by cost descending.
     */
    private scanDetailProjections;
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
    private scanDetailEvents;
}
//# sourceMappingURL=today-spend.d.ts.map