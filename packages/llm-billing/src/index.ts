/**
 * DeepSeek account balance and session-spend provider, as a standalone host
 * plugin. It resolves the DeepSeek endpoint and API key from its own config and
 * the credential/environment seams, prices each session's billed usage with the
 * peak/off-peak table, and exposes the `billing` Remote (`getBalance`, the
 * per-session `getSessionSpend`, and the all-sessions `getTodaySpend`).
 *
 * Today's spend never scans every session log per request: a 60-second
 * Beijing-day cache with in-flight coalescing serves the message-triggered
 * reads, the manual refresh may bypass the time window (`force`), and the
 * computation behind a miss reads only sessions whose persisted revision
 * changed since the last resolution (see today-spend.ts). When the
 * session-projection registry is composed, the plugin additionally registers
 * the `billingTodaySpend` projection unit, which folds each session's spend
 * eagerly and lets cold reads ride the projection-cache ladder.
 *
 * A per-session spend cache makes the badge's turn-settled recompute
 * incremental: session logs are append-only and chronological (the same
 * assumption the projection unit makes), so the spend is reused while the log
 * length is unchanged, and only the appended tail is priced when it grows.
 * @module @rayadesu/dsh-llm-billing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { DeepSeekBalanceGateway, fetchDeepSeekBalance } from './balance.ts'
import {
  computeSessionSpend,
  computeTurnSpend,
  DEFAULT_MODEL_PRICING,
  DEFAULT_PEAK_HOURS,
  forkBoundaryOf,
  mergeTodaySpend,
  resolveBilling,
  SessionTurnSpendFolder,
} from './billing.ts'
import type { BillingConfig, BillingConfigModel, ResolvedBilling } from './billing.ts'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekSessionTurnSpends, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from './types.ts'
import { billingTodaySpendDefinition } from './projection.ts'
import type { BillingUnitDefinition } from './projection.ts'
import { liveSessionEvents, persistenceInspect, TodaySpendCache, TodaySpendScanner } from './today-spend.ts'
import type { ScannerPersistence } from './today-spend.ts'

export { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from './balance.ts'
export {
  addEventContribution,
  beijingDayKey,
  computeSessionSpend,
  computeSessionTurnSpends,
  computeTodaySpend,
  computeTurnSpend,
  DEFAULT_MODEL_PRICING,
  DEFAULT_PEAK_HOURS,
  emptyTodaySpend,
  forkBoundaryOf,
  isPeak,
  isSeededSession,
  mergeTodaySpend,
  priceEvent,
  resolveBilling,
  SessionTurnSpendFolder,
  SpendAccumulator,
} from './billing.ts'
export type {
  BillingConfig,
  BillingConfigModel,
  BillingEventContribution,
  DeepSeekModelPricing,
  DeepSeekTokenPrice,
  PeakHourWindow,
  ResolvedBilling,
} from './billing.ts'
export type * from './types.ts'
export { BILLING_UNIT_KEY, billingTodaySpendDefinition, foldBillingUnit, foldOwnBilling } from './projection.ts'
export type { BillingUnitFold, BillingUnitState } from './projection.ts'
export { foldSessionTitle, liveSessionEvents, persistenceInspect, persistenceListSnapshots, TodaySpendCache, TodaySpendScanner } from './today-spend.ts'
export type { ScannerPersistedHeader, ScannerPersistence, ScannerPersistenceHandle, ScannerPersistenceLegacy, ScannerPersistedRead, ScannerSession, TodaySpendScannerDeps } from './today-spend.ts'

export const name = 'llm-billing'

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
/** Public API default; deployments may point elsewhere via $DEEPSEEK_BASE_URL. */
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** One advisory display row; requests are never restricted to this list. */
export interface BillingModel {
  /** Wire model id, e.g. `deepseek-v4-flash`. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
}

const DEFAULT_MODELS: BillingModel[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
  { id: 'deepseek-v4.1-flash-expires-on-0910', name: 'DeepSeek-V4.1-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp' },
  { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5-Pro' },
  { id: 'mimo-v2.5', name: 'MiMo-V2.5' },
]

/**
 * Plugin config. Every field is optional: the API key resolves per call from
 * {@link Config.apiKeyEnv} (credentials seam, then environment), the endpoint
 * falls back to `$DEEPSEEK_BASE_URL` then the public API, and the pricing
 * table and peak-hour windows fall back to the published DeepSeek rates.
 */
export interface Config {
  /** Credential reference (environment-variable name); defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; defaults to `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com`. */
  baseURL?: string
  /** Advisory display rows, in presentation order; defaults to V4 Flash, V4.1 Flash, V4 Pro, and V4 Flash Vision Exp. */
  models?: BillingModel[]
  /** Pricing table and peak-hour windows; omission uses the published defaults. Peak windows apply weekdays (Monday–Friday) only; weekends are always off-peak. */
  billing?: BillingConfig
}

const billingModel: z<BillingModel> = z.object({
  id: z.string().required(),
  name: z.string(),
})

const tokenPrice: z<BillingConfigModel['peak']> = z.object({
  cacheHitInput: z.number().min(0),
  cacheMissInput: z.number().min(0),
  output: z.number().min(0),
})

const billingConfig: z<BillingConfig> = z.object({
  // Copies of the readonly published tables, taken once at module load.
  peakHours: z.array(z.object({
    start: z.number().step(1).min(0).max(23),
    end: z.number().step(1).min(0).max(24),
  })).default([...DEFAULT_PEAK_HOURS]),
  models: z.array(z.object({
    model: z.string().required(),
    peak: tokenPrice,
    offPeak: tokenPrice,
  })).default([...DEFAULT_MODEL_PRICING]),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  models: z.array(billingModel).default(DEFAULT_MODELS),
  billing: billingConfig,
})

/** How often a Beijing-day "today spend" value may be recomputed (60s). */
export const TODAY_SPEND_CACHE_MS = 60_000
/** Hard cap on today's events collected by the events scan path. */
export const TODAY_SPEND_MAX_EVENTS = 200_000
/** Max session-spend rows kept for incremental recompute before eviction. */
export const SESSION_SPEND_CACHE_LIMIT = 1024
/** Max session-id entries kept in the per-turn-cost fold cache before eviction. */
export const SESSION_TURN_SPEND_CACHE_LIMIT = 64
/** How long one balance snapshot is reused before the host refetches it (15s). */
export const BALANCE_CACHE_MS = 15_000
/** Hard cap on one `/user/balance` request (5s); a hung endpoint never blocks the badge. */
export const BALANCE_TIMEOUT_MS = 5_000

/**
 * Bounded-map eviction: drop the oldest inserted entry once `size` reached
 * `limit`, so an unbounded session-id space grows the map no further. Evicting
 * one entry (instead of clearing) keeps the other sessions' incremental
 * spend warm.
 */
function evictOldest<K, V>(map: Map<K, V>, limit: number): void {
  if (map.size < limit) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

/** One session read: the event log plus the durable inherited-prefix boundary. */
interface SessionEventsRead {
  readonly events: readonly SessionEvent[]
  /** Inherited-prefix length (fork seed length); 0 for an unseeded session. */
  readonly seedLength: number
}

/**
 * Read one session's event log and durable seed boundary: the live
 * SessionStore first, then the persistence backend for a flushed session
 * (inspected directly by id — no header listing). The live-session surface
 * is read structurally across both DSH runtime families — `Session.events`
 * (≤ 0.1.1-rc.2) or `Session.snapshotEvents()` + `Session.inheritedEventCount`
 * (0.1.2-alpha.4+) — via {@link liveSessionEvents} / {@link forkBoundaryOf}.
 * @param ctx - plugin context carrying the SessionStore and optional persistence.
 * @param sessionId - the session to read.
 * @returns the session's complete event log plus its inherited-prefix boundary.
 * @throws {@link LlmError} with code `NOT_FOUND` when the session is unknown.
 */
async function sessionEvents(ctx: Context, sessionId: SessionId): Promise<SessionEventsRead> {
  const sessions = ctx.get('sessions')
  const live = sessions?.get(sessionId)
  if (live !== undefined) {
    return { events: liveSessionEvents(live), seedLength: forkBoundaryOf(live) }
  }
  const persistence = ctx.get('sessionPersistence') as ScannerPersistence | undefined
  if (persistence !== undefined) {
    try {
      return await persistenceInspect(persistence, sessionId)
    } catch (error: unknown) {
      throw new LlmError(`llm-billing: session ${sessionId} not found`, 'NOT_FOUND', { cause: error })
    }
  }
  throw new LlmError(`llm-billing: session ${sessionId} not found`, 'NOT_FOUND')
}

/** Facts resolved once at apply time: endpoint resolver, credential ref, and pricing. */
interface ResolvedFacts {
  /**
   * Resolve the endpoint base per call from config → `$DEEPSEEK_BASE_URL` →
   * the public API (the launch environment stays dynamic on purpose).
   */
  baseURL: () => string
  /** Credential reference for the API key. */
  apiKeyRef: ReturnType<typeof credentialRef>
  /** Pricing table and peak-hour windows resolved from config. */
  billing: ResolvedBilling
  /** Model display rows, in presentation order. */
  catalog: readonly { id: string; name: string }[]
}

/** Resolve the plugin's static facts once: endpoint, credential ref, pricing table. */
function resolveFacts(ctx: Context, config: Config): ResolvedFacts {
  return {
    baseURL: () => config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? PUBLIC_BASE_URL,
    apiKeyRef: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    billing: resolveBilling(config.billing),
    catalog: (config.models ?? DEFAULT_MODELS).map(model => ({ id: model.id, name: model.name ?? model.id })),
  }
}

/**
 * Resolve the API key per call: the credentials service first, then the
 * launch environment fallback.
 * @throws {@link LlmError} with code `MISSING_CREDENTIAL` when neither yields a usable key.
 */
async function resolveApiKey(ctx: Context, apiKeyRef: ReturnType<typeof credentialRef>): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(apiKeyRef)
    if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-billing', apiKeyRef)
  } else {
    const ambient = launchEnvironmentOf(ctx).get(apiKeyRef)
    if (ambient !== undefined && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, 'llm-billing', apiKeyRef)
    }
  }
  throw new LlmError(
    `llm-billing: no API key; store ${apiKeyRef} through the credentials service or export it`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * Per-session incremental spend loader: a session log is append-only and
 * chronological (the same assumption the projection unit makes), so a spend
 * computed for `count` EVENTS OF THE SESSION'S OWN WORK (the log minus its
 * inherited fork prefix) stays valid while the log length is unchanged, and
 * only the appended tail needs pricing when it grows. A forked child's
 * inherited prefix (`seq < seedLength`) is priced only in its source
 * session; the cache is bounded (see {@link evictOldest}), so an unbounded
 * session-id space cannot grow it without bound.
 */
function createSessionSpendFetcher(
  ctx: Context,
  facts: ResolvedFacts,
): (sessionId: SessionId) => Promise<DeepSeekSessionSpend> {
  const sessionSpendCache = new Map<SessionId, { count: number; spend: DeepSeekSessionSpend }>()
  return async (sessionId: SessionId): Promise<DeepSeekSessionSpend> => {
    const { events, seedLength } = await sessionEvents(ctx, sessionId)
    const ownCount = events.length - seedLength
    const cached = sessionSpendCache.get(sessionId)
    if (cached !== undefined && cached.count === ownCount) {
      // LRU touch: re-insert so the entry is evicted only after fresher ones.
      sessionSpendCache.delete(sessionId)
      sessionSpendCache.set(sessionId, cached)
      return cached.spend
    }
    if (cached !== undefined && cached.count < ownCount) {
      const spend = mergeTodaySpend(cached.spend, computeSessionSpend(events.slice(seedLength + cached.count), facts.billing, facts.catalog))
      evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT)
      sessionSpendCache.set(sessionId, { count: ownCount, spend })
      return spend
    }
    const spend = computeSessionSpend(events, facts.billing, facts.catalog, seedLength)
    evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT)
    sessionSpendCache.set(sessionId, { count: ownCount, spend })
    return spend
  }
}

/**
 * Once-registrar for the billing projection unit: the first call that finds
 * the registry composed registers the shared unit and every later call is a
 * no-op. Registering as early as the registry exists lets DSH's projection
 * write-behind (mandatory at `turn/end`) checkpoint a billing row for every
 * session that runs in this process, which is what makes the zero-I/O cold
 * path in {@link TodaySpendScanner} hit after the next restart.
 * @param ctx - plugin context.
 * @param unit - the unit definition built once per plugin config.
 * @returns an idempotent registrar.
 */
function createUnitRegistrar(ctx: Context, unit: BillingUnitDefinition): () => void {
  let registered = false
  return () => {
    if (registered) return
    const registry = ctx.get('sessionProjections')
    if (registry === undefined) return
    registry.register(unit)
    registered = true
  }
}

/**
 * Today-spend loaders over one revision-gated scanner with two 60s
 * Beijing-day caches (in-flight coalescing and a `force` bypass):
 * - plan C uses the per-session spend projection unit registered by the
 *   caller's {@link createUnitRegistrar} as early as the registry exists (the
 *   registry builds cells lazily over the in-memory log, so events committed
 *   before registration are folded on first touch); without the registry the
 *   events path serves today's spend.
 * - plans A1–A3: the scanner chooses the projection path when the registry
 *   is composed, the events path otherwise.
 * @param ctx - plugin context.
 * @param facts - resolved endpoint, credential, pricing, and catalog facts.
 * @param unit - the shared projection unit definition.
 * @param ensureUnit - idempotent unit registrar (last-resort registration).
 * @returns the two today-spend loaders.
 */
function createTodaySpendLoaders(
  ctx: Context,
  facts: ResolvedFacts,
  unit: BillingUnitDefinition,
  ensureUnit: () => void,
): {
  fetchTodaySpend: (force?: boolean) => Promise<DeepSeekTodaySpend>
  fetchTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend>
} {
  const scanner = new TodaySpendScanner({
    sessions: () => ctx.get('sessions'),
    persistence: () => ctx.get('sessionPersistence'),
    projections: () => ctx.get('sessionProjections'),
    projectionCache: () => ctx.get('sessionProjectionCache'),
    ensureUnit,
    unit,
    maxEvents: TODAY_SPEND_MAX_EVENTS,
    logger: ctx.logger,
    billing: facts.billing,
    catalog: facts.catalog,
  })
  const todayCache = new TodaySpendCache(
    dayKey => scanner.scanDetail(dayKey),
    TODAY_SPEND_CACHE_MS,
  )
  return {
    fetchTodaySpend: async (force = false) => (await todayCache.get(force)).aggregate,
    fetchTodaySessionsSpend: async (force = false) => ({ sessions: (await todayCache.get(force)).sessions }),
  }
}

/** One completed Turn's spend loader, located by its closing message id. */
function createTurnSpendFetcher(
  ctx: Context,
  facts: ResolvedFacts,
): (sessionId: SessionId, messageId: string) => Promise<DeepSeekTurnSpend> {
  return async (sessionId: SessionId, messageId: string): Promise<DeepSeekTurnSpend> => {
    const { events } = await sessionEvents(ctx, sessionId)
    return computeTurnSpend(events, facts.billing, facts.catalog, messageId)
  }
}

/**
 * Every completed Turn's cost in one session, folded incrementally per session
 * (session logs are append-only, so only the appended tail is priced on a
 * growing log). One call serves a whole transcript's per-message cost rows,
 * replacing the per-message `getTurnSpend` fan-out.
 */
function createTurnSpendsFetcher(
  ctx: Context,
  facts: ResolvedFacts,
): (sessionId: SessionId) => Promise<DeepSeekSessionTurnSpends> {
  const folders = new Map<SessionId, { folder: SessionTurnSpendFolder; count: number }>()
  return async (sessionId: SessionId): Promise<DeepSeekSessionTurnSpends> => {
    const { events } = await sessionEvents(ctx, sessionId)
    let entry = folders.get(sessionId)
    if (entry === undefined || entry.count > events.length) {
      entry = { folder: new SessionTurnSpendFolder(facts.billing, facts.catalog), count: 0 }
      evictOldest(folders, SESSION_TURN_SPEND_CACHE_LIMIT)
      folders.set(sessionId, entry)
    }
    if (entry.count !== events.length) {
      entry.folder.feed(events)
      entry.count = events.length
    }
    return entry.folder.finish()
  }
}

/**
 * Balance loader with a short host-side TTL and a hard request timeout: the
 * credential resolves per call, a fresh snapshot is reused for
 * {@link BALANCE_CACHE_MS} (so several badge mounts and several browsers share
 * one `/user/balance` call), concurrent misses coalesce, and `force` bypasses
 * the TTL for the manual refresh. A hung endpoint aborts after
 * {@link BALANCE_TIMEOUT_MS} instead of holding the badge's fetch forever.
 * @param ctx - plugin context carrying the credential seam.
 * @param facts - resolved endpoint and credential facts.
 * @returns the balance loader.
 */
function createBalanceFetcher(ctx: Context, facts: ResolvedFacts): (force?: boolean) => Promise<DeepSeekBalance> {
  let cached: { at: number; value: DeepSeekBalance } | undefined
  let inflight: Promise<DeepSeekBalance> | undefined
  return async (force = false): Promise<DeepSeekBalance> => {
    if (!force && cached !== undefined && Date.now() - cached.at < BALANCE_CACHE_MS) return cached.value
    if (inflight !== undefined) return inflight
    const run = (async (): Promise<DeepSeekBalance> => {
      try {
        const apiKey = await resolveApiKey(ctx, facts.apiKeyRef)
        const value = await fetchDeepSeekBalance(facts.baseURL(), apiKey, AbortSignal.timeout(BALANCE_TIMEOUT_MS))
        cached = { at: Date.now(), value }
        return value
      } finally {
        inflight = undefined
      }
    })()
    inflight = run
    return run
  }
}

/**
 * Register the `billing` Remote under the `billing` namespace. Assembly only:
 * facts resolve once, each loader owns its caches, and the gateway receives
 * the bound thunks.
 * @param ctx - owning plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const facts = resolveFacts(ctx, config)
  // One unit instance per plugin config, registered as early as the registry
  // exists (and again on the first session created, in case the registry is
  // composed after this plugin): DSH's write-behind then checkpoints a
  // billing row for every session that runs in this process.
  const unit = billingTodaySpendDefinition(facts.billing, facts.catalog)
  const ensureUnit = createUnitRegistrar(ctx, unit)
  ensureUnit()
  ctx.on('session/created', ensureUnit)
  const fetchBalance = createBalanceFetcher(ctx, facts)
  const fetchSessionSpend = createSessionSpendFetcher(ctx, facts)
  const { fetchTodaySpend, fetchTodaySessionsSpend } = createTodaySpendLoaders(ctx, facts, unit, ensureUnit)
  const fetchTurnSpend = createTurnSpendFetcher(ctx, facts)
  const fetchTurnSpends = createTurnSpendsFetcher(ctx, facts)
  new DeepSeekBalanceGateway(ctx, {
    fetchBalance,
    fetchSessionSpend,
    fetchTodaySpend,
    fetchTodaySessionsSpend,
    fetchTurnSpend,
    fetchTurnSpends,
  })
}
