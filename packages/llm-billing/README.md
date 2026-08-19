# @deepseek-ai/dsh-llm-billing

English | [中文](README.zh.md)

Standalone host plugin that turns the DeepSeek account balance and per-session spend into a `billing` Remote. It owns the `/user/balance` transport, the peak/off-peak pricing table, and the per-session spend pricing, so a deployment can surface "how much is left, and what this session cost" without coupling that to the chat-completions adapter. The browser half is [`dsh-client-ui-billing`](../../client/ui-billing/README.md).

## Install

Add the plugin to a composition (a `cordis.yml` row) and give it a credential. It resolves the API key from the credential seam (or the environment variable named by `apiKeyEnv`) and the endpoint from `baseURL`, then `$DEEPSEEK_BASE_URL`, then the public API.

```yaml
- id: llm-billing
  name: '@deepseek-ai/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

The plugin registers the `billing` Remote with three methods: `getBalance()` (the parsed `/user/balance` snapshot), `getSessionSpend(sessionId)` (one session's billed cost), and `getTodaySpend()` (every session's billed cost on the current Beijing-time calendar day). The spend prices each `assistant/message` event's billed tokens (cache-hit input, cache-miss input including cache writes, and output including reasoning) at the official rate of the event's own Beijing-time peak/off-peak hour, then sums per model.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4 Pro | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing) | Peak-hour windows; all other hours are off-peak. |
| `billing.models` | Published V4 rates | Per-model peak/off-peak price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens). |

Override one model without dropping the others by supplying a non-empty `billing.models` list; an empty or omitted list falls back to the published defaults.

## Model Experience

None, as this package is a read-only Remote projection of provider and session facts and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; its only provider call is a credential-authenticated `/user/balance` read, which is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row; a model without a rate row is omitted.
- **On-demand read** — the session spend reads the session's full event log on each call rather than maintaining an incremental aggregate, so cost grows with the per-session log size; `getTodaySpend()` reads every session's log, and a session whose log cannot be read is skipped with a warning instead of failing the whole day's total.
