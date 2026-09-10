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

The plugin registers the `billing` Remote with six methods: `getBalance(force?)` (the parsed `/user/balance` snapshot; a snapshot younger than the 15-second host TTL is reused, `force` bypasses it, and each request aborts after 5 seconds), `getSessionSpend(sessionId)` (one session's billed cost), `getTodaySpend(force?)` (every session's billed cost on the current Beijing-time calendar day; `force` bypasses the host-side cache, for the badge's manual refresh), `getTodaySessionsSpend(force?)` (today's billed cost per session, sorted by cost descending, each row carrying the session's durable title), `getTurnSpend(sessionId, messageId)` (one completed turn's billed cost, located by its closing assistant message id), and `getSessionTurnSpends(sessionId)` (every completed turn's cost as a `messageId → total` map, folded in one pass — the transcript renders one row per message, so the client fetches this once per session instead of calling `getTurnSpend` per row). The spend prices each provider-reported usage sample — an `assistant/message`'s usage, or a failed/retried `assistant/attempt`'s stream usage, priced with the model of the latest `request/header` — at the official rate revision in effect at the sample's own timestamp, classified peak/off-peak by its own Beijing-time hour. Peak windows apply weekdays (Monday–Friday) only, and weekends are always off-peak. A sample for the same `(turn, step)` replaces the earlier one and `llm/retry-started` makes the retried attempt add, matching DSH's own turn-usage disclosure; costs then sum per model. A turn is the `turn/start`..`turn/end` range holding the closing message; the ranking folds each session's title from its latest `session/title` event (last-wins, so a rename is reflected as soon as its event commits and the session is re-read).

### Today-spend read path (no full scans per message)

`getTodaySpend()` never scans every session log per request. A 60-second Beijing-day cache with in-flight coalescing serves message-triggered reads; only the manual refresh (`force`) bypasses the time window. Behind a miss, one scan produces BOTH the aggregate and the ranking (the aggregate is the sum of the rows):

- **Projection path** (used when `@deepseek-ai/dsh-session-projection` is composed): the plugin registers the client-visible `billingTodaySpend` projection unit — eagerly, as soon as the registry exists, so DSH's write-behind checkpoints a row for every session at each `turn/end`. Live sessions are read from their eager cells with zero log I/O; a cold session is answered from the projection cache's zero-I/O `cachedSnapshot` row whenever that row's own latest priced day is not the queried day, and only otherwise (or when no usable row exists) inspected and folded locally. Only sessions whose persisted revision changed since the last resolution are touched, and a failed resolution is remembered by revision instead of being retried on every scan.
- **Events path** (fallback without the registry): folds each session's log with the same pricing fold (Beijing-day filter during collection, 200 000-event cap), skipping sessions whose persisted revision is unchanged.

After the first resolution per process, steady-state reads cost only the sessions whose logs actually changed. A session whose log cannot be read is skipped with a warning (and remembered) instead of failing the whole day's total.

Note: the projection path prices a session's history once, at the rates in effect when its events were folded. Published rate revisions travel inside the pricing closure and are resolved per sample timestamp, so a re-priced series bills its own history correctly however late a log is folded; only a configuration change (editing `billing.models`) re-prices just the events folded afterwards (the events path re-prices the whole log), and the unit's `stateVersion` is bumped whenever that resolution changes so checkpointed rows are refolded instead of kept.

## Forked sessions

A forked session (DSH's "fork" of a conversation) opens its log with a verbatim copy of its source session's events. Without special handling, the same model outputs would be billed once per copy: the child's session spend would include the inherited prefix, and today's spend would count it a second time alongside the parent's. The plugin prices only a session's OWN events — the fork boundary is the session's persisted state (`header.seedLength` on the ≤ 0.1.1-rc.2 runtime, `Session.inheritedEventCount` / `inspect().inheritedEventCount` on 0.1.2-alpha.4+, both read structurally). The `billingTodaySpend` unit is boundary-aware (its state carries the cut and `apply` skips events below it), so the eager cell is correct for a fork child; the cold path skips the projection cache for a seeded session and folds its own events with the durable cut. Fork children are therefore billed from their first new exchange onward (a freshly forked session prices to zero), today's spend counts each model output exactly once, and the same lineage-safe rule covers multi-generation forks and subagent forks (spawned with `context: 'fork'`). The boundary is the persisted value, so a resumed fork child keeps its original boundary, while a session created without a seed — ordinary sessions and cold resumes included — carries no boundary and is billed in full.

## Runtime compatibility

Since 0.1.2-alpha.4, DSH replaced the live `Session` log surface `Session.events` with `Session.snapshotEvents()` (no args = the full current log) and `Session.ownEvents()`, and moved `SessionHeader.seedLength` to `Session.inheritedEventCount` (the persistence `inspect()` result carries the value beside `meta`; `listSnapshots()` headers keep only the boolean `isSeeded`). Every log read in the plugin goes through the structural adapters `liveSessionEvents` / `forkBoundaryOf` / `isSeededSession`, which accept both the ≤ 0.1.1-rc.2 and the 0.1.2-alpha.4+ shapes — the npm release baseline (`^0.1.2-alpha.5`) and the ahead-of-npm monorepo runtime both work without modification. On an unknown surface that has neither shape the plugin fails loudly rather than silently pricing an empty log.

The persistence service itself changed surface too: 0.1.1-rc.2 exposes `inspect(id)` / `listSnapshots()`, while the handle-based seam exposes `open(id, 'read')` + `SessionHandle.read()` / `list()`. The scanner reads both families through `persistenceInspect` / `persistenceListSnapshots` (the handle is always closed, including after a failed read), so the same plugin serves the published alpha line and the refactored checkout. `SessionHandle.read()` itself has two generations: it first returned the bare event array, and since DSH `9b78f99dec` (in the 0.1.5-alpha.1 checkout) it returns `{ eventState, events }`; `handleReadEvents` unwraps both, so a cold read keeps working across the change.

The projection-cache reader likewise targets the current seam: `cachedSnapshot(header, inheritedEventCount, keys)` (zero I/O, wire rows only). Its predecessor, an async `coldSnapshot(id)` that read the log itself, no longer exists, so the plugin never depends on it.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4.1 Flash + V4 Pro + V4 Flash Vision Exp + MiMo-V2.5 series | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing, weekdays) | Peak-hour windows, applied weekdays (Mon–Fri) only; weekends and all other hours are off-peak. |
| `billing.models` | Published V4 + MiMo rates | Per-model price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens) with an optional inclusive `effectiveFrom` (epoch ms). |

Override one model without dropping the others by supplying a non-empty `billing.models` list; an empty or omitted list falls back to the published defaults. Several rows may share one model: each row is a rate revision, and a usage sample is priced at the peak/off-peak pair of the revision in effect at the sample's own timestamp (a row without `effectiveFrom` is that model's base revision and also covers every earlier instant). The published table already ships the DeepSeek adjustment of **2026-09-10 12:00 Beijing** (`FLASH_SERIES_RATE_CHANGE_AT`): the V4 Flash series drops to off-peak 0.02 / 1.0 / 4.0 with peak at twice those prices, while V4 Pro and the MiMo-V2.5 series keep the rates effective 2026-08-17. Samples before that instant keep the superseded rates, so a session or a day spanning the change is priced exactly.

## Model Experience

None, as this package is a read-only Remote projection of provider and session facts and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; its only provider call is a credential-authenticated `/user/balance` read, which is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row; a model without a rate row is omitted. An `assistant/attempt` is priced with the model of the latest `request/header`, so an attempt before any header contributes nothing.
- **Up-to-60s staleness** — `getTodaySpend()` is served from the host-side cache for up to 60 seconds; only the manual refresh (`force`) recomputes immediately (still revision-gated, so an unchanged log costs nothing). The browser reads the live per-session value from the pushed projection instead, so the session line is never stale.
- **Balance is TTL-cached** — one `/user/balance` snapshot is reused for up to 15 seconds and each request aborts after 5 seconds; `force` (the manual refresh) bypasses the TTL.
- **Projection pricing follows the published revisions** — the projection fold resolves the rate revision per sample timestamp, so published re-pricing needs no refold; a hand-edited `billing.models` change prices only events folded after the change until the state version or the process is reset (the events fallback re-prices the full log).
- **A cached cold row may trail its log** — a cold session whose cached row covers the queried day is re-read from the log for exactness; a row whose own day is not the queried day is trusted without a read, so a session that crashed between its last checkpoint and its last event can under-report that tail until it is next read.
