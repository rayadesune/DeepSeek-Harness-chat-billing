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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { BillingConfig } from './billing.ts';
export { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from './balance.ts';
export { addEventContribution, applyBillingEvent, beijingDayKey, BillingFolder, computeSessionSpend, computeSessionTurnSpends, computeTodaySpend, computeTurnSpend, DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS, emptyBillingFoldState, emptyTodaySpend, FLASH_SERIES_RATE_CHANGE_AT, forkBoundaryOf, isPeak, isSeededSession, mergeTodaySpend, negateSpend, priceEvent, priceUsage, resolveBilling, SessionTurnSpendFolder, SpendAccumulator, subtractSpend, V4_PRO_ROUTE_SWITCH_AT, } from './billing.ts';
export type { BillingConfig, BillingConfigModel, BillingEventContribution, BillingFoldSample, BillingFoldState, DeepSeekModelPricing, DeepSeekRateRevision, DeepSeekTokenPrice, PeakHourWindow, ResolvedBilling, } from './billing.ts';
export type * from './types.ts';
export { BILLING_UNIT_KEY, billingTodaySpendDefinition, foldBillingUnit, foldOwnBilling } from './projection.ts';
export type { BillingUnitFold, BillingUnitState } from './projection.ts';
export { delegatedSpendOf, foldSessionTitle, isSubagentSession, liveSessionEvents, persistenceInspect, persistenceListSnapshots, rollUpSubagentSpend, TodaySpendCache, TodaySpendScanner, topLevelSessionOf, } from './today-spend.ts';
export type { ColdResolution, ScannerPersistedHeader, ScannerPersistence, ScannerPersistenceHandle, ScannerPersistedRead, ScannerSession, SessionHeaderSlice, SessionLineage, TodaySpendScannerDeps, } from './today-spend.ts';
export declare const name = "llm-billing";
/** Public API default; deployments may point elsewhere via $DEEPSEEK_BASE_URL. */
export declare const PUBLIC_BASE_URL = "https://api.deepseek.com";
/** One advisory display row; requests are never restricted to this list. */
export interface BillingModel {
    /** Wire model id, e.g. `deepseek-v4-flash`. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
}
/**
 * Plugin config. Every field is optional: the API key resolves per call from
 * {@link Config.apiKeyEnv} (credentials seam, then environment), the endpoint
 * falls back to `$DEEPSEEK_BASE_URL` then the public API, and the pricing
 * table and peak-hour windows fall back to the published DeepSeek rates.
 */
export interface Config {
    /** Credential reference (environment-variable name); defaults to `DEEPSEEK_API_KEY`. */
    apiKeyEnv?: string;
    /** Endpoint base; defaults to `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com`. */
    baseURL?: string;
    /** Advisory display rows, in presentation order; defaults to V4 Flash, V4.1 Flash, V4 Pro, and V4 Flash Vision Exp. */
    models?: BillingModel[];
    /**
     * Pricing table and peak-hour windows; omission uses the published defaults
     * (including the V4 Flash series re-pricing effective 2026-09-10 12:00
     * Beijing). Peak windows apply weekdays (Monday–Friday) only; weekends are
     * always off-peak.
     */
    billing?: BillingConfig;
}
export declare const Config: z<Config>;
/** How often a Beijing-day "today spend" value may be recomputed (60s). */
export declare const TODAY_SPEND_CACHE_MS = 60000;
/** Hard cap on today's events collected by the events scan path. */
export declare const TODAY_SPEND_MAX_EVENTS = 200000;
/** Max session-spend rows kept for incremental recompute before eviction. */
export declare const SESSION_SPEND_CACHE_LIMIT = 1024;
/** Max session-id entries kept in the per-turn-cost fold cache before eviction. */
export declare const SESSION_TURN_SPEND_CACHE_LIMIT = 64;
/** How long one balance snapshot is reused before the host refetches it (15s). */
export declare const BALANCE_CACHE_MS = 15000;
/** Hard cap on one `/user/balance` request (5s); a hung endpoint never blocks the badge. */
export declare const BALANCE_TIMEOUT_MS = 5000;
/**
 * Register the `billing` Remote under the `billing` namespace. Assembly only:
 * facts resolve once, each loader owns its caches, and the gateway receives
 * the bound thunks.
 * @param ctx - owning plugin context.
 * @param config - validated plugin config.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map