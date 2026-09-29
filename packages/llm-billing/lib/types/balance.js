/**
 * DeepSeek account-balance capability: the `GET /user/balance` transport and
 * the Remote gateway that exposes one snapshot to trusted clients. The fetch
 * takes an already-resolved endpoint and bearer token so the registering
 * plugin stays the one owner of credential policy; the gateway carries only a
 * `fetchBalance` thunk for the same reason.
 * @module @rayadesu/dsh-llm-billing/balance
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { LlmError } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Map a balance HTTP status to a stable LlmError code. */
function httpErrorCode(status) {
    if (status === 401 || status === 403)
        return 'AUTH';
    if (status === 429)
        return 'RATE_LIMIT';
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
/**
 * Parse and validate the DeepSeek balance response at the wire boundary.
 * @param body - decoded JSON response body.
 * @returns the validated, detached balance snapshot.
 * @throws {@link LlmError} with code `TRANSPORT` when the body is malformed.
 */
export function parseDeepSeekBalance(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new LlmError('DeepSeek balance response was not a JSON object', 'TRANSPORT');
    }
    const response = body;
    const isAvailable = response['is_available'];
    const infos = response['balance_infos'];
    if (typeof isAvailable !== 'boolean' || !Array.isArray(infos)) {
        throw new LlmError('DeepSeek balance response is missing is_available or balance_infos', 'TRANSPORT');
    }
    const lines = infos.map((info, index) => {
        if (typeof info !== 'object' || info === null || Array.isArray(info)) {
            throw new LlmError(`DeepSeek balance line ${index} is malformed`, 'TRANSPORT');
        }
        const line = info;
        const currency = line['currency'];
        const total = line['total_balance'];
        const granted = line['granted_balance'];
        const toppedUp = line['topped_up_balance'];
        if (typeof currency !== 'string' || currency.length === 0
            || typeof total !== 'string'
            || typeof granted !== 'string'
            || typeof toppedUp !== 'string') {
            throw new LlmError(`DeepSeek balance line ${index} has missing or invalid fields`, 'TRANSPORT');
        }
        return { currency, total, granted, toppedUp };
    });
    return { isAvailable, lines };
}
/** Attempts one balance fetch makes before giving up on a transient fault. */
export const BALANCE_FETCH_ATTEMPTS = 3;
/** The first retry's delay in milliseconds; doubled for each further attempt. */
export const BALANCE_RETRY_BASE_MS = 150;
/**
 * Whether another attempt can plausibly succeed. Only faults transient BY
 * NATURE qualify: a dropped socket (no status), a rate limit, or a server-side
 * error. A settled 4xx is final — retrying a bad key three times only reports
 * the truth three times later.
 */
function isRetryableStatus(status) {
    if (status === undefined)
        return true;
    return status === 429 || status >= 500;
}
/** Wait `ms` before the next attempt, abandoning the wait if the caller aborts. */
function waitBalanceRetry(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** One balance request attempt, REPORTED rather than thrown so the caller decides. */
async function requestBalanceOnce(baseURL, apiKey, signal) {
    let response;
    try {
        response = await fetch(`${baseURL}/user/balance`, {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${apiKey}`,
                'accept': 'application/json',
            },
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        const wrapped = signal?.aborted === true
            ? new LlmError('DeepSeek balance request aborted by caller', 'ABORTED', { cause: error })
            : new LlmError(`DeepSeek balance request to ${baseURL} failed`, 'TRANSPORT', { cause: error });
        return { ok: false, status: undefined, error: wrapped };
    }
    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            error: new LlmError(`DeepSeek balance request failed (HTTP ${response.status})`, httpErrorCode(response.status), { status: response.status }),
        };
    }
    let body;
    try {
        body = await response.json();
    }
    catch (error) {
        // A malformed body is never transient, hence `status` rather than
        // `undefined`: no retry, just the failure.
        return { ok: false, status: response.status, error: new LlmError('DeepSeek balance response was not valid JSON', 'TRANSPORT', { cause: error }) };
    }
    return { ok: true, value: parseDeepSeekBalance(body) };
}
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
export async function fetchDeepSeekBalance(baseURL, apiKey, signal) {
    for (let attempt = 1;; attempt += 1) {
        const outcome = await requestBalanceOnce(baseURL, apiKey, signal);
        if (outcome.ok)
            return outcome.value;
        const exhausted = attempt >= BALANCE_FETCH_ATTEMPTS;
        const aborted = signal?.aborted === true;
        if (!exhausted && !aborted && isRetryableStatus(outcome.status)) {
            await waitBalanceRetry(BALANCE_RETRY_BASE_MS * 2 ** (attempt - 1), signal);
            continue;
        }
        // A rejected credential is the one failure a user can act on, and retrying
        // never fixes it: name what to check, not just the status code.
        if (outcome.status === 401 || outcome.status === 403) {
            throw new LlmError(`DeepSeek balance request was rejected (HTTP ${outcome.status}) — the API key in effect for ${baseURL} is missing or unauthorized (check DEEPSEEK_API_KEY)`, httpErrorCode(outcome.status), { status: outcome.status });
        }
        throw outcome.error;
    }
}
/**
 * Remote-only service exposing the DeepSeek account balance and session spend.
 * The plugin that owns connection, credential, and session-history resolution
 * constructs it with the matching thunks, so the Remote boundary never sees an
 * endpoint, key, or the session store.
 */
let DeepSeekBalanceGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getBalance_decorators;
    let _getSessionSpend_decorators;
    let _getTodaySpend_decorators;
    let _getTodaySessionsSpend_decorators;
    let _getDelegatedSpend_decorators;
    let _getTurnSpend_decorators;
    let _getSessionTurnSpends_decorators;
    return class DeepSeekBalanceGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getBalance_decorators = [Remote('getBalance')];
            _getSessionSpend_decorators = [Remote('getSessionSpend')];
            _getTodaySpend_decorators = [Remote('getTodaySpend')];
            _getTodaySessionsSpend_decorators = [Remote('getTodaySessionsSpend')];
            _getDelegatedSpend_decorators = [Remote('getDelegatedSpend')];
            _getTurnSpend_decorators = [Remote('getTurnSpend')];
            _getSessionTurnSpends_decorators = [Remote('getSessionTurnSpends')];
            __esDecorate(this, null, _getBalance_decorators, { kind: "method", name: "getBalance", static: false, private: false, access: { has: obj => "getBalance" in obj, get: obj => obj.getBalance }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getSessionSpend_decorators, { kind: "method", name: "getSessionSpend", static: false, private: false, access: { has: obj => "getSessionSpend" in obj, get: obj => obj.getSessionSpend }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getTodaySpend_decorators, { kind: "method", name: "getTodaySpend", static: false, private: false, access: { has: obj => "getTodaySpend" in obj, get: obj => obj.getTodaySpend }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getTodaySessionsSpend_decorators, { kind: "method", name: "getTodaySessionsSpend", static: false, private: false, access: { has: obj => "getTodaySessionsSpend" in obj, get: obj => obj.getTodaySessionsSpend }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getDelegatedSpend_decorators, { kind: "method", name: "getDelegatedSpend", static: false, private: false, access: { has: obj => "getDelegatedSpend" in obj, get: obj => obj.getDelegatedSpend }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getTurnSpend_decorators, { kind: "method", name: "getTurnSpend", static: false, private: false, access: { has: obj => "getTurnSpend" in obj, get: obj => obj.getTurnSpend }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getSessionTurnSpends_decorators, { kind: "method", name: "getSessionTurnSpends", static: false, private: false, access: { has: obj => "getSessionTurnSpends" in obj, get: obj => obj.getSessionTurnSpends }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        options = __runInitializers(this, _instanceExtraInitializers);
        /**
         * Register the balance Remote under the `billing` namespace.
         * @param ctx - owning plugin context.
         * @param options - balance and spend thunks bound to the plugin's facts.
         */
        constructor(ctx, options) {
            super(ctx, 'billing');
            this.options = options;
        }
        /**
         * Read the current DeepSeek account balance. A snapshot younger than the
         * host-side TTL is reused, so several badge mounts share one provider call;
         * `force` bypasses the TTL for the manual refresh.
         * @param force - bypass the host-side TTL; omitted means a cached read.
         * @returns the validated balance snapshot.
         */
        getBalance(force) {
            return this.options.fetchBalance(force ?? false);
        }
        /**
         * Read one session's billed spend (same per-event pricing as
         * {@link priceEvent}).
         * @param sessionId - the session whose spend to compute.
         * @returns the session's total cost plus one row per priced model.
         */
        getSessionSpend(sessionId) {
            return this.options.fetchSessionSpend(sessionId);
        }
        /**
         * Read today's billed spend across every session: the same per-event
         * pricing as {@link priceEvent}, restricted to the queried Beijing day.
         * @param force - bypass the host-side 60s cache (manual refresh); omitted
         *   means a cached read. Remote parameters cannot carry default values, so
         *   the thunk receives `undefined` for an omitted argument.
         * @returns today's total cost plus one row per priced model.
         */
        getTodaySpend(force) {
            return this.options.fetchTodaySpend(force ?? false);
        }
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
        getTodaySessionsSpend(force) {
            return this.options.fetchTodaySessionsSpend(force ?? false);
        }
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
        getDelegatedSpend(sessionId, force) {
            return this.options.fetchDelegatedSpend(sessionId, force ?? false);
        }
        /**
         * Read one completed Turn's billed spend (same per-event pricing as
         * {@link priceEvent}).
         * @param sessionId - the session owning the Turn.
         * @param messageId - the closing assistant message's durable id, which
         *   locates the Turn in the session log.
         * @returns the Turn's total cost in CNY.
         */
        getTurnSpend(sessionId, messageId) {
            return this.options.fetchTurnSpend(sessionId, messageId);
        }
        /**
         * Read every completed Turn's billed spend in one session (same per-event
         * pricing as {@link priceEvent}). One call replaces the per-message
         * `getTurnSpend` fan-out for a rendered transcript.
         * @param sessionId - the session whose Turn costs to compute.
         * @returns one row per assistant message inside a completed Turn, in log order.
         */
        getSessionTurnSpends(sessionId) {
            return this.options.fetchTurnSpends(sessionId);
        }
    };
})();
export { DeepSeekBalanceGateway };
export default DeepSeekBalanceGateway;
//# sourceMappingURL=balance.js.map