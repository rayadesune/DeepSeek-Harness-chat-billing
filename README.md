# DeepSeek Harness billing plugin

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows your **DeepSeek account balance**, **this session's (this conversation's) billed spend**, and **today's total spend across all sessions** directly in the web session header.

> The balance is the real `GET /user/balance` figure; the session and today spends price each message's billed tokens at the official peak/off-peak rates and are estimates, not billing promises.

## What it shows

- **Session-header badge** — two lines: remaining balance (`剩余额度：¥X`) and this conversation's billed spend (`本轮对话花费：¥X`).
- **Detail panel** — the remaining amount, this session's spend (`本会话花费`) with today's all-session spend beside it (`今日共花费`), one priced row per model (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), plus a manual refresh action and a spend disclaimer.
- **Failures and empty states** — a session or day without priced usage shows "no usage recorded" instead of a fabricated figure; a missing key, rejected credential, or transport error renders a muted "Balance unavailable" whose tooltip carries the Remote's own error message.

## Data update mechanics

- **Session spend follows the conversation** — on every new message in the current session, the badge recomputes only **this session's spend** and **today's spend** (purely local pricing, no network request), so the spend lines stay live during an ongoing conversation.
- **Balance stays manual** — the balance is account-level data, queried only on mount, session switch, the manual refresh action, or a browser reload; **there is no polling** and it does not track account changes by itself.
- **Old values survive refreshes** — a failed refresh keeps the last good value instead of blanking it.

## Preview
<img width="505" height="264" alt="image" src="billing-preview.png" />


## Package layout

| Package | Side | Role |
| --- | --- | --- |
| [`packages/llm-billing`](packages/llm-billing) — `@rayadesu/dsh-llm-billing` | Host | Owns the `/user/balance` transport and the peak/off-peak pricing table. Exposes the `billing` Remote (`getBalance`, `getSessionSpend`, `getTodaySpend`). |
| [`packages/ui-billing`](packages/ui-billing) — `@rayadesu/dsh-client-ui-billing` | Browser | Mounts the `billing` Remote itself and contributes the session-header badge and detail panel. |

## Prerequisites

- **DeepSeek Harness** (`dsh`) — the plugin runs inside a dsh profile.
- **A DeepSeek API key** — the balance is read from the DeepSeek API, so every user needs their own key.

## Installation

> 📌 **About this repository**: this repo is the plugin's **only distribution
> source** — the official [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
> repository does **not** ship the billing plugin. It was briefly integrated into
> this user's fork, which has since been reverted to the official commit
> (`141eb6fef8`); this repo no longer depends on any fork.

### Installation (published to npm, one command)

The three packages are published to npm under the `@rayadesu` scope. Install
the bundle plus the two plugin packages in one command (the bundle declares the
two plugin packages as peer dependencies, which pnpm does not auto-install into
the profile, so they must be named explicitly):

```bash
dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
```

Manual rows (only when you do not want the bundle):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: llm-billing
      name: '@rayadesu/dsh-llm-billing'
    - id: ui-billing
      name: '@rayadesu/dsh-client-ui-billing'
```

### Dependency notes

The two plugin packages declare the DeepSeek Harness packages they build on
(`@deepseek-ai/cordis`, `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-session`,
and the client runtime packages) as `peerDependencies` at `^0.1.0-rc.8`. A dsh
profile does not auto-install peers, so these are provided by the dsh
installation itself through the `profiles/node_modules` fallback rather than
fetched from the registry — no extra packages to install, and no registry token
needed on the installing machine.

### Configure your DeepSeek API key

Either fill it in on the web "Models" page (writes `DEEPSEEK_API_KEY` into `~/.dsh/.credentials.yaml`), or export it:

```bash
export DEEPSEEK_API_KEY=sk-...
```

### Restart

```bash
dsh web
```

## Configuration

Both packages ship sane defaults; everything below is optional.

### Host (`llm-billing`)

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4 Pro + V4 Flash Vision Exp | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing) | Peak-hour windows; all other hours are off-peak. |
| `billing.models` | Published V4 rates | Per-model peak/off-peak price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens). |

## How session spend is computed

- Each `assistant/message` event reports three billed token buckets: **cache-hit input**, **cache-miss input** (uncached input + cache writes), and **output** (including reasoning).
- Each message is priced at the peak/off-peak rate of its own **Beijing-time** hour, the three buckets are billed separately (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), then summed per model.
- **Today's spend** aggregates every session's events on the current Beijing-time calendar day with the same pricing rules; event dates are also assigned in Beijing time.
- Models without a rate row are not priced (the built-in catalog currently has the three V4 rows: V4 Flash, V4 Pro, and V4 Flash Vision Exp). Rates follow the DeepSeek pricing effective **August 17** (Beijing-time peak/off-peak hours).

## Known limitations

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row.
- **On-demand read** — today's spend reads every session's full event log on each refresh, so cost grows with total log size.
- **Balance does not follow automatically** — the balance stays a manual snapshot (no polling); spending from another client does not move the shown value until a refresh or browser reload.
- **Estimate, not a promise** — the session spend prices tokens at official rates; the provider's actual billing prevails.

## License

[MIT](LICENSE)
