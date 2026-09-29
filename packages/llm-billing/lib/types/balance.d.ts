/**
 * DeepSeek account-balance capability: the `GET /user/balance` transport and
 * the Remote gateway that exposes one snapshot to trusted clients. The fetch
 * takes an already-resolved endpoint and bearer token so the registering
 * plugin stays the one owner of credential policy; the gateway carries only a
 * `fetchBalance` thunk for the same reason.
 * @module @rayadesu/dsh-llm-billing/balance
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { DeepSeekBalance, DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekSessionTurnSpends, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from './types.ts';
/**
 * Parse and validate the DeepSeek balance response at the wire boundary.
 * @param body - decoded JSON response body.
 * @returns the validated, detached balance snapshot.
 * @throws {@link LlmError} with code `TRANSPORT` when the body is malformed.
 */
export declare function parseDeepSeekBalance(body: unknown): DeepSeekBalance;
/** Attempts one balance fetch makes before giving up on a transient fault. */
export declare const BALANCE_FETCH_ATTEMPTS = 3;
/** The first retry's delay in milliseconds; doubled for each further attempt. */
export declare const BALANCE_RETRY_BASE_MS = 150;
/**
 * Fetch one account-balance snapshot from `{baseURL}/user/balance`.
 *
 * Retries the faults that can plausibly clear — a dropped socket, a 429, a 5xx
 * — up to {@link BALANCE_FETCH_ATTEMPTS} attempts, because the badge polls
 * every few minutes and one lost packet would otherwise blank the balance
 * until the next interval. Permanent answers (including a rejected key) fail
 * on the first attempt.
 * @param baseURL - resolved endpoint base; `/user/balance` is appended.
 * @param apiKey - resolved bearer token for this endpoint.
 * @param signal - optional cancellation.
 * @returns the validated balance snapshot.
 * @throws {@link LlmError} for transport, HTTP, or malformed-response failures.
 */
export declare function fetchDeepSeekBalance(baseURL: string, apiKey: string, signal?: AbortSignal): Promise<DeepSeekBalance>;
/** Thunks the plugin binds to its own resolution and history access. */
export interface DeepSeekBalanceGatewayOptions {
    /**
     * Fetch one balance snapshot through the plugin's resolved facts.
     * `force` bypasses the host-side TTL (the manual refresh path).
     */
    fetchBalance: (force?: boolean) => Promise<DeepSeekBalance>;
    /** Compute one session's billed spend through the plugin's resolved facts. */
    fetchSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>;
    /**
     * Compute today's billed spend across every session through the plugin's
     * resolved facts. `force` bypasses the host-side time window (the manual
     * refresh path); a `force` miss still reuses revision-gated increments.
     */
    fetchTodaySpend: (force?: boolean) => Promise<DeepSeekTodaySpend>;
    /**
     * Compute today's billed spend per session through the plugin's resolved
     * facts, sorted by cost descending. `force` bypasses the host-side time
     * window like {@link fetchTodaySpend}.
     */
    fetchTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend>;
    /**
     * Compute the subagent part of one conversation's billed spend through the
     * plugin's resolved facts: every subagent session that session delegated,
     * transitively, across every day. Served from the same cached pass as
     * {@link fetchTodaySpend}; `force` bypasses the time window like it does.
     */
    fetchDelegatedSpend: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend>;
    /**
     * Compute one completed Turn's billed spend through the plugin's resolved
     * facts, identified by its closing assistant message id.
     */
    fetchTurnSpend: (sessionId: SessionId, messageId: string) => Promise<DeepSeekTurnSpend>;
    /**
     * Compute every completed Turn's billed spend in one session through the
     * plugin's resolved facts, in one pass over the log.
     */
    fetchTurnSpends: (sessionId: SessionId) => Promise<DeepSeekSessionTurnSpends>;
}
/**
 * Remote-only service exposing the DeepSeek account balance and session spend.
 * The plugin that owns connection, credential, and session-history resolution
 * constructs it with the matching thunks, so the Remote boundary never sees an
 * endpoint, key, or the session store.
 */
export declare class DeepSeekBalanceGateway extends TypertRemoteService {
    private readonly options;
    /**
     * Register the balance Remote under the `billing` namespace.
     * @param ctx - owning plugin context.
     * @param options - balance and spend thunks bound to the plugin's facts.
     */
    constructor(ctx: Context, options: DeepSeekBalanceGatewayOptions);
    /**
     * Read the current DeepSeek account balance. A snapshot younger than the
     * host-side TTL is reused, so several badge mounts share one provider call;
     * `force` bypasses the TTL for the manual refresh.
     * @param force - bypass the host-side TTL; omitted means a cached read.
     * @returns the validated balance snapshot.
     */
    getBalance(force?: boolean): Promise<DeepSeekBalance>;
    /**
     * Read one session's billed spend (same per-event pricing as
     * {@link priceEvent}).
     * @param sessionId - the session whose spend to compute.
     * @returns the session's total cost plus one row per priced model.
     */
    getSessionSpend(sessionId: SessionId): Promise<DeepSeekSessionSpend>;
    /**
     * Read today's billed spend across every session: the same per-event
     * pricing as {@link priceEvent}, restricted to the queried Beijing day.
     * @param force - bypass the host-side 60s cache (manual refresh); omitted
     *   means a cached read. Remote parameters cannot carry default values, so
     *   the thunk receives `undefined` for an omitted argument.
     * @returns today's total cost plus one row per priced model.
     */
    getTodaySpend(force?: boolean): Promise<DeepSeekTodaySpend>;
    /**
     * Read today's billed spend per session, restricted to the queried Beijing
     * day. Rows carry the session's durable title and sort by cost descending;
     * sessions with no priced usage on the day are omitted, and every subagent
     * session is merged into the row of the top-level session that delegated it,
     * so the ranking lists conversations rather than delegations.
     * @param force - bypass the host-side 60s cache (manual refresh); omitted
     *   means a cached read.
     * @returns today's per-session rows, highest first.
     */
    getTodaySessionsSpend(force?: boolean): Promise<DeepSeekTodaySessionsSpend>;
    /**
     * Read the subagent part of one conversation's billed spend: every subagent
     * session the given session delegated, transitively, across every day (a
     * session's own log cannot price its delegation children). `isSubagent`
     * reports whether the queried session is itself a delegated child.
     * @param sessionId - the session whose delegated subtree to sum.
     * @param force - bypass the host-side 60s cache (manual refresh); omitted
     *   means a cached read.
     * @returns the delegated subtotal plus its per-model rows.
     */
    getDelegatedSpend(sessionId: SessionId, force?: boolean): Promise<DeepSeekDelegatedSpend>;
    /**
     * Read one completed Turn's billed spend (same per-event pricing as
     * {@link priceEvent}).
     * @param sessionId - the session owning the Turn.
     * @param messageId - the closing assistant message's durable id, which
     *   locates the Turn in the session log.
     * @returns the Turn's total cost in CNY.
     */
    getTurnSpend(sessionId: SessionId, messageId: string): Promise<DeepSeekTurnSpend>;
    /**
     * Read every completed Turn's billed spend in one session (same per-event
     * pricing as {@link priceEvent}). One call replaces the per-message
     * `getTurnSpend` fan-out for a rendered transcript.
     * @param sessionId - the session whose Turn costs to compute.
     * @returns one row per assistant message inside a completed Turn, in log order.
     */
    getSessionTurnSpends(sessionId: SessionId): Promise<DeepSeekSessionTurnSpends>;
}
export default DeepSeekBalanceGateway;
//# sourceMappingURL=balance.d.ts.map