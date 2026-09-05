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
} from './billing.ts'
import type { BillingConfig, BillingConfigModel } from './billing.ts'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from './types.ts'
import { billingTodaySpendDefinition } from './projection.ts'
import { liveSessionEvents, persistenceInspect, TodaySpendCache, TodaySpendScanner } from './today-spend.ts'
import type { ScannerPersistence } from './today-spend.ts'

export { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from './balance.ts'
export {
  addEventContribution,
  beijingDayKey,
  computeSessionSpend,
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
  /** Advisory display rows, in presentation order; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp. */
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

/**
 * Register the `billing` Remote under the `billing` namespace.
 * @param ctx - owning plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const baseURL = (): string => config.baseURL
    ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
    ?? PUBLIC_BASE_URL
  const apiKeyRef = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)

  const resolveApiKey = async (): Promise<string> => {
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

  const fetchBalance = async (): Promise<DeepSeekBalance> => {
    const apiKey = await resolveApiKey()
    return fetchDeepSeekBalance(baseURL(), apiKey)
  }

  const billing = resolveBilling(config.billing)
  const catalog = (config.models ?? DEFAULT_MODELS).map(model => ({ id: model.id, name: model.name ?? model.id }))

  // Per-session incremental spend cache: a session log is append-only and
  // chronological (the same assumption the projection unit makes), so a spend
  // computed for `count` EVENTS OF THE SESSION'S OWN WORK (the log minus its
  // inherited fork prefix) stays valid while the log length is unchanged, and
  // only the appended tail needs pricing when it grows. A forked child's
  // inherited prefix (`seq < seedLength`) is priced only in its source
  // session; the map is capped so an unbounded session-id space cannot grow
  // it without bound (see {@link evictOldest}).
  const sessionSpendCache = new Map<SessionId, { count: number; spend: DeepSeekSessionSpend }>()
  const fetchSessionSpend = async (sessionId: SessionId): Promise<DeepSeekSessionSpend> => {
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
      const spend = mergeTodaySpend(cached.spend, computeSessionSpend(events.slice(seedLength + cached.count), billing, catalog))
      evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT)
      sessionSpendCache.set(sessionId, { count: ownCount, spend })
      return spend
    }
    const spend = computeSessionSpend(events, billing, catalog, seedLength)
    evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT)
    sessionSpendCache.set(sessionId, { count: ownCount, spend })
    return spend
  }

  // Plan C: register the per-session spend projection unit on the projection
  // registry. Registration is lazy — it happens on the first projection-path
  // scan, not through `ctx.inject` (whose plugin-mount wait would also engage
  // the test-invariant host in suites that never provide the registry). The
  // registry builds cells lazily over the in-memory log, so events committed
  // before registration are folded on first touch; without the registry the
  // events path serves today's spend.
  const unit = billingTodaySpendDefinition(billing, catalog)
  let unitRegistered = false
  const ensureUnit = (): void => {
    if (unitRegistered) return
    const registry = ctx.get('sessionProjections')
    if (registry === undefined) return
    registry.register(unit)
    unitRegistered = true
  }

  // Plans A1–A3: 60s Beijing-day cache with in-flight coalescing and a force
  // bypass, over a revision-gated scanner (projection path when the registry
  // is composed, events path otherwise).
  const scanner = new TodaySpendScanner({
    sessions: () => ctx.get('sessions'),
    persistence: () => ctx.get('sessionPersistence'),
    projections: () => ctx.get('sessionProjections'),
    projectionCache: () => ctx.get('sessionProjectionCache'),
    ensureUnit,
    unit,
    maxEvents: TODAY_SPEND_MAX_EVENTS,
    logger: ctx.logger,
    billing,
    catalog,
  })
  const todayCache = new TodaySpendCache(
    dayKey => scanner.scan(dayKey),
    TODAY_SPEND_CACHE_MS,
  )
  const todaySessionsCache = new TodaySpendCache(
    dayKey => scanner.scanSessions(dayKey),
    TODAY_SPEND_CACHE_MS,
  )

  const fetchTodaySpend = async (force = false): Promise<DeepSeekTodaySpend> => todayCache.get(force)
  const fetchTodaySessionsSpend = async (force = false): Promise<DeepSeekTodaySessionsSpend> => todaySessionsCache.get(force)

  const fetchTurnSpend = async (sessionId: SessionId, messageId: string): Promise<DeepSeekTurnSpend> => {
    const { events } = await sessionEvents(ctx, sessionId)
    return computeTurnSpend(events, billing, catalog, messageId)
  }

  new DeepSeekBalanceGateway(ctx, { fetchBalance, fetchSessionSpend, fetchTodaySpend, fetchTodaySessionsSpend, fetchTurnSpend })
}
