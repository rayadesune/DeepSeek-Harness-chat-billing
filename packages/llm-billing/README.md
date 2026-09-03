# @rayadesu/dsh-llm-billing

English | [中文](README.zh.md)

Standalone host plugin that turns the DeepSeek account balance and per-session spend into a `billing` Remote. It owns the `/user/balance` transport, the peak/off-peak pricing table, and the per-session spend pricing, so a deployment can surface "how much is left, and what this session cost" without coupling that to the chat-completions adapter. The browser half is [`dsh-client-ui-billing`](../ui-billing/README.md).

## Install

Add the plugin to a composition (a `cordis.yml` row) and give it a credential. It resolves the API key from the credential seam (or the environment variable named by `apiKeyEnv`) and the endpoint from `baseURL`, then `$DEEPSEEK_BASE_URL`, then the public API.

```yaml
- id: llm-billing
  name: '@rayadesu/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

The plugin registers the `billing` Remote with five methods: `getBalance()` (the parsed `/user/balance` snapshot), `getSessionSpend(sessionId)` (one session's billed cost), `getTodaySpend(force?)` (every session's billed cost on the current Beijing-time calendar day; `force` bypasses the host-side cache, for the badge's manual refresh), `getTodaySessionsSpend(force?)` (today's billed cost per session, sorted by cost descending, each row carrying the session's durable title), and `getTurnSpend(sessionId, messageId)` (one completed turn's billed cost, located by its closing assistant message id). The spend prices each `assistant/message` event's billed tokens (cache-hit input, cache-miss input including cache writes, and output including reasoning) at the official rate of the event's own Beijing-time peak/off-peak classification — peak windows apply weekdays (Monday–Friday) only, and weekends are always off-peak — then sums per model. A turn is the `turn/start`..`turn/end` range holding the closing message; the ranking folds each session's title from its latest `session/title` event (last-wins, so a rename is reflected as soon as its event commits and the session is re-read).

### Today-spend read path (no full scans per message)

`getTodaySpend()` never scans every session log per request. A 60-second Beijing-day cache with in-flight coalescing serves message-triggered reads; only the manual refresh (`force`) bypasses the time window. Behind a miss, two revision-gated strategies compute the aggregate:

- **Projection path** (used when `@deepseek-ai/dsh-session-projection` is composed): the plugin registers the `billingTodaySpend` projection unit, which folds each session's spend eagerly as events commit. Live sessions are read from their eager cells with zero log I/O; cold sessions ride the projection-cache ladder (`coldSnapshot`) or, without the cache service, one detached fold per session. Only sessions whose persisted revision changed since the last resolution are touched.
- **Events path** (fallback without the registry): collects only today's events (Beijing-day filter during collection) with a 200 000-event cap, skipping sessions whose persisted revision is unchanged.

After the first resolution per process, steady-state reads cost only the sessions whose logs actually changed. A session whose log cannot be read is skipped with a warning instead of failing the whole day's total.

Note: the projection path prices a session's history once, at the rates in effect when its events were folded — changing `billing.models` re-prices only events folded after the change (the events path re-prices the whole log).

## Forked sessions

A forked session (DSH's "fork" of a conversation) opens its log with a verbatim copy of its source session's events. Without special handling, the same model outputs would be billed once per copy: the child's session spend would include the inherited prefix, and today's spend would count it a second time alongside the parent's. The plugin prices only a session's OWN events — the fork boundary is the session's persisted state (`header.seedLength` on the ≤ 0.1.1-rc.2 runtime, `Session.inheritedEventCount` / `inspect().inheritedEventCount` on 0.1.2-alpha.4+, both read structurally), and every event with `seq < boundary` is treated as already billed in the source session. Fork children are therefore billed from their first new exchange onward (a freshly forked session prices to zero), today's spend counts each model output exactly once, and the same lineage-safe rule covers multi-generation forks and subagent forks (spawned with `context: 'fork'`). The boundary is the persisted value, so a resumed fork child keeps its original boundary, while a session created without a seed — ordinary sessions and cold resumes included — carries no boundary and is billed in full.

## Runtime compatibility

Since 0.1.2-alpha.4, DSH replaced the live `Session` log surface `Session.events` with `Session.snapshotEvents()` (no args = the full current log) and `Session.ownEvents()`, and moved `SessionHeader.seedLength` to `Session.inheritedEventCount` (the persistence `inspect()` result carries the value beside `meta`; `listSnapshots()` headers keep only the boolean `isSeeded`). Every log read in the plugin goes through the structural adapters `liveSessionEvents` / `forkBoundaryOf` / `isSeededSession`, which accept both the ≤ 0.1.1-rc.2 and the 0.1.2-alpha.4+ shapes — the npm release baseline (`^0.1.2-alpha.5`) and the ahead-of-npm monorepo runtime both work without modification. On an unknown surface that has neither shape the plugin fails loudly rather than silently pricing an empty log.

The persistence service itself changed surface too: 0.1.1-rc.2 exposes `inspect(id)` / `listSnapshots()`, while the 0.1.2-alpha.5 handle-based seam (in the monorepo after the released build) exposes `open(id, 'read')` + `SessionHandle.read()` / `list()`. The scanner reads both families through `persistenceInspect` / `persistenceListSnapshots` (the handle is always closed, including after a failed read), so the same plugin serves the published alpha line and the refactored checkout.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4 Pro + V4 Flash Vision Exp | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing, weekdays) | Peak-hour windows, applied weekdays (Mon–Fri) only; weekends and all other hours are off-peak. |
| `billing.models` | Published V4 rates | Per-model peak/off-peak price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens). |

Override one model without dropping the others by supplying a non-empty `billing.models` list; an empty or omitted list falls back to the published defaults.

## Model Experience

None, as this package is a read-only Remote projection of provider and session facts and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; its only provider call is a credential-authenticated `/user/balance` read, which is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row; a model without a rate row is omitted.
- **Up-to-60s staleness** — `getTodaySpend()` is served from the host-side cache for up to 60 seconds; only the manual refresh (`force`) recomputes immediately (still revision-gated, so an unchanged log costs nothing).
- **Projection pricing is history-frozen** — when the projection path is active, a pricing-table change prices only events folded after the change; restart (or the events fallback) re-prices the full log.
