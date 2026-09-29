import z from "@deepseek-ai/schemastery";
import { LlmError, assertUsableApiKey } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z as z$1 } from "zod";
//#region lib/types/balance.js
/**
* DeepSeek account-balance capability: the `GET /user/balance` transport and
* the Remote gateway that exposes one snapshot to trusted clients. The fetch
* takes an already-resolved endpoint and bearer token so the registering
* plugin stays the one owner of credential policy; the gateway carries only a
* `fetchBalance` thunk for the same reason.
* @module @rayadesu/dsh-llm-billing/balance
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Map a balance HTTP status to a stable LlmError code. */
function httpErrorCode(status) {
	if (status === 401 || status === 403) return "AUTH";
	if (status === 429) return "RATE_LIMIT";
	if (status >= 500) return "SERVER";
	return `HTTP_${status}`;
}
/**
* Parse and validate the DeepSeek balance response at the wire boundary.
* @param body - decoded JSON response body.
* @returns the validated, detached balance snapshot.
* @throws {@link LlmError} with code `TRANSPORT` when the body is malformed.
*/
function parseDeepSeekBalance(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new LlmError("DeepSeek balance response was not a JSON object", "TRANSPORT");
	const response = body;
	const isAvailable = response["is_available"];
	const infos = response["balance_infos"];
	if (typeof isAvailable !== "boolean" || !Array.isArray(infos)) throw new LlmError("DeepSeek balance response is missing is_available or balance_infos", "TRANSPORT");
	return {
		isAvailable,
		lines: infos.map((info, index) => {
			if (typeof info !== "object" || info === null || Array.isArray(info)) throw new LlmError(`DeepSeek balance line ${index} is malformed`, "TRANSPORT");
			const line = info;
			const currency = line["currency"];
			const total = line["total_balance"];
			const granted = line["granted_balance"];
			const toppedUp = line["topped_up_balance"];
			if (typeof currency !== "string" || currency.length === 0 || typeof total !== "string" || typeof granted !== "string" || typeof toppedUp !== "string") throw new LlmError(`DeepSeek balance line ${index} has missing or invalid fields`, "TRANSPORT");
			return {
				currency,
				total,
				granted,
				toppedUp
			};
		})
	};
}
/**
* Whether another attempt can plausibly succeed. Only faults transient BY
* NATURE qualify: a dropped socket (no status), a rate limit, or a server-side
* error. A settled 4xx is final — retrying a bad key three times only reports
* the truth three times later.
*/
function isRetryableStatus(status) {
	if (status === void 0) return true;
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
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
/** One balance request attempt, REPORTED rather than thrown so the caller decides. */
async function requestBalanceOnce(baseURL, apiKey, signal) {
	let response;
	try {
		response = await fetch(`${baseURL}/user/balance`, {
			method: "GET",
			headers: {
				"authorization": `Bearer ${apiKey}`,
				"accept": "application/json"
			},
			...signal === void 0 ? {} : { signal }
		});
	} catch (error) {
		return {
			ok: false,
			status: void 0,
			error: signal?.aborted === true ? new LlmError("DeepSeek balance request aborted by caller", "ABORTED", { cause: error }) : new LlmError(`DeepSeek balance request to ${baseURL} failed`, "TRANSPORT", { cause: error })
		};
	}
	if (!response.ok) return {
		ok: false,
		status: response.status,
		error: new LlmError(`DeepSeek balance request failed (HTTP ${response.status})`, httpErrorCode(response.status), { status: response.status })
	};
	let body;
	try {
		body = await response.json();
	} catch (error) {
		return {
			ok: false,
			status: response.status,
			error: new LlmError("DeepSeek balance response was not valid JSON", "TRANSPORT", { cause: error })
		};
	}
	return {
		ok: true,
		value: parseDeepSeekBalance(body)
	};
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
async function fetchDeepSeekBalance(baseURL, apiKey, signal) {
	for (let attempt = 1;; attempt += 1) {
		const outcome = await requestBalanceOnce(baseURL, apiKey, signal);
		if (outcome.ok) return outcome.value;
		const exhausted = attempt >= 3;
		const aborted = signal?.aborted === true;
		if (!exhausted && !aborted && isRetryableStatus(outcome.status)) {
			await waitBalanceRetry(150 * 2 ** (attempt - 1), signal);
			continue;
		}
		if (outcome.status === 401 || outcome.status === 403) throw new LlmError(`DeepSeek balance request was rejected (HTTP ${outcome.status}) — the API key in effect for ${baseURL} is missing or unauthorized (check DEEPSEEK_API_KEY)`, httpErrorCode(outcome.status), { status: outcome.status });
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
			_getBalance_decorators = [Remote("getBalance")];
			_getSessionSpend_decorators = [Remote("getSessionSpend")];
			_getTodaySpend_decorators = [Remote("getTodaySpend")];
			_getTodaySessionsSpend_decorators = [Remote("getTodaySessionsSpend")];
			_getDelegatedSpend_decorators = [Remote("getDelegatedSpend")];
			_getTurnSpend_decorators = [Remote("getTurnSpend")];
			_getSessionTurnSpends_decorators = [Remote("getSessionTurnSpends")];
			__esDecorate(this, null, _getBalance_decorators, {
				kind: "method",
				name: "getBalance",
				static: false,
				private: false,
				access: {
					has: (obj) => "getBalance" in obj,
					get: (obj) => obj.getBalance
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getSessionSpend_decorators, {
				kind: "method",
				name: "getSessionSpend",
				static: false,
				private: false,
				access: {
					has: (obj) => "getSessionSpend" in obj,
					get: (obj) => obj.getSessionSpend
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getTodaySpend_decorators, {
				kind: "method",
				name: "getTodaySpend",
				static: false,
				private: false,
				access: {
					has: (obj) => "getTodaySpend" in obj,
					get: (obj) => obj.getTodaySpend
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getTodaySessionsSpend_decorators, {
				kind: "method",
				name: "getTodaySessionsSpend",
				static: false,
				private: false,
				access: {
					has: (obj) => "getTodaySessionsSpend" in obj,
					get: (obj) => obj.getTodaySessionsSpend
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getDelegatedSpend_decorators, {
				kind: "method",
				name: "getDelegatedSpend",
				static: false,
				private: false,
				access: {
					has: (obj) => "getDelegatedSpend" in obj,
					get: (obj) => obj.getDelegatedSpend
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getTurnSpend_decorators, {
				kind: "method",
				name: "getTurnSpend",
				static: false,
				private: false,
				access: {
					has: (obj) => "getTurnSpend" in obj,
					get: (obj) => obj.getTurnSpend
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _getSessionTurnSpends_decorators, {
				kind: "method",
				name: "getSessionTurnSpends",
				static: false,
				private: false,
				access: {
					has: (obj) => "getSessionTurnSpends" in obj,
					get: (obj) => obj.getSessionTurnSpends
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		options = __runInitializers(this, _instanceExtraInitializers);
		/**
		* Register the balance Remote under the `billing` namespace.
		* @param ctx - owning plugin context.
		* @param options - balance and spend thunks bound to the plugin's facts.
		*/
		constructor(ctx, options) {
			super(ctx, "billing");
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
//#endregion
//#region lib/types/beijing-time.js
/**
* Beijing wall-clock arithmetic (Asia/Shanghai: a fixed UTC+8, no DST) — the
* calendar fields a sample's rate depends on, and the day boundaries a scan is
* clipped to. Split out of `billing.ts`: pricing asks this module questions, it
* never asks about pricing.
* @module @rayadesu/dsh-llm-billing/beijing-time
*/
/** Beijing is a fixed UTC+8 offset with no DST. */
const BEIJING_OFFSET_MS = 288e5;
/** Milliseconds in one day. */
const DAY_MS = 864e5;
/** Epoch day of 1970-01-01 in the civil-date algorithm below. */
const CIVIL_EPOCH_DAY = 719468;
/** Two-digit zero pad for a calendar field. */
function pad2(value) {
	return value < 10 ? `0${value}` : String(value);
}
/**
* Civil date of an epoch day (Howard Hinnant's days-from-civil inverse):
* pure integer arithmetic, no `Date` allocation and no ISO-string slicing.
*/
function civilDateOf(epochDay) {
	const shifted = epochDay + CIVIL_EPOCH_DAY;
	const era = Math.floor(shifted / 146097);
	const dayOfEra = shifted - era * 146097;
	const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
	const year = yearOfEra + era * 400;
	const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
	const month = monthPrime + (monthPrime < 10 ? 3 : -9);
	return {
		year: month <= 2 ? year + 1 : year,
		month,
		day: dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
	};
}
/**
* Derive the Beijing hour, weekday, and calendar-day key of one timestamp with
* pure integer arithmetic — every timezone-sensitive read shares this one
* implementation, so the pieces cannot drift apart. Callers that filter by
* day and then price the same event reuse the returned view, so each event is
* parsed exactly once. (The hot fold path runs this per committed event; the
* previous `Date` + `toISOString().slice()` version allocated a `Date` and a
* 24-character string per call.)
* @param time - epoch milliseconds.
* @throws {RangeError} when `time` is not a finite number.
*/
function beijingPartsOf(time) {
	if (!Number.isFinite(time)) throw new RangeError(`billing: event time is not finite (${String(time)})`);
	const shifted = time + BEIJING_OFFSET_MS;
	const epochDay = Math.floor(shifted / DAY_MS);
	const msOfDay = shifted - epochDay * DAY_MS;
	const civil = civilDateOf(epochDay);
	return {
		time,
		hour: Math.floor(msOfDay / 36e5),
		weekday: ((epochDay + 4) % 7 + 7) % 7,
		dayKey: `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`
	};
}
/** The Beijing (Asia/Shanghai, UTC+8, no DST) calendar-day key of a timestamp. */
function beijingDayKey(now) {
	return beijingPartsOf(now.getTime()).dayKey;
}
/**
* The Beijing calendar day NAMED by `dayKey` as an epoch-millisecond range:
* `start` inclusive, `end` exclusive. Derived from the key itself rather than
* from a clock, because a scan prices whatever day it was asked for — today,
* or a day a caller is replaying.
*
* The conversion needs no calendar arithmetic: `Date.UTC` builds midnight UTC
* of that civil date, and Beijing midnight is a fixed offset earlier (no DST).
* @param dayKey - a `YYYY-MM-DD` Beijing day key.
* @returns the day's bounds, or `undefined` when the key is not that shape.
*/
function beijingDayRangeOfKey(dayKey) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
	if (match === null) return void 0;
	const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	if (Number.isNaN(utcMidnight)) return void 0;
	return {
		start: utcMidnight - BEIJING_OFFSET_MS,
		end: utcMidnight + DAY_MS - BEIJING_OFFSET_MS
	};
}
//#endregion
//#region lib/types/spend.js
/**
* Spend arithmetic: how two spends combine, how one is inverted, and how the
* samples that could NOT be priced are tallied beside them. Pure, and knowing
* nothing about rates, timezones or event shapes — the pricing engine
* (`billing.ts`) owns all of that.
* @module @rayadesu/dsh-llm-billing/spend
*/
/** A spend with no priced usage. */
function emptyTodaySpend() {
	return {
		total: 0,
		models: []
	};
}
/** Sum two usage tallies (pure); an absent side stays absent. */
function mergeUsageTally(left, right) {
	if (left === void 0) return right;
	if (right === void 0) return left;
	return {
		events: left.events + right.events,
		tokens: left.tokens + right.tokens,
		models: [.../* @__PURE__ */ new Set([...left.models, ...right.models])]
	};
}
/** Add one affected sample to a tally (pure). */
function addUsageTally(previous, model, tokens) {
	const models = previous?.models ?? [];
	return {
		events: (previous?.events ?? 0) + 1,
		tokens: (previous?.tokens ?? 0) + tokens,
		models: models.includes(model) ? models : [...models, model]
	};
}
/**
* The advisory tallies carried BESIDE the priced rows, summed over `spends` as
* a partial you can spread into any spend literal. Keys stay absent rather
* than becoming `undefined` (`exactOptionalPropertyTypes`), so a fully priced
* spend stays structurally identical to what every existing test asserts.
*/
function usageTalliesOf(spends) {
	let unpriced;
	for (const spend of spends) unpriced = mergeUsageTally(unpriced, spend.unpriced);
	return { ...unpriced === void 0 ? {} : { unpriced } };
}
/** Note one sample that matched no pricing row and was therefore not billed. */
function noteUnpriced(spend, model, tokens) {
	return {
		total: spend.total,
		models: spend.models,
		unpriced: addUsageTally(spend.unpriced, model, tokens)
	};
}
/** The today-spend shape of a single priced contribution. */
function contributionModel(priced) {
	return {
		model: priced.model,
		displayName: priced.displayName,
		cost: priced.cost,
		peakCost: priced.peakCost,
		offPeakCost: priced.offPeakCost,
		cacheHitInputTokens: priced.cacheHitInputTokens,
		cacheMissInputTokens: priced.cacheMissInputTokens,
		outputTokens: priced.outputTokens,
		cacheHitInputCost: priced.cacheHitInputCost,
		cacheMissInputCost: priced.cacheMissInputCost,
		outputCost: priced.outputCost
	};
}
/** Sum two model rows of the same model (pure). */
function mergeModelRows(left, right) {
	return {
		model: left.model,
		displayName: left.displayName,
		cost: left.cost + right.cost,
		peakCost: left.peakCost + right.peakCost,
		offPeakCost: left.offPeakCost + right.offPeakCost,
		cacheHitInputTokens: left.cacheHitInputTokens + right.cacheHitInputTokens,
		cacheMissInputTokens: left.cacheMissInputTokens + right.cacheMissInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheHitInputCost: left.cacheHitInputCost + right.cacheHitInputCost,
		cacheMissInputCost: left.cacheMissInputCost + right.cacheMissInputCost,
		outputCost: left.outputCost + right.outputCost
	};
}
/**
* Mutable model-row accumulator behind every spend fold. Rows keep first-seen
* model order — the same shape a pure `addEventContribution` chain produces —
* so the single-pass scan path and the pure public paths cannot diverge. One
* `Map` lookup per contribution instead of a per-event array copy: the huge
* event-log folds allocate one row object per model, not one intermediate
* array per event.
*/
var SpendAccumulator = class {
	rows = /* @__PURE__ */ new Map();
	total = 0;
	/** Add one priced contribution. */
	add(priced) {
		const row = contributionModel(priced);
		const existing = this.rows.get(priced.model);
		this.rows.set(priced.model, existing === void 0 ? row : mergeModelRows(existing, row));
		this.total += priced.cost;
	}
	/** The folded spend; the accumulator stays usable afterwards. */
	finish() {
		return {
			total: this.total,
			models: [...this.rows.values()]
		};
	}
};
/** The additive inverse of one spend (pure): used to replace a priced sample. */
function negateSpend(spend) {
	const negate = (value) => -value;
	return {
		total: negate(spend.total),
		...usageTalliesOf([spend]),
		models: spend.models.map((row) => ({
			...row,
			cost: negate(row.cost),
			peakCost: negate(row.peakCost),
			offPeakCost: negate(row.offPeakCost),
			cacheHitInputTokens: negate(row.cacheHitInputTokens),
			cacheMissInputTokens: negate(row.cacheMissInputTokens),
			outputTokens: negate(row.outputTokens),
			cacheHitInputCost: negate(row.cacheHitInputCost),
			cacheMissInputCost: negate(row.cacheMissInputCost),
			outputCost: negate(row.outputCost)
		}))
	};
}
/**
* Subtract one spend from another (pure). Rows that cancel out completely are
* dropped so a replaced sample leaves no zero row behind.
* @param target - the spend to subtract from.
* @param source - the spend to remove.
* @returns the difference.
*/
function subtractSpend(target, source) {
	const rows = /* @__PURE__ */ new Map();
	for (const row of target.models) rows.set(row.model, row);
	for (const row of source.models) {
		const existing = rows.get(row.model);
		if (existing === void 0) continue;
		const next = mergeModelRows(existing, negateSpend({
			total: 0,
			models: [row]
		}).models[0]);
		if (next.cost === 0 && next.cacheHitInputTokens === 0 && next.cacheMissInputTokens === 0 && next.outputTokens === 0) rows.delete(row.model);
		else rows.set(row.model, next);
	}
	return {
		total: target.total - source.total,
		models: [...rows.values()],
		...usageTalliesOf([target])
	};
}
/** The contribution as a one-row spend (the shape a sample keeps for replacement). */
function contributionSpend(priced) {
	return {
		total: priced.cost,
		models: [contributionModel(priced)]
	};
}
/**
* Merge one priced event's contribution into an accumulator spend (pure:
* returns a new spend, never mutates its input).
* @param spend - the accumulator (per session and day, or across sessions).
* @param priced - the priced contribution to add.
* @returns the merged spend.
*/
function addEventContribution(spend, priced) {
	const row = contributionModel(priced);
	const rows = spend.models.map((existing) => existing.model === priced.model ? mergeModelRows(existing, row) : existing);
	if (!rows.some((existing) => existing.model === priced.model)) rows.push(row);
	return {
		total: spend.total + priced.cost,
		models: rows,
		...usageTalliesOf([spend])
	};
}
/**
* Sum two spends (per session and day, or across sessions) into one (pure:
* returns a new spend, never mutates its inputs).
* @param target - the accumulator spend.
* @param source - the spend to add.
* @returns the summed spend.
*/
function mergeTodaySpend(target, source) {
	const rows = /* @__PURE__ */ new Map();
	for (const row of target.models) rows.set(row.model, row);
	for (const row of source.models) {
		const existing = rows.get(row.model);
		rows.set(row.model, existing === void 0 ? row : mergeModelRows(existing, row));
	}
	return {
		total: target.total + source.total,
		models: [...rows.values()],
		...usageTalliesOf([target, source])
	};
}
//#endregion
//#region lib/types/pricing-table.js
/**
* The published rate schedule: which models cost what, and since when.
*
* Data only — every policy decision about how a rate is chosen (revision
* lookup, peak windows, day boundaries) lives in `billing.ts`. Keeping them
* apart means adding a model never touches the pricing engine: the change is
* one row here, plus a test.
*
* Rates are CNY per 1M tokens. Rows sharing a model are that model's rate
* history (see {@link resolveBilling}).
* @module @rayadesu/dsh-llm-billing/pricing-table
*/
/**
* Published peak-hour windows (Beijing time): 09:00–12:00 and 14:00–18:00,
* applied on weekdays (Monday–Friday) only — weekends are always off-peak
* (effective 2026-08-23).
*/
const DEFAULT_PEAK_HOURS = [{
	start: 9,
	end: 12
}, {
	start: 14,
	end: 18
}];
/**
* Inclusive epoch ms of the published V4 Flash series re-pricing:
* 2026-09-10 12:00 Beijing time (UTC+8, no DST) = 04:00 UTC. Samples before
* this instant keep the base rates; samples at or after it bill at the second
* revision.
*/
const FLASH_SERIES_RATE_CHANGE_AT = Date.UTC(2026, 8, 10, 4, 0, 0);
/**
* Inclusive epoch ms of the announced V4 Pro route switch: 2026-09-14 12:00
* Beijing time (UTC+8, no DST) = 04:00 UTC. From that instant the V4 Pro route
* is served by V4.1 Flash and billed at the V4.1 Flash rates.
*/
const V4_PRO_ROUTE_SWITCH_AT = Date.UTC(2026, 8, 14, 4, 0, 0);
/** The V4 Flash series' base rates (effective 2026-08-17), CNY per 1M tokens. */
const FLASH_BASE_RATES = {
	peak: {
		cacheHitInput: .1,
		cacheMissInput: 3,
		output: 9
	},
	offPeak: {
		cacheHitInput: .05,
		cacheMissInput: 1.5,
		output: 4.5
	}
};
/**
* The V4 Flash series' second revision (effective
* {@link FLASH_SERIES_RATE_CHANGE_AT}): off-peak 0.02 / 1.0 / 4.0, peak at
* twice those prices.
*/
const FLASH_REPRICED_RATES = {
	effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT,
	peak: {
		cacheHitInput: .04,
		cacheMissInput: 2,
		output: 8
	},
	offPeak: {
		cacheHitInput: .02,
		cacheMissInput: 1,
		output: 4
	}
};
/**
* The V4.1 Flash rates as they reach the retired V4 Pro route from
* {@link V4_PRO_ROUTE_SWITCH_AT}: the same price pair as the flash series'
* second revision, carried at its own effective instant.
*/
const V4_PRO_SWITCHED_RATES = {
	effectiveFrom: V4_PRO_ROUTE_SWITCH_AT,
	peak: FLASH_REPRICED_RATES.peak,
	offPeak: FLASH_REPRICED_RATES.offPeak
};
/**
* Official peak/off-peak rates (CNY per 1M tokens) per model, as dated
* revisions. Base rows are the schedule effective 2026-08-17; the V4 Flash
* series (V4.1 Flash, V4 Flash, V4 Flash Vision Exp) carries the second
* revision effective 2026-09-10 12:00 Beijing, and the V4 Pro row the V4.1
* Flash rates from its announced route switch (2026-09-14 12:00 Beijing) —
* the MiMo series (V2.5, and V2.6 which kept V2.5's pricing) is untouched by
* either adjustment. Rows sharing a model are that model's rate history.
*/
const DEFAULT_MODEL_PRICING = [
	{
		model: "deepseek-flash",
		...FLASH_BASE_RATES
	},
	{
		model: "deepseek-flash",
		...FLASH_REPRICED_RATES
	},
	{
		model: "deepseek-v4-flash",
		...FLASH_BASE_RATES
	},
	{
		model: "deepseek-v4-flash",
		...FLASH_REPRICED_RATES
	},
	{
		model: "deepseek-v4.1-flash-expires-on-0910",
		...FLASH_BASE_RATES
	},
	{
		model: "deepseek-v4.1-flash-expires-on-0910",
		...FLASH_REPRICED_RATES
	},
	{
		model: "deepseek-v4-pro",
		peak: {
			cacheHitInput: .3,
			cacheMissInput: 9,
			output: 27
		},
		offPeak: {
			cacheHitInput: .15,
			cacheMissInput: 4.5,
			output: 13.5
		}
	},
	{
		model: "deepseek-v4-pro",
		...V4_PRO_SWITCHED_RATES
	},
	{
		model: "deepseek-v4-flash-vision-exp",
		...FLASH_BASE_RATES
	},
	{
		model: "deepseek-v4-flash-vision-exp",
		...FLASH_REPRICED_RATES
	},
	{
		model: "mimo-v2.5-pro",
		peak: {
			cacheHitInput: .025,
			cacheMissInput: 3,
			output: 6
		},
		offPeak: {
			cacheHitInput: .025,
			cacheMissInput: 3,
			output: 6
		}
	},
	{
		model: "mimo-v2.5",
		peak: {
			cacheHitInput: .02,
			cacheMissInput: 1,
			output: 2
		},
		offPeak: {
			cacheHitInput: .02,
			cacheMissInput: 1,
			output: 2
		}
	},
	{
		model: "mimo-v2.6-pro",
		peak: {
			cacheHitInput: .025,
			cacheMissInput: 3,
			output: 6
		},
		offPeak: {
			cacheHitInput: .025,
			cacheMissInput: 3,
			output: 6
		}
	},
	{
		model: "mimo-v2.6-flash",
		peak: {
			cacheHitInput: .02,
			cacheMissInput: 1,
			output: 2
		},
		offPeak: {
			cacheHitInput: .02,
			cacheMissInput: 1,
			output: 2
		}
	}
];
//#endregion
//#region lib/types/pricing.js
/**
* DeepSeek pricing: the peak/off-peak pricing table, the per-event pricing, and
* the resolved-billing shape. Pure functions over token usage and the pricing
* table, so the Remote gateway stays transport-free and the whole spend is
* testable without a key.
*
* The per-event pricing lives in {@link priceEvent} / {@link priceUsage}; the
* fold state machine that consumes it (`BillingFolder` / {@link applyBillingEvent})
* lives in `fold.ts`, and every scan path prices through these primitives so a
* pricing-table change cannot drift one path from the others.
* @module @rayadesu/dsh-llm-billing/pricing
*/
/**
* Resolve optional configuration to a pricing table, defaulting omitted or
* empty rows to the published rates. Schemastery materializes an absent
* `z.array` as `[]` rather than `undefined`, so emptiness — not just absence —
* selects the defaults. Explicit non-empty rows override the same model; a
* supplied non-empty `models` list is authoritative.
*
* Rows sharing a model are that model's rate revisions, kept in ascending
* `effectiveFrom` order (an undated base revision first). Two rows declaring
* the same effective instant are one revision and the later row wins — the
* historical override rule — so re-declaring a model can neither duplicate a
* revision nor install a second undated base.
* @param config - optional raw billing configuration.
* @returns the resolved table (per model: its revisions plus the newest rates) and peak-hour windows.
*/
function resolveBilling(config) {
	const peakHours = config?.peakHours !== void 0 && config.peakHours.length > 0 ? config.peakHours : DEFAULT_PEAK_HOURS;
	const rows = config?.models !== void 0 && config.models.length > 0 ? config.models : DEFAULT_MODEL_PRICING;
	const schedules = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const revision = row.effectiveFrom === void 0 ? {
			peak: row.peak,
			offPeak: row.offPeak
		} : {
			effectiveFrom: row.effectiveFrom,
			peak: row.peak,
			offPeak: row.offPeak
		};
		const revisions = schedules.get(row.model);
		if (revisions === void 0) {
			schedules.set(row.model, [revision]);
			continue;
		}
		const duplicate = revisions.findIndex((candidate) => candidate.effectiveFrom === revision.effectiveFrom);
		if (duplicate >= 0) revisions[duplicate] = revision;
		else revisions.push(revision);
	}
	const models = /* @__PURE__ */ new Map();
	for (const [model, revisions] of schedules) {
		revisions.sort((left, right) => (left.effectiveFrom ?? Number.NEGATIVE_INFINITY) - (right.effectiveFrom ?? Number.NEGATIVE_INFINITY));
		const newest = revisions[revisions.length - 1];
		models.set(model, {
			peak: newest.peak,
			offPeak: newest.offPeak,
			revisions
		});
	}
	return {
		peakHours,
		models
	};
}
/**
* The rate revision in effect at one instant: the newest revision that took
* effect at or before it. Revisions are ascending, so the scan stops at the
* first future one. An instant before the earliest dated revision bills at that
* earliest revision — a model with only dated rows is never left unpriced.
*/
function ratesAt(revisions, time) {
	let chosen = revisions[0];
	for (let index = 1; index < revisions.length; index += 1) {
		const revision = revisions[index];
		if (revision.effectiveFrom === void 0 || revision.effectiveFrom > time) break;
		chosen = revision;
	}
	return chosen;
}
/** Whether a Beijing (hour, weekday) pair falls inside any peak-hour window. */
function isPeakParts(billing, hour, weekday) {
	if (weekday === 0 || weekday === 6) return false;
	return billing.peakHours.some(({ start, end }) => hour >= start && hour < end);
}
/**
* Whether a timestamp falls inside any peak-hour window (Beijing time,
* weekdays Monday–Friday only). Weekends (Saturday and Sunday) are always
* off-peak, matching the published peak-hours rule.
* @param billing - resolved pricing with peak-hour windows.
* @param now - the moment to classify.
* @returns true during a weekday peak hour.
*/
function isPeak(billing, now) {
	const { hour, weekday } = beijingPartsOf(now.getTime());
	return isPeakParts(billing, hour, weekday);
}
/**
* Price one event at the official per-model rates, applying the peak/off-peak
* table by its Beijing-time hour and weekday (peak windows apply Monday–Friday
* only; weekends are off-peak) and the rate revision in effect at its own
* timestamp. Each `assistant/message` event with usage
* contributes cache-hit input, cache-miss input (uncached input plus cache
* writes), and output (reasoning included) tokens at the rate of its own
* timestamp; a model with usage but no pricing row contributes nothing.
* @param event - the event to price.
* @param billing - resolved pricing with peak-hour windows.
* @param names - model id → display label.
* @returns the priced contribution, or `undefined` when the event has no priced usage.
*/
function priceEvent(event, billing, names) {
	return priceEventAt(beijingPartsOf(event.time), event, billing, names);
}
/**
* Price one event at the official per-model rates using a precomputed
* Beijing-time view — the day-filtering and pricing of one event share a
* single timezone parse (see {@link beijingPartsOf}). Semantics are identical
* to {@link priceEvent}.
* @param parts - the event's Beijing-time view.
* @param event - the event to price.
* @param billing - resolved pricing with peak-hour windows.
* @param names - model id → display label.
* @returns the priced contribution, or `undefined` when the event has no priced usage.
*/
function priceEventAt(parts, event, billing, names) {
	if (event.type !== "assistant/message") return void 0;
	const reported = event.data.usage;
	if (reported === void 0) return void 0;
	return priceUsage(parts, reported, event.data.message.source.model, billing, names);
}
/** Every token one usage sample reports, whether or not it gets priced. */
function usageTokens(usage) {
	return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** Max distinct model ids remembered for the once-only warning. */
const UNPRICED_WARN_LIMIT = 64;
/** Model ids already reported, so a long-running host logs each one once. */
const reportedUnpricedModels = /* @__PURE__ */ new Set();
/**
* Report a model carrying no rate row, at most once per id (and at most
* {@link UNPRICED_WARN_LIMIT} ids per process). Every figure reads as zero when
* the upstream model is unknown, which looks exactly like "no usage" rather
* than a missing row — the one thing this warning exists to separate.
*
* Deliberately NOT guessed: model ids are chosen by whoever ships the model, so
* a similar-looking name says nothing about a similar price — and a wrong number
* that LOOKS authoritative is worse than a visible gap. The fix is one row under
* `billing.models`, which is exactly what the warning points at.
* @param model - the unlisted wire model id.
*/
function reportUnpricedModel(model) {
	if (reportedUnpricedModels.has(model) || reportedUnpricedModels.size >= UNPRICED_WARN_LIMIT) return;
	reportedUnpricedModels.add(model);
	console.warn(`[llm-billing] no pricing row for model "${model}" — its usage is NOT billed; add its row under billing.models to price it`);
}
/**
* Price one provider-reported usage sample for one model at the rates of the
* sample's own Beijing-time hour and weekday — the peak or off-peak price of
* the rate revision in effect at the sample's own timestamp (a re-priced series
* bills its history at the rates that applied then). `undefined` when the model
* has no pricing row.
* @param parts - the sample's Beijing-time view.
* @param usage - the reported token buckets.
* @param model - the wire model id the sample belongs to.
* @param billing - resolved pricing with peak-hour windows.
* @param names - model id → display label.
* @returns the priced contribution, or `undefined` when the model has no rate row.
*/
function priceUsage(parts, usage, model, billing, names) {
	const pricing = billing.models.get(model);
	if (pricing === void 0) return void 0;
	const peak = isPeakParts(billing, parts.hour, parts.weekday);
	const revision = ratesAt(pricing.revisions, parts.time);
	const price = peak ? revision.peak : revision.offPeak;
	const hit = usage.cacheReadTokens ?? 0;
	const miss = usage.inputTokens + (usage.cacheWriteTokens ?? 0);
	const output = usage.outputTokens;
	const hitCost = hit * price.cacheHitInput / 1e6;
	const missCost = miss * price.cacheMissInput / 1e6;
	const outputCost = output * price.output / 1e6;
	const cost = hitCost + missCost + outputCost;
	return {
		dayKey: parts.dayKey,
		model,
		displayName: names.get(model) ?? model,
		cost,
		peakCost: peak ? cost : 0,
		offPeakCost: peak ? 0 : cost,
		cacheHitInputTokens: hit,
		cacheMissInputTokens: miss,
		outputTokens: output,
		cacheHitInputCost: hitCost,
		cacheMissInputCost: missCost,
		outputCost
	};
}
//#endregion
//#region lib/types/fold.js
/**
* The single-pass fold state machine that turns a committed event log into a
* session's billed spend. Consumes the pricing primitives in `pricing.ts`
* (`priceUsage` / `reportUnpricedModel`) and the spend algebra in `spend.ts`
* (`addEventContribution` / `subtractSpend` / `noteUnpriced` / `emptyTodaySpend`);
* every scan path prices through {@link applyBillingEvent} so a pricing-table
* change cannot drift one path from the others.
* @module @rayadesu/dsh-llm-billing/fold
*/
/** The empty fold state for one fork boundary. */
function emptyBillingFoldState(inheritedEventCount = 0) {
	return {
		dayKey: "",
		spend: emptyTodaySpend(),
		session: emptyTodaySpend(),
		inheritedEventCount,
		model: "",
		last: null
	};
}
/** Whether an unknown value looks like a provider usage report. */
function isTokenUsage(value) {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value;
	return typeof candidate.inputTokens === "number" && typeof candidate.outputTokens === "number";
}
/**
* The last `usage` sample embedded in an event's stream, if any. `assistant/
* attempt` and the embedded streams are newer than the plugin's npm baseline,
* so the stream is read structurally (a failed/retried attempt reports its
* usage only there).
*/
function streamUsageOf(event) {
	const stream = event.data === void 0 ? void 0 : event.data.stream;
	if (!Array.isArray(stream)) return void 0;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const chunk = stream[index]?.chunk;
		if (chunk === void 0 || chunk.type !== "usage") continue;
		return isTokenUsage(chunk.usage) ? chunk.usage : void 0;
	}
}
/**
* Fold one committed event into a session's billed-spend state.
*
* Priced samples come from `assistant/message` (its own reported usage, or the
* stream's last usage chunk) and `assistant/attempt` (the stream's last usage
* chunk, priced with the model of the latest `request/header`, since an
* attempt carries no route). A sample for the same `(turn, step)` replaces the
* previous one; `llm/retry-started` closes the replacement slot so a retried
* attempt adds. Every other event is inert and returns the same state
* reference.
* @param state - the previous fold state.
* @param event - the committed event.
* @param billing - resolved pricing with peak-hour windows.
* @param names - model id → display label.
* @returns the next state (the same reference when nothing was priced).
*/
function applyBillingEvent(state, event, billing, names) {
	if (event.seq < state.inheritedEventCount) return state;
	const type = event.type;
	if (type === "request/header") {
		const model = event.data?.header?.config?.model;
		return typeof model === "string" && model.length > 0 && model !== state.model ? {
			...state,
			model
		} : state;
	}
	const data = event.data;
	if (type === "llm/retry-started") {
		if (typeof data?.turn !== "number" || typeof data.step !== "number") return state;
		const last = state.last;
		if (last === null || last.turn !== data.turn || last.step !== data.step) return state;
		return {
			...state,
			last: null
		};
	}
	if (type !== "assistant/message" && type !== "assistant/attempt") return state;
	const usage = (type === "assistant/message" ? data?.usage : void 0) ?? streamUsageOf(event);
	if (!isTokenUsage(usage)) return state;
	const model = type === "assistant/message" ? data?.message?.source?.model : state.model;
	if (typeof model !== "string" || model.length === 0) return state;
	const parts = beijingPartsOf(event.time);
	if (billing.models.get(model) === void 0) {
		reportUnpricedModel(model);
		const tokens = usageTokens(usage);
		const opens = state.dayKey === "" || parts.dayKey > state.dayKey;
		const sameDay = parts.dayKey === state.dayKey;
		return {
			...state,
			dayKey: opens ? parts.dayKey : state.dayKey,
			spend: opens ? noteUnpriced(emptyTodaySpend(), model, tokens) : sameDay ? noteUnpriced(state.spend, model, tokens) : state.spend,
			session: noteUnpriced(state.session, model, tokens)
		};
	}
	const priced = priceUsage(parts, usage, model, billing, names);
	if (priced === void 0) return state;
	let session = state.session;
	let spend = state.spend;
	let dayKey = state.dayKey;
	const last = state.last;
	const turn = typeof data?.turn === "number" ? data.turn : 0;
	const step = typeof data?.step === "number" ? data.step : 0;
	if (last !== null && last.turn === turn && last.step === step) {
		session = subtractSpend(session, last.spend);
		if (last.dayKey === dayKey) spend = subtractSpend(spend, last.spend);
	}
	session = addEventContribution(session, priced);
	if (dayKey === priced.dayKey) spend = addEventContribution(spend, priced);
	else if (dayKey === "" || priced.dayKey > dayKey) {
		dayKey = priced.dayKey;
		spend = addEventContribution(emptyTodaySpend(), priced);
	}
	return {
		...state,
		dayKey,
		spend,
		session,
		last: {
			turn,
			step,
			dayKey: priced.dayKey,
			spend: contributionSpend(priced)
		}
	};
}
/**
* Mutable wrapper over {@link applyBillingEvent} for the pure pricing paths:
* feed events in order, read the folded spend.
*/
var BillingFolder = class {
	billing;
	state;
	/**
	* @param billing - resolved pricing with peak-hour windows.
	* @param catalog - model display rows, in presentation order.
	* @param inheritedEventCount - fork boundary to skip (default 0).
	*/
	constructor(billing, catalog, inheritedEventCount = 0) {
		this.billing = billing;
		this.names = new Map(catalog.map((model) => [model.id, model.name]));
		this.state = emptyBillingFoldState(inheritedEventCount);
	}
	names;
	/** Fold one event. */
	add(event) {
		this.state = applyBillingEvent(this.state, event, this.billing, this.names);
	}
	/** Fold every event, in order. */
	addAll(events) {
		for (const event of events) this.add(event);
	}
	/** The folded state (live reference; do not mutate). */
	get fold() {
		return this.state;
	}
};
//#endregion
//#region lib/types/billing.js
/**
* DeepSeek billing aggregation: the session/turn/today spend computations
* over the pricing engine (`pricing.ts`) and the per-event fold state machine
* (`fold.ts`). Pure functions over session events, so the whole spend is
* testable without a key and the Remote gateway stays transport-free.
*
* The fold in {@link BillingFolder} / {@link applyBillingEvent} (see `fold.ts`)
* and the per-event pricing in `pricing.ts` are the single source of truth the
* events-scan paths, the session-projection unit, and the scanner all price
* through, so a pricing-table change cannot drift one path from the others.
* @module @rayadesu/dsh-llm-billing/billing
*/
/**
* The durable inherited-prefix boundary of one session: the number of leading
* events it inherited verbatim from its fork source, 0 for a session created
* without a seed. A forked session (or any seeded replay) carries that count
* in its session state; every event with `seq < seedLength` is a copy of an
* event already billed in that source session, so pricing must skip them or
* the same model output is counted once per copy. Accepts the durable field
* of the live-session and handle surfaces (see {@link ForkBoundarySource}).
* @param source - the session, header slice, or opened handle carrying the
*   boundary; `undefined` reads as 0.
* @returns the inherited-prefix length; 0 for an unseeded session.
*/
function forkBoundaryOf(source) {
	if (source === void 0) return 0;
	const inherited = source.inheritedEventCount;
	if (inherited !== void 0 && Number.isSafeInteger(inherited)) return inherited;
	return source.header?.seedLength ?? source.seedLength ?? 0;
}
/** Whether a durable header marks a fork-inherited (seeded) session across the live-session and handle surfaces. */
function isSeededSession(header) {
	if (header === void 0) return false;
	if (header.isSeeded === true) return true;
	return (header.seedLength ?? 0) > 0;
}
/**
* Price one session's complete event log at the official per-model rates,
* with DSH's attempt semantics: every provider-reported sample (an
* `assistant/message`'s usage, or an `assistant/attempt`'s stream usage)
* contributes, a later sample for the same `(turn, step)` replaces the earlier
* one, and `llm/retry-started` makes the retried attempt add.
* @param events - one session's complete event log.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @param startSeq - when provided, only events with `seq >= startSeq`
*   contribute: a forked session's inherited prefix (see {@link forkBoundaryOf})
*   is skipped, so each model output is billed only in the session that
*   produced it.
* @returns the session's total cost plus one row per priced model.
*/
function computeSessionSpend(events, billing, catalog, startSeq = 0) {
	const folder = new BillingFolder(billing, catalog, startSeq);
	folder.addAll(events);
	return folder.fold.session;
}
/**
* Price one completed Turn's billed usage, identified by its closing
* assistant message id. The turn's events are those between its `turn/start`
* and `turn/end` (both matched by the message's own turn coordinate), priced
* with the same attempt semantics as {@link computeSessionSpend}. A message
* that cannot be located, a turn without bracketing `turn/start` / `turn/end`
* events (for example after compaction), or a session with no priced usage
* prices to zero.
* @param events - one session's complete event log.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @param messageId - the closing assistant message's durable id.
* @returns the turn's total cost in CNY.
*/
function computeTurnSpend(events, billing, catalog, messageId) {
	return { total: turnCostOf(events, billing, catalog, messageId) };
}
/**
* The total cost of the Turn containing `messageId`, folded with the shared
* attempt semantics (see {@link applyBillingEvent}).
* @param events - one session's complete event log.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @param messageId - one assistant message inside the Turn.
* @returns the Turn's total cost in CNY, or 0 when the Turn cannot be located.
*/
function turnCostOf(events, billing, catalog, messageId) {
	let turn;
	for (const event of events) {
		if (event.type !== "assistant/message") continue;
		if (event.data.message.id !== messageId) continue;
		turn = event.data.turn;
		break;
	}
	if (turn === void 0) return 0;
	const folder = new BillingFolder(billing, catalog);
	let active = false;
	for (const event of events) {
		if (event.type === "turn/start" && event.data.turn === turn) {
			active = true;
			continue;
		}
		if (event.type === "turn/end" && event.data.turn === turn) break;
		if (!active) continue;
		folder.add(event);
	}
	return folder.fold.session.total;
}
/**
* Incremental single-pass fold of one session's completed-Turn costs, keyed by
* the id of every assistant message inside each Turn. Feeding the fold only
* the appended tail keeps a growing session's map current in O(new events)
* instead of re-scanning the whole log per message.
*
* Semantics are exactly {@link computeTurnSpend}'s: a Turn is the
* `turn/start`..`turn/end` range (matched by the event's own turn coordinate),
* every priced event inside it contributes at its own timestamp's rate, and a
* message outside any bracket contributes nothing.
*/
var SessionTurnSpendFolder = class {
	billing;
	catalog;
	rows = [];
	ids = [];
	/** Events of the open Turn, folded with the shared attempt semantics on close. */
	events = [];
	open = false;
	/** Events already fed; a shorter log resets the fold. */
	cursor = 0;
	/**
	* @param billing - resolved pricing with peak-hour windows.
	* @param catalog - model display rows, in presentation order.
	*/
	constructor(billing, catalog) {
		this.billing = billing;
		this.catalog = catalog;
	}
	/** How many events have been folded so far (the host's incremental cursor). */
	get processed() {
		return this.cursor;
	}
	/**
	* Fold every event from the cursor to the end of the log. A log shorter than
	* the cursor (rewritten session) restarts the fold from an empty state.
	* @param events - the session's complete event log, in seq order.
	*/
	feed(events) {
		if (events.length < this.cursor) this.reset();
		for (let index = this.cursor; index < events.length; index += 1) {
			const event = events[index];
			if (event.type === "turn/start") {
				this.open = true;
				this.ids = [];
				this.events = [];
				continue;
			}
			if (event.type === "turn/end") {
				if (this.open) {
					const folder = new BillingFolder(this.billing, this.catalog);
					folder.addAll(this.events);
					const total = folder.fold.session.total;
					for (const messageId of this.ids) this.rows.push({
						messageId,
						total
					});
				}
				this.open = false;
				this.ids = [];
				this.events = [];
				continue;
			}
			if (!this.open) continue;
			if (event.type === "assistant/message") this.ids.push(event.data.message.id);
			this.events.push(event);
		}
		this.cursor = events.length;
	}
	/** The folded map; the fold stays usable afterwards. */
	finish() {
		return { turns: [...this.rows] };
	}
	/** Drop the fold state so the next feed starts from the log's beginning. */
	reset() {
		this.rows.length = 0;
		this.ids = [];
		this.events = [];
		this.open = false;
		this.cursor = 0;
	}
};
/**
* Price every completed Turn of one session in a single pass (the pure
* equivalent of {@link SessionTurnSpendFolder}).
* @param events - one session's complete event log.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @returns one row per assistant message inside a completed Turn, in log order.
*/
function computeSessionTurnSpends(events, billing, catalog) {
	const folder = new SessionTurnSpendFolder(billing, catalog);
	folder.feed(events);
	return folder.finish();
}
/**
* Price one session's log for the Beijing-time calendar day of `now`. Events
* after the reference day are ignored; the fold's latest-day state then
* answers the query exactly (empty when the session's latest priced day is not
* the reference day). Pricing follows {@link applyBillingEvent} (attempt
* samples with same-step replacement).
*
* The fold's `(turn, step)` replacement slot is per session, so callers must
* pass ONE session's log; aggregate across sessions with
* {@link mergeTodaySpend}.
* @param events - one session's complete event log.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @param now - the reference moment whose Beijing-time calendar day is "today".
* @returns today's total cost plus one row per priced model.
*/
function computeTodaySpend(events, billing, catalog, now = /* @__PURE__ */ new Date()) {
	const day = beijingDayKey(now);
	const dayEnd = beijingDayRangeOfKey(day)?.end ?? Number.POSITIVE_INFINITY;
	const folder = new BillingFolder(billing, catalog);
	for (const event of events) {
		if (event.time >= dayEnd) continue;
		folder.add(event);
	}
	return folder.fold.dayKey === day ? folder.fold.spend : emptyTodaySpend();
}
//#endregion
//#region lib/types/projection.js
/**
* `billingTodaySpend` session-projection unit: per-session billed spend,
* folded eagerly by the DSH projection drive over committed session events and
* checkpointed by the projection cache. The state keeps the session's LATEST
* priced Beijing day, its whole-session total, the fork boundary, the latest
* request model, and the last priced attempt sample (DSH's same-step
* replacement rule); the aggregate "today" read sums the units whose `dayKey`
* matches the current Beijing day — zero full-log scans once the fold is warm.
*
* The unit's fold IS the shared pricing fold ({@link applyBillingEvent}), so
* the projection path and the events-scan paths cannot drift. The unit is
* client-visible (`wire` = identity) because the persisted-cache read ladder
* (`sessionProjectionCache.cachedSnapshot` / registry `restore`) serves only
* wired units, and because the browser half reads this value through
* `useProjection` instead of polling a Remote; the wire value is the state
* itself.
* @module @rayadesu/dsh-llm-billing/projection
*/
/** The projection key this unit owns. */
const BILLING_UNIT_KEY = "billingTodaySpend";
const modelRowSchema = z$1.object({
	model: z$1.string(),
	displayName: z$1.string(),
	cost: z$1.number().nonnegative(),
	peakCost: z$1.number().nonnegative(),
	offPeakCost: z$1.number().nonnegative(),
	cacheHitInputTokens: z$1.number().int().nonnegative(),
	cacheMissInputTokens: z$1.number().int().nonnegative(),
	outputTokens: z$1.number().int().nonnegative(),
	cacheHitInputCost: z$1.number().nonnegative(),
	cacheMissInputCost: z$1.number().nonnegative(),
	outputCost: z$1.number().nonnegative()
}).strict();
/**
* The advisory tally of usage that could not be billed at its own rate (see
* `DeepSeekTodaySpend.unpriced`). Declared here because the
* unit's schemas are `.strict()`: an undeclared key REJECTS the whole unit
* rather than being stripped, so adding these fields to the fold without
* declaring them here would fail every projection fold the moment a sample
* went unpriced.
*/
const usageTallySchema = z$1.object({
	events: z$1.number().int().nonnegative(),
	tokens: z$1.number().int().nonnegative(),
	models: z$1.array(z$1.string())
}).strict();
const todaySpendSchema = z$1.object({
	total: z$1.number().nonnegative(),
	models: z$1.array(modelRowSchema),
	unpriced: usageTallySchema.optional()
}).strict();
const billingUnitSchema = z$1.object({
	dayKey: z$1.string(),
	spend: todaySpendSchema,
	session: todaySpendSchema,
	inheritedEventCount: z$1.number().int().nonnegative(),
	model: z$1.string(),
	last: z$1.object({
		turn: z$1.number().int().nonnegative(),
		step: z$1.number().int().nonnegative(),
		dayKey: z$1.string(),
		spend: todaySpendSchema
	}).strict().nullable()
}).strict();
/**
* Build the `billingTodaySpend` unit for one resolved pricing table. Published
* rate revisions travel inside the closure and are resolved per sample
* timestamp, so a re-priced series bills its own history correctly however late
* a log is folded; only a configuration change (editing `billing.models`) is
* fixed at registration, and it re-prices just the events folded afterwards
* (the events-scan paths re-price the whole log). Bump
* {@link ProjectionDefinition.stateVersion} whenever the state shape or fold
* semantics change, so persisted checkpoint rows are discarded instead of
* folded forward.
* @param billing - resolved pricing with peak-hour windows.
* @param catalog - model display rows, in presentation order.
* @returns the unit definition to register on `ctx.sessionProjections`.
*/
function billingTodaySpendDefinition(billing, catalog) {
	const names = new Map(catalog.map((model) => [model.id, model.name]));
	return {
		key: BILLING_UNIT_KEY,
		stateVersion: 4,
		stateSchema: billingUnitSchema,
		init: (_header, inheritedEventCount) => emptyBillingFoldState(Number(inheritedEventCount ?? 0)),
		apply: (state, event) => applyBillingEvent(state, event, billing, names),
		wire: {
			viewSchema: billingUnitSchema,
			view: (state) => state
		}
	};
}
/** Fold a unit from init over one session's event log (the detached cold recipe). */
function foldBillingUnit(unit, events) {
	let state = unit.init();
	for (const event of events) state = unit.apply(state, event);
	return state;
}
/**
* Fold a unit from init over one session's OWN events only: the complete log
* minus its inherited fork prefix (`seq < seedLength`). A forked child's
* prefix is a verbatim copy of events already billed in its source session,
* so the detached cold recipe must skip it, or the same model output is
* priced once per copy.
* @param unit - the billing unit's fold halves.
* @param events - the session's complete event log (in seq order).
* @param seedLength - the durable inherited-prefix boundary
*   ({@link forkBoundaryOf}); 0 for an unseeded session.
* @returns the unit state folded over the session's own events.
*/
function foldOwnBilling(unit, events, seedLength = 0) {
	let state = unit.init();
	for (const event of events) {
		if (event.seq < seedLength) continue;
		state = unit.apply(state, event);
	}
	return state;
}
//#endregion
//#region lib/types/session-lineage.js
/**
* Session lineage and titles: which session delegated which, where a subtree's
* spend belongs, and the title a ranking row is labelled with. Split out of
* `today-spend.ts` because neither the cache nor the scan strategies care
* about lineage for their own sake — they only ask for it.
* @module @rayadesu/dsh-llm-billing/session-lineage
*/
function foldSessionTitle(events) {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event.type !== "session/title") continue;
		const data = event.data;
		return typeof data.title === "string" ? data.title : null;
	}
	return null;
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
function isSubagentSession(header) {
	if (header === void 0) return false;
	return header.origin === "subagent" || (header.delegationDepth ?? 0) > 0;
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
function topLevelSessionOf(id, lineage) {
	let current = id;
	const seen = /* @__PURE__ */ new Set([current]);
	for (;;) {
		const header = lineage.get(current);
		if (!isSubagentSession(header)) return current;
		const parent = header?.parentSession;
		if (parent === void 0 || seen.has(parent)) return current;
		seen.add(parent);
		current = parent;
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
function rollUpSubagentSpend(rows, lineage, titles = /* @__PURE__ */ new Map()) {
	const merged = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const target = topLevelSessionOf(row.sessionId, lineage);
		const carried = merged.get(target);
		if (carried === void 0) {
			merged.set(target, target === row.sessionId ? row : {
				sessionId: target,
				title: titles.get(target) ?? null,
				total: row.total,
				ownTotal: 0
			});
			continue;
		}
		merged.set(target, {
			...carried,
			total: carried.total + row.total
		});
	}
	return [...merged.values()].sort((left, right) => right.total - left.total);
}
/**
* Structural slice of a live session's header: the fork boundary of both DSH
* runtime families plus the delegation lineage the ranking roll-up reads.
*/
//#endregion
//#region lib/types/cache.js
/**
* The read-path cache: one 60-second Beijing-day window per process with
* in-flight coalescing and stale-while-revalidate, plus the bounded fan-out
* helper the cold scan parallelises with. Split out of `today-spend.ts` — it is
* the one piece that knows nothing about sessions at all.
* @module @rayadesu/dsh-llm-billing/cache
*/
/**
* Bounded parallel fan-out: run `run` over `items` with at most `limit` in
* flight. A shared index counter hands each worker its next job, so the
* dispatch is O(n) overall (array `shift()` would be O(n) per pop). The cold
* scan parallelises its session reads through this.
*/
async function withConcurrency(items, limit, run) {
	const total = items.length;
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, total) }, async () => {
		for (let job = next; job < total; job = next) {
			next += 1;
			await run(items[job]);
		}
	}));
}
/**
* Hand the host's event loop back between session folds.
*
* The folds are synchronous CPU work — the pricing fold and `foldSessionTitle`
* walk a whole log without an `await` — and they run on the same main loop that
* serves the GUI's own round trips (switching model, creating a session). A
* scan that never yields blocks those requests for its entire duration, which
* is exactly what a cold scan did. `setImmediate` schedules the continuation
* for the check phase, so the poll phase is served first: pending I/O — the
* GUI's requests among it — completes before the next slice of folding.
*/
function yieldToEventLoop() {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}
/**
* The A1 cache: one Beijing-day key + a 60s window, an in-flight promise that
* coalesces concurrent misses, a stale-while-revalidate path so a lapsed window
* never makes a plain reader wait on the day's scan, and a `force` bypass that
* makes a reader wait for a fresh scan instead. Cross-day invalidation is
* automatic (the day key changes, and the previous day's value is never
* served); a failed scan leaves the previous value in place and retries on the
* next call.
* @typeParam T - the cached aggregate's value shape (the spend or its
*   per-session breakdown).
*/
var TodaySpendCache = class {
	scan;
	ttlMs;
	now;
	cachedDayKey;
	cachedValue;
	cachedAt = 0;
	inFlight;
	/**
	* @param scan - the aggregate computation behind a miss.
	* @param ttlMs - time window in milliseconds (default 60 000).
	* @param now - clock source (injectable for tests).
	*/
	constructor(scan, ttlMs = 6e4, now = () => /* @__PURE__ */ new Date()) {
		this.scan = scan;
		this.ttlMs = ttlMs;
		this.now = now;
	}
	/**
	* Read today's spend, cached per Beijing day within the TTL window.
	*
	* Two reads share this entry point, and `force` is the switch between them —
	* its two values are exactly the two policies a caller can want, so there is
	* no third mode:
	*
	* - **plain (`force: false`)** — stale-while-revalidate. A value for the
	*   queried day is returned AT ONCE; once its window has lapsed the scan that
	*   refreshes it runs behind the answer. This is the read for everything the
	*   user did not just cause: a mount, a panel open, a poll, a session switch.
	* - **forced (`force: true`)** — recompute now and WAIT: both the window and
	*   the stale shortcut are bypassed. This is the read for a manual refresh and
	*   for a settled turn, which have just changed the answer and must not be
	*   handed the value from before they ran. A plain read there would report the
	*   day's pre-turn figure one turn late.
	*
	* A day with no value yet (the first read of the day, or a Beijing-day
	* rollover — yesterday's total is never served as today's) waits either way,
	* because there is nothing honest to show. A failed revalidation leaves the
	* previous value in place, and a pass already in flight is joined rather than
	* duplicated.
	* @param force - `true` recomputes now and waits; `false` serves the value on
	*   hand and refreshes behind it.
	* @returns today's spend.
	*/
	get(force = false) {
		const now = this.now();
		const dayKey = beijingDayKey(now);
		const cached = this.cachedDayKey === dayKey ? this.cachedValue : void 0;
		if (!force && cached !== void 0) {
			if (now.getTime() - this.cachedAt < this.ttlMs) return Promise.resolve(cached);
			if (this.inFlight === void 0) this.run(dayKey).catch(() => void 0);
			return Promise.resolve(cached);
		}
		if (this.inFlight !== void 0) return this.inFlight;
		return this.run(dayKey);
	}
	/**
	* Run one scan and publish its result.
	*
	* `cachedAt` is stamped when the scan COMPLETES, not when it starts: a pass
	* slower than the TTL would otherwise be born expired, and every read after
	* it would start another pass back-to-back.
	* @param dayKey - the Beijing day the pass aggregates.
	* @returns the freshly scanned value.
	*/
	run(dayKey) {
		const run = this.scan(dayKey).then((value) => {
			this.cachedDayKey = dayKey;
			this.cachedValue = value;
			this.cachedAt = this.now().getTime();
			return value;
		}).finally(() => {
			this.inFlight = void 0;
		});
		this.inFlight = run;
		return run;
	}
};
/** Max session-ids kept in the scanner's cold-resolution cache before eviction. */
const COLD_RESOLVE_CACHE_LIMIT = 1024;
/** Max session-ids kept in the scanner's cold-failure cache before eviction. */
const COLD_FAILED_CACHE_LIMIT = 1024;
/** The live SessionStore slice a scan reads (resolved once per scan). */
//#endregion
//#region lib/types/persistence.js
/**
* The persistence seams a cold scan reads through. DSH ships a single
* persistence runtime family — the handle-based `list` / `open` +
* `SessionHandle` surface (0.1.2-alpha.5+, the only one the plugin's
* `^0.2.0-rc.1` peer targets). This module is the only place that knows
* the handle shape. Split out of `today-spend.ts` so the scan strategies read
* one shape.
* @module @rayadesu/dsh-llm-billing/persistence
*/
/**
* Read one live session's complete event log across both runtime families.
* @throws when the session exposes neither the legacy `events` snapshot nor
*   the newer `snapshotEvents()` reader — an unknown runtime surface must
*   fail loudly rather than silently price an empty log.
*/
function liveSessionEvents(session) {
	if (session.events !== void 0) return session.events;
	if (session.snapshotEvents !== void 0) return session.snapshotEvents();
	throw new Error("llm-billing: session log surface is neither Session.events nor Session.snapshotEvents");
}
/**
* Unwrap a handle read across both return shapes.
* @param read - the handle's read result.
* @returns the event array.
*/
function handleReadEvents(read) {
	if (Array.isArray(read)) return read;
	return read.events;
}
/**
* List every stored session snapshot through the handle-based persistence
* service (`list`).
* @param persistence - the persistence service slice.
* @returns one snapshot per stored session.
*/
function persistenceListSnapshots(persistence) {
	return persistence.list();
}
/**
* Read one stored session's complete event log and durable inherited boundary
* through the handle-based persistence service (`open` + handle `read`; the
* handle is closed after the read). Throws when the session does not exist.
* @param persistence - the persistence service slice.
* @param id - the stored session to read.
* @returns the session's complete event log plus its inherited-prefix boundary.
*/
async function persistenceInspect(persistence, id) {
	const handle = await persistence.open(id, "read");
	try {
		return {
			events: handleReadEvents(await handle.read()),
			seedLength: forkBoundaryOf(handle)
		};
	} finally {
		await handle.close();
	}
}
//#endregion
//#region lib/types/today-spend.js
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
/**
* Bounded-map eviction: drop the oldest inserted entry once `size` reached
* `limit`. Evicting one entry (instead of clearing) keeps the other sessions'
* resolved state warm across scans.
*/
function evictOldest$1(map, limit) {
	if (map.size < limit) return;
	const oldest = map.keys().next().value;
	if (oldest !== void 0) map.delete(oldest);
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
function delegatedSpendOf(id, ownSpend, lineage) {
	const children = /* @__PURE__ */ new Map();
	for (const [childId, header] of lineage) {
		const parent = header.parentSession;
		if (parent === void 0 || !isSubagentSession(header)) continue;
		const siblings = children.get(parent);
		if (siblings === void 0) children.set(parent, [childId]);
		else siblings.push(childId);
	}
	const seen = /* @__PURE__ */ new Set([id]);
	const pending = [...children.get(id) ?? []];
	for (const child of pending) seen.add(child);
	let total = emptyTodaySpend();
	while (pending.length > 0) {
		const current = pending.pop();
		total = mergeTodaySpend(total, ownSpend.get(current) ?? emptyTodaySpend());
		for (const child of children.get(current) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			pending.push(child);
		}
	}
	return total;
}
/**
* The aggregate computation behind a cache miss. Chooses the projection path
* when the projection registry is composed, the events path otherwise; both
* gate cold reads on persisted revisions AND adopt the fold they already hold
* for an unchanged log, so steady-state scans re-read only sessions whose logs
* actually changed while every unchanged session keeps contributing.
*/
var TodaySpendScanner = class {
	deps;
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
	coldResolved = /* @__PURE__ */ new Map();
	/**
	* Cold sessions whose resolution failed, id → the revision it failed at plus
	* when. Keyed by revision too, so an unchanged log is not re-read every scan,
	* but the retry is TIME-boxed: a purely revision-keyed failure would hide a
	* session permanently when its log never changes again.
	*/
	coldFailed = /* @__PURE__ */ new Map();
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Remember one cold session's resolution, bounded by
	* {@link COLD_RESOLVE_CACHE_LIMIT}: evicting the oldest entry (instead of
	* clearing) keeps the other sessions' resolved state warm across scans.
	*/
	rememberCold(id, resolution) {
		evictOldest$1(this.coldResolved, COLD_RESOLVE_CACHE_LIMIT);
		this.coldResolved.set(id, resolution);
	}
	/**
	* Compute today's aggregate for one Beijing day.
	* @param dayKey - the Beijing-time calendar-day key to aggregate.
	* @returns today's spend across every session.
	*/
	async scan(dayKey) {
		return (await this.scanDetail(dayKey)).aggregate;
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
	async scanSessions(dayKey) {
		return { sessions: (await this.scanDetail(dayKey)).sessions };
	}
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
	async scanDetail(dayKey) {
		if (this.deps.projections?.() === void 0) return this.scanDetailEvents(dayKey);
		this.deps.ensureUnit?.();
		return this.scanDetailProjections(dayKey);
	}
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
	async resolveCold(header, seeded, dayKey) {
		const { persistence, projectionCache, logger } = this.deps;
		if (!seeded) {
			const cache = projectionCache?.();
			if (cache !== void 0) try {
				const value = cache.cachedSnapshot(header, 0, [BILLING_UNIT_KEY])?.values[BILLING_UNIT_KEY];
				if (value !== void 0 && value.dayKey !== dayKey) return {
					fold: value,
					title: null
				};
			} catch (error) {
				logger.warn(`llm-billing: projection cache read for session ${header.id} failed: ${String(error)}`);
			}
		}
		const persistenceService = persistence?.();
		if (persistenceService === void 0) return void 0;
		try {
			const read = await persistenceInspect(persistenceService, header.id);
			return {
				fold: foldOwnBilling(this.deps.unit, read.events, read.seedLength),
				title: foldSessionTitle(read.events)
			};
		} catch (error) {
			logger.warn(`llm-billing: skipping unreadable session ${header.id}: ${String(error)}`);
			return;
		}
	}
	/**
	* Live-session entries of one projection-path scan: each session with its
	* eager `billingTodaySpend` cell. The cell is boundary-aware (the unit skips
	* a fork child's inherited prefix), so a fork child reads the same own-event
	* spend a non-fork session does.
	*/
	*liveBillingEntries(store, projections) {
		for (const session of store.list()) yield {
			session,
			state: projections?.stateOf(session, BILLING_UNIT_KEY)
		};
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
	async coldAdopt(liveIds, snapshots, dayKey, adopt) {
		const persistenceAvailable = this.deps.persistence?.() !== void 0;
		const pending = [];
		for (const { header, revision } of snapshots) {
			if (liveIds.has(header.id)) continue;
			const seeded = isSeededSession(header);
			const resolved = this.coldResolved.get(header.id);
			if (resolved !== void 0 && resolved.revision === revision) {
				adopt(header.id, resolved);
				continue;
			}
			const failed = this.coldFailed.get(header.id);
			if (failed !== void 0 && failed.revision === revision && Date.now() - failed.at < 3e5) continue;
			pending.push({
				header,
				revision,
				seeded
			});
		}
		let resolvedCount = 0;
		await withConcurrency(pending, 8, async ({ header, revision, seeded }) => {
			resolvedCount += 1;
			if (resolvedCount % 8 === 0) await yieldToEventLoop();
			const resolved = await this.resolveCold(header, seeded, dayKey);
			if (resolved !== void 0) {
				this.coldFailed.delete(header.id);
				this.rememberCold(header.id, {
					revision,
					...resolved
				});
			} else if (persistenceAvailable) {
				evictOldest$1(this.coldFailed, COLD_FAILED_CACHE_LIMIT);
				this.coldFailed.set(header.id, {
					revision,
					at: Date.now()
				});
			}
		});
		let adopted = 0;
		for (const { header } of pending) {
			adopted += 1;
			if (adopted % 8 === 0) await yieldToEventLoop();
			const resolved = this.coldResolved.get(header.id);
			if (resolved !== void 0) adopt(header.id, resolved);
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
	async collectTodayEvents(dayKey, onSession) {
		const { sessions, persistence, maxEvents, logger, billing, catalog } = this.deps;
		const liveIds = /* @__PURE__ */ new Set();
		let collected = 0;
		let truncated = false;
		const dayRange = beijingDayRangeOfKey(dayKey);
		const onDay = dayRange === void 0 ? (event) => beijingPartsOf(event.time).dayKey === dayKey : (event) => event.time >= dayRange.start && event.time < dayRange.end;
		/** Price one complete log, announce it, and return what to remember. */
		const collect = (id, events, seedLength, lineage) => {
			const folder = new BillingFolder(billing, catalog, seedLength);
			for (const event of events) {
				if (onDay(event)) {
					collected += 1;
					if (collected > maxEvents) {
						truncated = true;
						break;
					}
				}
				folder.add(event);
			}
			const fold = folder.fold;
			const title = foldSessionTitle(events);
			onSession(id, fold, title, lineage);
			return {
				fold,
				title
			};
		};
		if (sessions !== void 0) {
			const store = sessions();
			if (store !== void 0) {
				let folded = 0;
				for (const session of store.list()) {
					folded += 1;
					if (folded % 8 === 0) await yieldToEventLoop();
					liveIds.add(session.id);
					collect(session.id, liveSessionEvents(session), forkBoundaryOf(session), session.header ?? {});
					if (truncated) break;
				}
			}
		}
		const persistenceService = persistence?.();
		if (!truncated && persistenceService !== void 0) {
			const snapshots = await persistenceListSnapshots(persistenceService);
			for (const { header, revision } of snapshots) {
				if (liveIds.has(header.id)) continue;
				const resolved = this.coldResolved.get(header.id);
				if (resolved !== void 0 && resolved.revision === revision) {
					onSession(header.id, resolved.fold, resolved.title, header);
					continue;
				}
				try {
					const read = await persistenceInspect(persistenceService, header.id);
					const priced = collect(header.id, read.events, read.seedLength, header);
					if (!truncated) this.rememberCold(header.id, {
						revision,
						...priced
					});
				} catch (error) {
					logger.warn(`llm-billing: skipping unreadable session ${header.id}: ${String(error)}`);
				}
				if (truncated) break;
			}
		}
		if (truncated) logger.warn(`llm-billing: today's events exceeded ${maxEvents}; result truncated`);
		return truncated;
	}
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
	async scanDetailProjections(dayKey) {
		const { sessions, persistence, projections } = this.deps;
		const projectionsService = projections?.();
		let aggregate = emptyTodaySpend();
		const rows = /* @__PURE__ */ new Map();
		const lineage = /* @__PURE__ */ new Map();
		const titles = /* @__PURE__ */ new Map();
		const ownSpend = /* @__PURE__ */ new Map();
		const createdAt = /* @__PURE__ */ new Map();
		const liveIds = /* @__PURE__ */ new Set();
		if (sessions !== void 0) {
			const store = sessions();
			if (store !== void 0) {
				let folded = 0;
				for (const { session, state } of this.liveBillingEntries(store, projectionsService)) {
					folded += 1;
					if (folded % 8 === 0) await yieldToEventLoop();
					liveIds.add(session.id);
					lineage.set(session.id, session.header ?? {});
					const born = session.header?.createdAt;
					if (born !== void 0) createdAt.set(session.id, born);
					const title = foldSessionTitle(liveSessionEvents(session));
					titles.set(session.id, title);
					if (state === void 0) continue;
					ownSpend.set(session.id, state.session);
					if (state.dayKey !== dayKey) continue;
					aggregate = mergeTodaySpend(aggregate, state.spend);
					rows.set(session.id, {
						sessionId: session.id,
						title,
						total: state.spend.total,
						ownTotal: state.spend.total
					});
				}
			}
		}
		const persistenceService = persistence?.();
		if (persistenceService !== void 0) {
			const snapshots = await persistenceListSnapshots(persistenceService);
			for (const { header } of snapshots) {
				if (liveIds.has(header.id)) continue;
				lineage.set(header.id, header);
				if (header.createdAt !== void 0) createdAt.set(header.id, header.createdAt);
			}
			await this.coldAdopt(liveIds, snapshots, dayKey, (id, resolved) => {
				if (resolved.title !== null && !titles.has(id)) titles.set(id, resolved.title);
				ownSpend.set(id, resolved.fold.session);
				if (resolved.fold.dayKey !== dayKey) return;
				aggregate = mergeTodaySpend(aggregate, resolved.fold.spend);
				rows.set(id, {
					sessionId: id,
					title: resolved.title,
					total: resolved.fold.spend.total,
					ownTotal: resolved.fold.spend.total
				});
			});
		}
		return {
			aggregate,
			sessions: rollUpSubagentSpend([...rows.values()], lineage, titles),
			dayKey,
			ownSpend,
			lineage,
			createdAt
		};
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
	async scanDetailEvents(dayKey) {
		let aggregate = emptyTodaySpend();
		const rows = [];
		const lineage = /* @__PURE__ */ new Map();
		const titles = /* @__PURE__ */ new Map();
		const ownSpend = /* @__PURE__ */ new Map();
		const createdAt = /* @__PURE__ */ new Map();
		await this.collectTodayEvents(dayKey, (id, fold, title, sessionLineage) => {
			lineage.set(id, sessionLineage);
			titles.set(id, title);
			const born = sessionLineage.createdAt;
			if (born !== void 0) createdAt.set(id, born);
			ownSpend.set(id, fold.session);
			if (fold.dayKey !== dayKey) return;
			aggregate = mergeTodaySpend(aggregate, fold.spend);
			rows.push({
				sessionId: id,
				title,
				total: fold.spend.total,
				ownTotal: fold.spend.total
			});
		});
		return {
			aggregate,
			sessions: rollUpSubagentSpend(rows, lineage, titles),
			dayKey,
			ownSpend,
			lineage,
			createdAt
		};
	}
};
//#endregion
//#region lib/types/index.js
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
const name = "llm-billing";
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
/** Public API default; deployments may point elsewhere via $DEEPSEEK_BASE_URL. */
const PUBLIC_BASE_URL = "https://api.deepseek.com";
/**
* Advisory display rows mirroring the DSH `llm-deepseek` catalog (V4.1 Flash
* first, its current default route), plus the MiMo series (V2.5, and V2.6
* which kept V2.5's pricing). The retired preview id
* `deepseek-v4.1-flash-expires-on-0910` stays so the logs that used it keep a
* readable label; rows never restrict which models are priced — the pricing
* table does.
*/
const DEFAULT_MODELS = [
	{
		id: "deepseek-flash",
		name: "DeepSeek-V41-Flash"
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek-V4-Flash"
	},
	{
		id: "deepseek-v4.1-flash-expires-on-0910",
		name: "DeepSeek-V4.1-Flash"
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek-V4-Pro"
	},
	{
		id: "deepseek-v4-flash-vision-exp",
		name: "DeepSeek-V4-Flash-Vision-Exp"
	},
	{
		id: "mimo-v2.5-pro",
		name: "MiMo-V2.5-Pro"
	},
	{
		id: "mimo-v2.5",
		name: "MiMo-V2.5"
	},
	{
		id: "mimo-v2.6-pro",
		name: "MiMo-V2.6-Pro"
	},
	{
		id: "mimo-v2.6-flash",
		name: "MiMo-V2.6-Flash"
	}
];
const billingModel = z.object({
	id: z.string().required(),
	name: z.string()
});
const tokenPrice = z.object({
	cacheHitInput: z.number().min(0),
	cacheMissInput: z.number().min(0),
	output: z.number().min(0)
});
const billingRateRow = z.object({
	model: z.string().required(),
	peak: tokenPrice,
	offPeak: tokenPrice,
	effectiveFrom: z.number().min(0)
});
const billingConfig = z.object({
	peakHours: z.array(z.object({
		start: z.number().step(1).min(0).max(23),
		end: z.number().step(1).min(0).max(24)
	})).default([...DEFAULT_PEAK_HOURS]),
	models: z.array(billingRateRow).default([...DEFAULT_MODEL_PRICING])
});
const Config = z.object({
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: z.string(),
	models: z.array(billingModel).default(DEFAULT_MODELS),
	billing: billingConfig
});
/** How often a Beijing-day "today spend" value may be recomputed (60s). */
const TODAY_SPEND_CACHE_MS = 6e4;
/** Hard cap on today's events collected by the events scan path. */
const TODAY_SPEND_MAX_EVENTS = 2e5;
/** Max session-spend rows kept for incremental recompute before eviction. */
const SESSION_SPEND_CACHE_LIMIT = 1024;
/** Max session-id entries kept in the per-turn-cost fold cache before eviction. */
const SESSION_TURN_SPEND_CACHE_LIMIT = 64;
/** How long one balance snapshot is reused before the host refetches it (15s). */
const BALANCE_CACHE_MS = 15e3;
/** Hard cap on one `/user/balance` request (5s); a hung endpoint never blocks the badge. */
const BALANCE_TIMEOUT_MS = 5e3;
/**
* Bounded-map eviction: drop the oldest inserted entry once `size` reached
* `limit`, so an unbounded session-id space grows the map no further. Evicting
* one entry (instead of clearing) keeps the other sessions' incremental
* spend warm.
*/
function evictOldest(map, limit) {
	if (map.size < limit) return;
	const oldest = map.keys().next().value;
	if (oldest !== void 0) map.delete(oldest);
}
/**
* Read one session's event log and durable seed boundary: the live
* SessionStore first, then the persistence backend for a flushed session
* (opened directly by id — no header listing). The live-session surface
* is read structurally across both DSH runtime families — `Session.events`
* (≤ 0.1.1-rc.2) or `Session.snapshotEvents()` + `Session.inheritedEventCount`
* (0.1.2-alpha.4+) — via {@link liveSessionEvents} / {@link forkBoundaryOf}.
* @param ctx - plugin context carrying the SessionStore and optional persistence.
* @param sessionId - the session to read.
* @returns the session's complete event log plus its inherited-prefix boundary.
* @throws {@link LlmError} with code `NOT_FOUND` when the session is unknown.
*/
async function sessionEvents(ctx, sessionId) {
	const live = ctx.get("sessions")?.get(sessionId);
	if (live !== void 0) return {
		events: liveSessionEvents(live),
		seedLength: forkBoundaryOf(live)
	};
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0) try {
		return await persistenceInspect(persistence, sessionId);
	} catch (error) {
		throw new LlmError(`llm-billing: session ${sessionId} not found`, "NOT_FOUND", { cause: error });
	}
	throw new LlmError(`llm-billing: session ${sessionId} not found`, "NOT_FOUND");
}
/** Resolve the plugin's static facts once: endpoint, credential ref, pricing table. */
function resolveFacts(ctx, config) {
	return {
		baseURL: () => config.baseURL ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value ?? "https://api.deepseek.com",
		apiKeyRef: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
		billing: resolveBilling(config.billing),
		catalog: (config.models ?? DEFAULT_MODELS).map((model) => ({
			id: model.id,
			name: model.name ?? model.id
		}))
	};
}
/**
* Resolve the API key per call: the credentials service first, then the
* launch environment fallback.
* @throws {@link LlmError} with code `MISSING_CREDENTIAL` when neither yields a usable key.
*/
async function resolveApiKey(ctx, apiKeyRef) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		const hit = await credentials.resolve(apiKeyRef);
		if (hit !== void 0) return assertUsableApiKey(hit.value, "llm-billing", apiKeyRef);
	} else {
		const ambient = launchEnvironmentOf(ctx).get(apiKeyRef);
		if (ambient !== void 0 && ambient.value.length > 0) return assertUsableApiKey(ambient.value, "llm-billing", apiKeyRef);
	}
	throw new LlmError(`llm-billing: no API key; store ${apiKeyRef} through the credentials service or export it`, "MISSING_CREDENTIAL");
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
function createSessionSpendFetcher(ctx, facts) {
	const sessionSpendCache = /* @__PURE__ */ new Map();
	return async (sessionId) => {
		const { events, seedLength } = await sessionEvents(ctx, sessionId);
		const ownCount = events.length - seedLength;
		const cached = sessionSpendCache.get(sessionId);
		if (cached !== void 0 && cached.count === ownCount) {
			sessionSpendCache.delete(sessionId);
			sessionSpendCache.set(sessionId, cached);
			return cached.spend;
		}
		if (cached !== void 0 && cached.count < ownCount) {
			const spend = mergeTodaySpend(cached.spend, computeSessionSpend(events.slice(seedLength + cached.count), facts.billing, facts.catalog));
			evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT);
			sessionSpendCache.set(sessionId, {
				count: ownCount,
				spend
			});
			return spend;
		}
		const spend = computeSessionSpend(events, facts.billing, facts.catalog, seedLength);
		evictOldest(sessionSpendCache, SESSION_SPEND_CACHE_LIMIT);
		sessionSpendCache.set(sessionId, {
			count: ownCount,
			spend
		});
		return spend;
	};
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
function createUnitRegistrar(ctx, unit) {
	let registered = false;
	return () => {
		if (registered) return;
		const registry = ctx.get("sessionProjections");
		if (registry === void 0) return;
		registry.register(unit);
		registered = true;
	};
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
* All three reads come from ONE cached pass: the day's aggregate, its
* per-session ranking, and the delegated-subagent subtree of a conversation
* (the same pass folds each session's whole-session total, so the subtree read
* costs no second scan).
* @param ctx - plugin context.
* @param facts - resolved endpoint, credential, pricing, and catalog facts.
* @param unit - the shared projection unit definition.
* @param ensureUnit - idempotent unit registrar (last-resort registration).
* @returns the three today-spend loaders.
*/
function createTodaySpendLoaders(ctx, facts, unit, ensureUnit) {
	const scanner = new TodaySpendScanner({
		sessions: () => ctx.get("sessions"),
		persistence: () => ctx.get("sessionPersistence"),
		projections: () => ctx.get("sessionProjections"),
		projectionCache: () => ctx.get("sessionProjectionCache"),
		ensureUnit,
		unit,
		maxEvents: TODAY_SPEND_MAX_EVENTS,
		logger: ctx.logger,
		billing: facts.billing,
		catalog: facts.catalog
	});
	const todayCache = new TodaySpendCache((dayKey) => scanner.scanDetail(dayKey), TODAY_SPEND_CACHE_MS);
	return {
		fetchTodaySpend: async (force = false) => (await todayCache.get(force)).aggregate,
		fetchTodaySessionsSpend: async (force = false) => ({ sessions: (await todayCache.get(force)).sessions }),
		fetchDelegatedSpend: async (sessionId, force = false) => {
			const detail = await todayCache.get(force);
			const spend = delegatedSpendOf(sessionId, detail.ownSpend, detail.lineage);
			const createdAt = detail.createdAt.get(sessionId);
			return {
				total: spend.total,
				models: spend.models,
				isSubagent: isSubagentSession(detail.lineage.get(sessionId)),
				crossedDay: createdAt !== void 0 && beijingDayKey(new Date(createdAt)) !== detail.dayKey
			};
		}
	};
}
/** One completed Turn's spend loader, located by its closing message id. */
function createTurnSpendFetcher(ctx, facts) {
	return async (sessionId, messageId) => {
		const { events } = await sessionEvents(ctx, sessionId);
		return computeTurnSpend(events, facts.billing, facts.catalog, messageId);
	};
}
/**
* Every completed Turn's cost in one session, folded incrementally per session
* (session logs are append-only, so only the appended tail is priced on a
* growing log). One call serves a whole transcript's per-message cost rows,
* replacing the per-message `getTurnSpend` fan-out.
*/
function createTurnSpendsFetcher(ctx, facts) {
	const folders = /* @__PURE__ */ new Map();
	return async (sessionId) => {
		const { events } = await sessionEvents(ctx, sessionId);
		let entry = folders.get(sessionId);
		if (entry === void 0 || entry.count > events.length) {
			entry = {
				folder: new SessionTurnSpendFolder(facts.billing, facts.catalog),
				count: 0
			};
			evictOldest(folders, 64);
			folders.set(sessionId, entry);
		}
		if (entry.count !== events.length) {
			entry.folder.feed(events);
			entry.count = events.length;
		}
		return entry.folder.finish();
	};
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
function createBalanceFetcher(ctx, facts) {
	let cached;
	let inflight;
	return async (force = false) => {
		if (!force && cached !== void 0 && Date.now() - cached.at < 15e3) return cached.value;
		if (inflight !== void 0) return inflight;
		const run = (async () => {
			try {
				const apiKey = await resolveApiKey(ctx, facts.apiKeyRef);
				const value = await fetchDeepSeekBalance(facts.baseURL(), apiKey, AbortSignal.timeout(BALANCE_TIMEOUT_MS));
				cached = {
					at: Date.now(),
					value
				};
				return value;
			} finally {
				inflight = void 0;
			}
		})();
		inflight = run;
		return run;
	};
}
/**
* Register the `billing` Remote under the `billing` namespace. Assembly only:
* facts resolve once, each loader owns its caches, and the gateway receives
* the bound thunks.
* @param ctx - owning plugin context.
* @param config - validated plugin config.
*/
function apply(ctx, config) {
	const facts = resolveFacts(ctx, config);
	const unit = billingTodaySpendDefinition(facts.billing, facts.catalog);
	const ensureUnit = createUnitRegistrar(ctx, unit);
	ensureUnit();
	ctx.on("session/created", ensureUnit);
	const fetchBalance = createBalanceFetcher(ctx, facts);
	const fetchSessionSpend = createSessionSpendFetcher(ctx, facts);
	const { fetchTodaySpend, fetchTodaySessionsSpend, fetchDelegatedSpend } = createTodaySpendLoaders(ctx, facts, unit, ensureUnit);
	const fetchTurnSpend = createTurnSpendFetcher(ctx, facts);
	const fetchTurnSpends = createTurnSpendsFetcher(ctx, facts);
	new DeepSeekBalanceGateway(ctx, {
		fetchBalance,
		fetchSessionSpend,
		fetchTodaySpend,
		fetchTodaySessionsSpend,
		fetchDelegatedSpend,
		fetchTurnSpend,
		fetchTurnSpends
	});
}
//#endregion
export { BALANCE_CACHE_MS, BALANCE_TIMEOUT_MS, BILLING_UNIT_KEY, BillingFolder, Config, DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS, DeepSeekBalanceGateway, FLASH_SERIES_RATE_CHANGE_AT, PUBLIC_BASE_URL, SESSION_SPEND_CACHE_LIMIT, SESSION_TURN_SPEND_CACHE_LIMIT, SessionTurnSpendFolder, SpendAccumulator, TODAY_SPEND_CACHE_MS, TODAY_SPEND_MAX_EVENTS, TodaySpendCache, TodaySpendScanner, V4_PRO_ROUTE_SWITCH_AT, addEventContribution, apply, applyBillingEvent, beijingDayKey, billingTodaySpendDefinition, computeSessionSpend, computeSessionTurnSpends, computeTodaySpend, computeTurnSpend, delegatedSpendOf, emptyBillingFoldState, emptyTodaySpend, fetchDeepSeekBalance, foldBillingUnit, foldOwnBilling, foldSessionTitle, forkBoundaryOf, isPeak, isSeededSession, isSubagentSession, liveSessionEvents, mergeTodaySpend, name, negateSpend, parseDeepSeekBalance, persistenceInspect, persistenceListSnapshots, priceEvent, priceUsage, resolveBilling, rollUpSubagentSpend, subtractSpend, topLevelSessionOf };
