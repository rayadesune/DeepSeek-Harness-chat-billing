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

The plugin registers the `billing` Remote with seven methods: `getBalance(force?)` (the parsed `/user/balance` snapshot; a snapshot younger than the 15-second host TTL is reused, `force` bypasses it, and each request aborts after 5 seconds), `getSessionSpend(sessionId)` (one session's billed cost), `getTodaySpend(force?)` (every session's billed cost on the current Beijing-time calendar day; `force` bypasses the host-side cache, for the badge's manual refresh), `getTodaySessionsSpend(force?)` (today's billed cost per conversation, sorted by cost descending, each row carrying the session's durable title and its own share of the day — see [Subagent sessions](#subagent-sessions-ride-their-parents-row)), `getDelegatedSpend(sessionId, force?)` (the subagent part of one conversation — see [Subagent sessions](#subagent-sessions-ride-their-parents-row)), `getTurnSpend(sessionId, messageId)` (one completed turn's billed cost, located by its closing assistant message id), and `getSessionTurnSpends(sessionId)` (every completed turn's cost as a `messageId → total` map, folded in one pass — the transcript renders one row per message, so the client fetches this once per session instead of calling `getTurnSpend` per row). The spend prices each provider-reported usage sample — an `assistant/message`'s usage, or a failed/retried `assistant/attempt`'s stream usage, priced with the model of the latest `request/header` — at the official rate revision in effect at the sample's own timestamp, classified peak/off-peak by its own Beijing-time hour. Peak windows apply weekdays (Monday–Friday) only, and weekends are always off-peak. A sample for the same `(turn, step)` replaces the earlier one and `llm/retry-started` makes the retried attempt add, matching DSH's own turn-usage disclosure; costs then sum per model. A turn is the `turn/start`..`turn/end` range holding the closing message; the ranking folds each session's title from its latest `session/title` event (last-wins, so a rename is reflected as soon as its event commits and the session is re-read).

### Today-spend read path (no full scans per message)

`getTodaySpend()` never scans every session log per request. A 60-second Beijing-day cache with in-flight coalescing serves message-triggered reads, and **stale-while-revalidate** takes the wait out of the rest: once the window lapses, a plain reader holding a value for the queried day is answered from that value immediately while the scan runs behind it, so a session switch never waits on the day's whole-session scan. A **forced** read blocks for the new value instead — that is the manual refresh, and the badge's post-turn recompute, which has just changed the answer and must not be handed the value from before it (a plain read there would report each turn's cost one turn late). A day with no value yet (the first read, or a Beijing-day rollover: yesterday's total is never served as today's) waits too, because there is nothing honest to show. The window is stamped when a scan **completes**, not when it starts: a pass slower than its own TTL would otherwise be born expired and every read after it would start another pass back-to-back. Behind a miss, one scan produces the aggregate, the ranking, AND the whole-session totals the delegated read sums (the aggregate is the sum of the ranking rows):

- **Projection path** (used when `@deepseek-ai/dsh-session-projection` is composed): the plugin registers the client-visible `billingTodaySpend` projection unit — eagerly, as soon as the registry exists, so DSH's write-behind checkpoints a row for every session at each `turn/end`. Live sessions are read from their eager cells with zero log I/O; a cold session is answered from the projection cache's zero-I/O `cachedSnapshot` row whenever that row's own latest priced day is not the queried day, and only otherwise (or when no usable row exists) inspected and folded locally. Only sessions whose persisted revision changed since the last resolution are touched, and a failed resolution is remembered by revision instead of being retried on every scan.
- **Events path** (fallback without the registry): folds each session's log with the same pricing fold (Beijing-day filter during collection, 200 000-event cap). A session whose persisted revision is unchanged is answered from the fold this scanner already priced for that exact revision instead of being re-read, and a pass cut short by the event cap remembers nothing — so the next one re-reads what it cut short.

Both paths therefore treat the revision gate as a **cache, never as a filter**: an unchanged log costs no I/O and still contributes its full spend and title to the aggregate and the ranking on every scan. A gate that skipped an unchanged session without adopting the resolution it already held would silently shrink today's total (and drop ranking rows) on every scan after the first — the projection path avoids that with its resolved-unit memory, the events path with the same memory now shared by both.

After the first resolution per process, steady-state reads cost only the sessions whose logs actually changed. A session whose log cannot be read is skipped with a warning (and remembered) instead of failing the whole day's total.

Both paths fold **synchronously on the host's main loop** — the same loop that serves the GUI's own round trips (switching model, creating a session) — so a scan hands that loop back every `SCAN_YIELD_SESSIONS` (8) sessions, and the cold fan-out yields on the same cadence (`yieldToEventLoop`). A scan that never yielded held the loop for its entire duration, which is what made those two actions appear frozen while a cold scan ran.

Note: the projection path prices a session's history once, at the rates in effect when its events were folded. Published rate revisions travel inside the pricing closure and are resolved per sample timestamp, so a re-priced series bills its own history correctly however late a log is folded; only a configuration change (editing `billing.models`) re-prices just the events folded afterwards (the events path re-prices the whole log), and the unit's `stateVersion` is bumped whenever that resolution changes so checkpointed rows are refolded instead of kept.

### Subagent sessions ride their parent's row

A subagent child is work the delegating conversation paid for, not a session the user opened, so the day's ranking lists **conversations**: every subagent row is folded into the row of the top-level session at the root of its `parentSession` chain before the rows are sorted. DSH stamps a child's durable header with `origin: 'subagent'`, the delegating session's id, and a `delegationDepth` of parent depth + 1 (both markers are read structurally, so either one alone identifies a child); a multi-generation delegation therefore lands on the same root row. A **user fork** carries `parentSession` too but neither subagent marker, and stays a row of its own.

Each merged row reports two amounts: `total` is the conversation's whole day (the session plus every subagent it delegated, transitively) and `ownTotal` is the session's own spend, equal to `total` when no descendant priced anything that day. The day **aggregate** (`getTodaySpend`) is unchanged: it sums the same sessions either way, so the roll-up never moves money between totals — it only regroups rows. A top-level session whose own day was empty but whose subagents priced something still gets a row (`ownTotal` 0), titled from its log when the scan resolved it.

The browser needs the same conversation view for a whole day's or a whole log's worth of spend, and a session's own log cannot price its delegation children — so `getDelegatedSpend(sessionId)` returns that subtree: every subagent session the given session delegated, transitively, summed across every day its log covers, with per-model rows merged so a breakdown still adds up. It is served from the SAME cached pass as today's spend (the scan folds each session's whole-session total anyway, so this costs no second read), and it also reports `isSubagent` — whether the queried session is itself a delegated child, whose spend therefore rides the ranking row of the session that delegated it. A user fork is never counted as a delegated child (it carries `parentSession` but no subagent marker).

The badge shows that subtree added to the session's own live spend: `本会话花费` therefore reads as the **conversation's** amount (the chip and the panel carry the same label). The same read also reports `crossedDay` — whether the queried session was created before the current Beijing day — which is what gates the panel's parenthesized today share: the share reads the ranking row's `total` (merged against merged, both counting the same tree), but whether it is shown at all depends on that creation day rather than on comparing two amounts, because the live session figure and the 60-second-cached ranking row differ mid-turn by design.

## Forked sessions

A forked session (DSH's "fork" of a conversation) opens its log with a verbatim copy of its source session's events. Without special handling, the same model outputs would be billed once per copy: the child's session spend would include the inherited prefix, and today's spend would count it a second time alongside the parent's. The plugin prices only a session's OWN events — the fork boundary is the session's persisted state (`header.seedLength` on the ≤ 0.1.1-rc.2 runtime, `Session.inheritedEventCount` (live) / `SessionHandle.inheritedEventCount` (the opened handle) on 0.1.2-alpha.4+, both read structurally). The `billingTodaySpend` unit is boundary-aware (its state carries the cut and `apply` skips events below it), so the eager cell is correct for a fork child; the cold path skips the projection cache for a seeded session and folds its own events with the durable cut. Fork children are therefore billed from their first new exchange onward (a freshly forked session prices to zero), today's spend counts each model output exactly once, and the same lineage-safe rule covers multi-generation forks and subagent forks (spawned with `context: 'fork'`). The boundary is the persisted value, so a resumed fork child keeps its original boundary, while a session created without a seed — ordinary sessions and cold resumes included — carries no boundary and is billed in full.

## Runtime compatibility

Since 0.1.2-alpha.4, DSH replaced the live `Session` log surface `Session.events` with `Session.snapshotEvents()` (no args = the full current log) and `Session.ownEvents()`, and moved `SessionHeader.seedLength` to `Session.inheritedEventCount` (live) / `SessionHandle.inheritedEventCount` (the handle the persistence `open(id, 'read')` returns). Every log read in the plugin goes through the structural adapters `liveSessionEvents` / `forkBoundaryOf` / `isSeededSession`: the live surface is the one that kept both shapes — `liveSessionEvents` still accepts the ≤ 0.1.1-rc.2 `events` snapshot and the 0.1.2-alpha.4+ `snapshotEvents()` reader — while `forkBoundaryOf` prefers the exact `inheritedEventCount` (live or handle) and otherwise falls back to the durable `header.seedLength`, so the npm release baseline (`^0.1.7-alpha.2`) and the ahead-of-npm monorepo runtime both work without modification. On an unknown surface that has neither shape the plugin fails loudly rather than silently pricing an empty log. The ranking's lineage read is structural in the same way: a header that carries neither `origin: 'subagent'` nor a non-zero `delegationDepth` (an older log, or a session created without them) simply reads as a top-level session and keeps its own row.

The persistence service is handle-based only: it exposes `open(id, 'read')` + `SessionHandle.read()` / `list()` (DSH 0.1.2-alpha.5+, the single family the plugin's `^0.1.7-alpha.2` peer targets). The scanner reads this one surface through `persistenceInspect` / `persistenceListSnapshots` — `persistenceListSnapshots` is a thin call to `list()`, and `persistenceInspect` opens the handle, reads, and closes it in a `finally` block (so the handle always closes, including after a failed read). The legacy `inspect(id)` / `listSnapshots()` surface was removed (Item 7), so production now serves only the handle family. `SessionHandle.read()` itself still has two return shapes — the bare event array, and since DSH `9b78f99dec` (0.1.5-alpha.1) `{ eventState, events }`; `handleReadEvents` unwraps both, so a cold read survives that generation change.

The projection-cache reader likewise targets the current seam: `cachedSnapshot(header, inheritedEventCount, keys)` (zero I/O, wire rows only). Its predecessor, an async `coldSnapshot(id)` that read the log itself, no longer exists, so the plugin never depends on it.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4.1 Flash (`deepseek-flash`) + V4 Flash + V4 Pro + V4 Flash Vision Exp + MiMo-V2.5/V2.6 series | Advisory display rows, in presentation order; they mirror DSH's `llm-deepseek` catalog (plus the retired `deepseek-v4.1-flash-expires-on-0910` preview id, kept for readable historical labels). |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing, weekdays) | Peak-hour windows, applied weekdays (Mon–Fri) only; weekends and all other hours are off-peak. |
| `billing.models` | Published V4 + MiMo rates | Per-model price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens) with an optional inclusive `effectiveFrom` (epoch ms). |

Override one model without dropping the others by supplying a non-empty `billing.models` list; an empty or omitted list falls back to the published defaults. Several rows may share one model: each row is a rate revision, and a usage sample is priced at the peak/off-peak pair of the revision in effect at the sample's own timestamp (a row without `effectiveFrom` is that model's base revision and also covers every earlier instant).

The published table already ships DeepSeek's adjustments, so a session or a day spanning a change is priced exactly:

- **2026-09-10 12:00 Beijing** (`FLASH_SERIES_RATE_CHANGE_AT`): the whole flash series — the V4.1 Flash route `deepseek-flash` (released that day and now DSH's default), V4 Flash, V4 Flash Vision Exp, and the retired preview id — drops to off-peak 0.02 / 1.0 / 4.0 with peak at twice those prices. Earlier samples, including this route's own usage from before that instant, keep the superseded rates.
- **2026-09-14 12:00 Beijing** (`V4_PRO_ROUTE_SWITCH_AT`): the V4 Pro route is announced to be served by V4.1 Flash and billed at the V4.1 Flash rates; its row carries that second revision.
- MiMo-V2.5 and V2.6 series: untouched by either adjustment (flat rate; V2.6 shipped 2026-09-22 at V2.5’s published rates).

## Plugin manager metadata

The plugin manager shows this package's row with a localized title and description plus an icon, all read from the package itself (the host evaluates no plugin code):

- `locale/en.json` and `locale/zh.json` — `{"meta": {"title": …, "description": …}}`, resolved against the active interface language with English as the fallback.
- `icon.svg` — a self-contained SVG (no external font or image references), declared as the package's top-level `icon` field.

Both are resolved through the package's `exports` map, so `./locale/*.json` must stay exported — dropping it makes the locale files resolve to `ERR_PACKAGE_PATH_NOT_EXPORTED`, which the host treats as "no metadata" and silently falls back to the bare package name. `locale/*.json` and `icon.svg` must also stay in `files`, or a packed tarball ships neither.

## Model Experience

None, as this package is a read-only Remote projection of provider and session facts and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; its only provider call is a credential-authenticated `/user/balance` read, which is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row; a model without a rate row is omitted. An `assistant/attempt` is priced with the model of the latest `request/header`, so an attempt before any header contributes nothing.
- **A merged row can be untitled** — a subagent whose parent session is not part of the scan (a deleted or archived parent log, for instance) is still attributed to the parent id its own header names, but that parent's log is never read, so the merged row reports no title and the browser shows its untitled fallback.
- **Up-to-60s staleness, never an unasked wait** — `getTodaySpend()` is served from the host-side cache for up to 60 seconds; past that window a plain read gets the last value at once and the scan runs behind it, so a reader never waits for the day's scan unless it asked to. A forced read (the manual refresh, and the badge's post-turn recompute) waits for a fresh recompute — still revision-gated, so an unchanged log costs nothing. The browser reads the live per-session value from the pushed projection instead, so the session line is never stale; the parenthesized today share on that same line comes from the already-fetched today-session ranking (`getTodaySessionsSpend()`, under the same 60-second cache and revision gate), so that one number can trail by up to 60 seconds.
- **Balance is TTL-cached** — one `/user/balance` snapshot is reused for up to 15 seconds and each request aborts after 5 seconds; `force` (the manual refresh) bypasses the TTL.
- **Projection pricing follows the published revisions** — the projection fold resolves the rate revision per sample timestamp, so published re-pricing needs no refold; a hand-edited `billing.models` change prices only events folded after the change until the state version or the process is reset (the events fallback re-prices the full log).
- **A cached cold row may trail its log** — a cold session whose cached row covers the queried day is re-read from the log for exactness; a row whose own day is not the queried day is trusted without a read, so a session that crashed between its last checkpoint and its last event can under-report that tail until it is next read.
