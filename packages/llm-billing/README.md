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

The plugin registers the `billing` Remote with three methods: `getBalance()` (the parsed `/user/balance` snapshot), `getSessionSpend(sessionId)` (one session's billed cost), and `getTodaySpend(force?)` (every session's billed cost on the current Beijing-time calendar day; `force` bypasses the host-side cache, for the badge's manual refresh). The spend prices each `assistant/message` event's billed tokens (cache-hit input, cache-miss input including cache writes, and output including reasoning) at the official rate of the event's own Beijing-time peak/off-peak classification — peak windows apply weekdays (Monday–Friday) only, and weekends are always off-peak — then sums per model.

### Today-spend read path (no full scans per message)

`getTodaySpend()` never scans every session log per request. A 60-second Beijing-day cache with in-flight coalescing serves message-triggered reads; only the manual refresh (`force`) bypasses the time window. Behind a miss, two revision-gated strategies compute the aggregate:

- **Projection path** (used when `@deepseek-ai/dsh-session-projection` is composed): the plugin registers the `billingTodaySpend` projection unit, which folds each session's spend eagerly as events commit. Live sessions are read from their eager cells with zero log I/O; cold sessions ride the projection-cache ladder (`coldSnapshot`) or, without the cache service, one detached fold per session. Only sessions whose persisted revision changed since the last resolution are touched.
- **Events path** (fallback without the registry): collects only today's events (Beijing-day filter during collection) with a 200 000-event cap, skipping sessions whose persisted revision is unchanged.

After the first resolution per process, steady-state reads cost only the sessions whose logs actually changed. A session whose log cannot be read is skipped with a warning instead of failing the whole day's total.

Note: the projection path prices a session's history once, at the rates in effect when its events were folded — changing `billing.models` re-prices only events folded after the change (the events path re-prices the whole log).

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
