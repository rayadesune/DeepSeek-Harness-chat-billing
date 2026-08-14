# @deepseek-ai/dsh-llm-billing

English | [中文](README.zh.md)

Standalone host plugin that turns the DeepSeek account balance and per-model remaining-task estimate into a `billing` Remote. It owns the `/user/balance` transport, the cross-session per-model token fold, and the peak/off-peak pricing table, so a deployment can surface "how much is left, and roughly how many more tasks it buys" without coupling that estimate to the chat-completions adapter. The browser half is [`dsh-client-ui-billing`](../../client/ui-billing/README.md).

## Install

Add the plugin to a composition (a `cordis.yml` row) and give it a credential. It resolves the API key from the credential seam (or the environment variable named by `apiKeyEnv`) and the endpoint from `baseURL`, then `$DEEPSEEK_BASE_URL`, then the public API.

```yaml
- id: llm-billing
  name: '@deepseek-ai/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

The plugin registers the `billing` Remote with two methods: `getBalance()` (the parsed `/user/balance` snapshot) and `getEstimate()` (the balance plus one remaining-task projection per configured model). The estimate is a conversion, not a billing promise: it divides the CNY balance by each model's historical per-session average billed tokens priced at the current peak/off-peak rate.

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

- **CNY only** — the estimate reads the CNY balance line and reports null for a non-CNY balance. Multi-currency conversion is deferred.
- **Session-scoped average** — one "task" is one session; a session that switches models counts toward each model it actually called. The average is a per-session figure, not a declared task cost.
- **On-demand fold** — the estimate folds every reachable session on each call rather than maintaining an incremental aggregate, so cost grows with the session count and log size.
