# DeepSeek Harness Billing Plugin

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows your **DeepSeek account balance** and **roughly how many more tasks it can run**, right in the Web session header.

> Balance is the real number from `GET /user/balance`; the remaining-task figure is an estimate, not a billing promise.

## What it shows

- **Session-header badge** — remaining balance (`剩余额度：¥X`) plus "how many more tasks the current model can run".
- **Detail panel** — per-model rows: remaining tasks, or "no usage recorded" / "less than 1 task left, time to top up".
- **Refresh** — re-pull the balance and re-fold usage on demand.

## Packages

| Package | Plane | Role |
| --- | --- | --- |
| [`packages/llm-billing`](packages/llm-billing) — `@deepseek-ai/dsh-llm-billing` | Host | Owns the `/user/balance` transport, the cross-session per-model token fold, and the peak/off-peak pricing table. Exposes the `billing` Remote (`getBalance`, `getEstimate`). |
| [`packages/ui-billing`](packages/ui-billing) — `@deepseek-ai/dsh-client-ui-billing` | Browser | Mounts its own `billing` Remote and contributes the session-header badge. |

## Prerequisites

- **DeepSeek Harness** (`dsh`) — the plugin runs inside a dsh profile.
- **A DeepSeek API key** — balance is read from the DeepSeek API, so each user needs their own key.

## Install

Install the two packages into a profile, wire them into the composition, and set the key.

### 1. Install the packages

```bash
dsh plugin --profile web add @deepseek-ai/dsh-llm-billing @deepseek-ai/dsh-client-ui-billing
```

> The packages live in this repo's `packages/` workspace; publish them to npm
> (under `@deepseek-ai` or your own scope) before `dsh plugin add` can resolve
> them from the registry.

### 2. Wire them into the composition

Edit `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: llm-billing
      name: '@deepseek-ai/dsh-llm-billing'
    - id: ui-billing
      name: '@deepseek-ai/dsh-client-ui-billing'
```

### 3. Set your DeepSeek API key

Either store it through the Web **Models** page (writes `DEEPSEEK_API_KEY` to `~/.dsh/.credentials.yaml`), or export it:

```bash
export DEEPSEEK_API_KEY=sk-...
```

### 4. Restart

```bash
dsh web
```

## Configuration

Both packages default to sensible values; everything below is optional.

### Host (`llm-billing`)

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4 Pro | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing) | Peak-hour windows; all other hours are off-peak. |
| `billing.models` | Published V4 rates | Per-model peak/off-peak price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens). |

### How the estimate works

- **1 task = 1 session.** Every reachable session (live + persisted) is folded once, deduplicated by session id.
- Each model accumulates three billed-token buckets: **cache-hit input**, **cache-miss input** (uncached input plus cache writes), and **output** (reasoning included).
- The per-model average per session is priced at the **current peak/off-peak** rate, giving an average cost per task.
- `tasksRemaining = floor(CNY balance ÷ average cost per task)`. A model with no history, no price row, or a non-CNY balance reports no estimate.

Pricing follows the DeepSeek rates **effective August 17** (peak/off-peak windows in Beijing time).

## Known limitations

- **CNY only** — the estimate reads the CNY balance line; a non-CNY balance reports no estimate.
- **On-demand fold** — usage is folded on every call, so cost grows with session count and log size.
- **Estimate, not a promise** — it converts balance against historical average usage; actual billing is the provider's.

## License

[MIT](LICENSE)
