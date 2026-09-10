# DeepSeek Harness billing plugin

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows your **DeepSeek account balance**, **this session's (this conversation's) billed spend**, and **today's total spend across all sessions** directly in the web session header; each completed turn also shows its **turn cost** as a static amount at the end of the message actions row, and the detail panel ends with a **today session-spend ranking**.

> The balance is the real `GET /user/balance` figure; the session, turn, and today spends price each message's billed tokens at the official peak/off-peak rates and are estimates, not billing promises.

## What it shows

- **Session-header badge** — two lines: remaining balance (`剩余额度：¥X`) and this conversation's billed spend (`本轮对话花费：¥X`).
- **Detail panel** — the remaining amount, this session's spend (`本会话花费`) with today's all-session spend beside it (`今日共花费`), one priced row per model (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), plus a manual refresh action and a spend disclaimer. The panel ends with a **today session-spend ranking**: sessions sorted by today's spend, highest first (names come from the log's Chinese titles and follow renames automatically; at most the top 10 rows, with a "…N more sessions" hint).
- **Turn cost amount** — each completed turn's closing message shows a plain static `¥X` at the **end** of the actions row, after the clock: non-interactive (no icon, no "cost" word, no card), its typography replicates the clock text (13px secondary tier, tertiary tone, nowrap), and it is **always visible** (not hover-revealed like the clock text — the row's own hover reveal shows both together); turns without DeepSeek usage (zero cost) or failed loads stay hidden.
- **Failures and empty states** — a session or day without priced usage shows "no usage recorded" instead of a fabricated figure; a missing key, rejected credential, or transport error renders a muted "Balance unavailable" whose tooltip carries the Remote's own error message.

## Data update mechanics

- **Session spend follows the conversation** — the host prices every committed event into a per-session projection (`billingTodaySpend`) and pushes it to the browser, so **this session's spend** updates live with no Remote call; the Remote read remains the fallback when the projection registry is absent. **Today's spend** is recomputed on turn settle (one shared scan serves both the aggregate and the ranking), and each turn's cost comes from **one batch fetch per session** instead of one call per rendered message.
- **Balance is cached, not polled** — the host reuses one `/user/balance` snapshot for 15 seconds (manual refresh forces a fresh one) and caps each request at 5 seconds; the browser keeps the last settled value so a session switch renders the amount immediately and revalidates in the background. There is still no polling.
- **Old values survive refreshes** — a failed refresh keeps the last good value instead of blanking it.

## Preview

A real session: the session-header badge, the detail panel (remaining amount, this session's spend next to today's all-session spend, per-model breakdown, and the today session-spend ranking), plus the turn-cost amount at the end of the message actions row:

<img width="1200" alt="Billing plugin overview: session header badge, detail panel with per-model rows and today's session ranking, and the turn-cost row" src="preview-overview.png" />

Close-up of the detail panel — the `API 剩余金额` figure, `本会话花费` next to `今日共花费`, the per-model breakdown (`缓存命中 · 未命中输入 · 输出`), and the today session-spend ranking:

<img width="640" alt="Detail panel close-up: API remaining amount, this session's spend next to today's all-session spend, per-model rows and today's session ranking" src="preview-detail.png" />

Close-up of the turn-cost amount — the static `¥` amount at the end of the actions row, after the clock:

<img width="640" alt="Turn-cost amount close-up: the static ¥ amount at the end of the actions row, after the clock" src="preview-turn-cost.png" />


## Package layout

| Package | Side | Role |
| --- | --- | --- |
| [`packages/llm-billing`](packages/llm-billing) — `@rayadesu/dsh-llm-billing` | Host | Owns the `/user/balance` transport and the peak/off-peak pricing table. Exposes the `billing` Remote (`getBalance(force?)`, `getSessionSpend`, `getTodaySpend`, `getTodaySessionsSpend`, `getTurnSpend`, `getSessionTurnSpends`) and registers the client-visible `billingTodaySpend` projection unit. |
| [`packages/ui-billing`](packages/ui-billing) — `@rayadesu/dsh-client-ui-billing` | Browser | Mounts the `billing` Remote itself and contributes the session-header badge and detail panel, plus the static turn-cost amount at the end of the message actions strip. |

## Prerequisites

- **DeepSeek Harness** (`dsh`) — the plugin runs inside a dsh profile.
- **A DeepSeek API key** — the balance is read from the DeepSeek API, so every user needs their own key.

## Installation

### Install (published to npm)

The three packages are published to npm under the `@rayadesu` scope. Install the
bundle plus the two plugin packages in one command — the bundle declares the two
plugin packages as peer dependencies, which pnpm does not auto-install into the
profile, so they must be named explicitly.

The `dsh` command you use depends on how dsh is installed:

- **Global install** — use the global `dsh` from anywhere:

  ```bash
  dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
  ```

- **Source-built dsh** (a deepseek-harness checkout) — the CLI only resolves from
  the source directory, so run it through pnpm there (`pnpm dsh` is the
  harness-local binary, equivalent to the global `dsh`):

  ```bash
  cd deepseek-harness
  pnpm dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
  ```

### pnpm 11 release-age gate

A dsh profile installs plugins through pnpm, and pnpm 11's supply-chain
release-age gate does not pick up packages younger than 24 hours by default —
a freshly published version is therefore not resolved immediately. To get the
latest version right after a publish:

- Disable the age gate in the profile's pnpm config:

  ```yaml
  # ~/.dsh/profiles/web/pnpm-workspace.yaml
  minimumReleaseAge: 0
  ```

- Or, within the 24-hour window, install with an explicitly pinned version (an
  explicit pin bypasses the age gate; replace `0.3.0` with the version you want;
  from a source checkout, use `pnpm dsh …` as above):

  ```bash
  dsh plugin --profile web add @rayadesu/dsh-billing@0.3.0 @rayadesu/dsh-llm-billing@0.3.0 @rayadesu/dsh-client-ui-billing@0.3.0
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

### Common commands

Global `dsh` is assumed; a source-built dsh uses `pnpm dsh` from the
deepseek-harness checkout instead — the subcommands are identical.

```sh
dsh plugin --profile web list    # list the web profile's installed plugins
dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
dsh plugin --profile web remove @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
dsh plugin --profile web update  # update plugins to the latest allowed versions
dsh plugin --profile web update --latest  # ignore declared ranges; upgrade every plugin to its newest published version
```

`update` respects the version ranges in the profile's `package.json`, so it
stays within the semver range each plugin declares. Adding `--latest` (a pnpm
`update` flag) instead ignores those ranges and upgrades every plugin to its
newest published version — the way to pick up a fresh release immediately once
it is resolvable. From a source-built dsh checkout you run it as
`pnpm dsh …` in the deepseek-harness directory, exactly as with the other
commands.

### Dependency notes

The two plugin packages declare the DeepSeek Harness packages they build on
(`@deepseek-ai/cordis`, `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-session`,
and the client runtime packages) as `peerDependencies` at `^0.1.2-alpha.5`. A dsh
profile does not auto-install peers, so these are provided by the dsh
installation itself through the `profiles/node_modules` fallback rather than
fetched from the registry — no extra packages to install, and no registry token
needed on the installing machine.

The plugin builds against the 0.1.2-alpha.5 published line and keeps both DSH
runtime families readable: the live `Session` log surface
(`Session.events` + `header.seedLength` at/before 0.1.1-rc.2,
`snapshotEvents()` + `inheritedEventCount` since 0.1.2-alpha.4), and the
persistence service surface (`inspect`/`listSnapshots` at/before 0.1.1-rc.2,
`open`+`SessionHandle`/`list` on the 0.1.2-alpha.5 handle-based seam — the
checkout master that ships the refactor). The projection unit's `init` is
declared with the newer metadata parameters and stays callable as the older
zero-arg shape.

The browser-half tests exercise the published client bundles through the
module-loader shim; since the 0.1.2-alpha.5 client stack split the runtime out
of `dsh-client-runtime` (deleted) into `dsh-client-store`,
`dsh-client-ui-session`, `dsh-client-ui-chat`, and the renderer-owned
`SlotRegistry`, the test harness re-checks registered bundle exports after a
fallback require and pins react copies with a resolve alias. The `assistant-actions`
slot row moved from ui-conversation to ui-chat, so the plugin's client half
pulls the ui-chat type merge too.

### Configure your DeepSeek API key

Either fill it in on the web "Models" page (writes `DEEPSEEK_API_KEY` into `~/.dsh/.credentials.yaml`), or export it:

```bash
export DEEPSEEK_API_KEY=sk-...
```

### Restart

```bash
dsh web
```

## Development

This repository is a standalone pnpm workspace: the plugin packages resolve the
`@deepseek-ai/*` peer packages from npm, so building does not need a full
DeepSeek Harness checkout.

Requirements: Node `^22.19 || >=24` and pnpm.

```sh
pnpm install                 # installs workspace and npm dev dependencies
pnpm run build               # host face (tsc + tsdown + typert artifacts), then client face
pnpm run typecheck           # both compile faces
pnpm run test                # vitest unit/browser tests
pnpm run verify              # pre-publish gate (also runs via prepublishOnly)
```

The host pass regenerates `lib/typert.host.js` and `lib/typert.remote-client.*`
from the package source, keyed by each package.json name; the client pass
rebuilds `lib/client.js`. `lib/` is git-ignored build output — do not hand-edit
it. If a typert manifest ever names a package other than its own
(`TYPERT.package` !== package.json name), the `verify` gate fails before publish.

The typert generator recognizes `Remote`/`TypertRemoteService` only from a
workspace-registered protocol package, so `packages/typert-protocol` vendors
the published `@deepseek-ai/dsh-typert-protocol@0.1.2-alpha.5` declarations; when
the dsh dependency line moves, refresh it from the installed package.

Publishing (the bundle and both plugins share one version; `prepublishOnly`
runs the `verify` gate automatically). Use `npm publish` from **inside each
package directory** — `pnpm publish` fails (token resolution) and a folder
argument like `npm publish packages/llm-billing` is parsed as a GitHub
shorthand, which triggers a bogus `git ls-remote` instead of a publish. The
registry requires a token that bypasses 2FA (an `npm login` session token gets
E403).

**Configure the token once, so it never appears in a command** — put one line
in `~/.npmrc` referencing an environment variable, which npm expands at
publish time:

```ini
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

Then set the variable and `npm publish` plainly — the token is in no argument
and stays out of shell history:

```sh
export NPM_TOKEN=<your npm token>
cd packages/llm-billing && npm publish
cd packages/ui-billing && npm publish
npm publish   # @rayadesu/dsh-billing bundle (repo root)
```

(Alternatively write the real token directly into `~/.npmrc`, e.g.
`npm config set //registry.npmjs.org/:_authToken <TOKEN>`; the commands then
carry no token either. Either way, **never commit the token**.)

## Configuration

Both packages ship sane defaults; everything below is optional.

### Host (`llm-billing`)

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4.1 Flash (`deepseek-flash`) + V4 Flash + V4 Pro + V4 Flash Vision Exp + MiMo-V2.5 series | Advisory display rows, in presentation order; they mirror DSH's `llm-deepseek` catalog. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing, weekdays) | Peak-hour windows, applied weekdays (Mon–Fri) only; weekends and all other hours are off-peak. |
| `billing.models` | Published V4 + MiMo rates | Per-model price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens) with an optional inclusive `effectiveFrom`; several rows sharing a model are its rate revisions. |

## How session spend is computed

- Each `assistant/message` event reports three billed token buckets: **cache-hit input**, **cache-miss input** (uncached input + cache writes), and **output** (including reasoning). A failed or retried `assistant/attempt` reports its usage only in its embedded stream; that sample is priced too (with the model of the latest `request/header`), a later sample for the same `(turn, step)` **replaces** the earlier one, and `llm/retry-started` makes the retried attempt **add** — the same accounting DSH's own turn-usage disclosure uses.
- Each sample is priced at the peak/off-peak rate of its own **Beijing-time** hour — and of the rate revision in effect at its own timestamp — the three buckets are billed separately (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), then summed per model. Peak windows apply weekdays (Monday–Friday) only; weekends are always off-peak.
- **Today's spend** aggregates every session's events on the current Beijing-time calendar day with the same pricing rules; event dates are also assigned in Beijing time.
- **Turn cost** prices the events inside the turn's `turn/start`..`turn/end` range with the same rules (located by the closing message's session id + message id), folded in one pass for the whole session and served as a `messageId → cost` map.
- **Today session ranking** aggregates today's spend per session with the same rules (a cross-day session counts only today's part), sorted descending; names come from the log's latest `session/title` event (the auto-generated Chinese title or a user rename).
- Models without a rate row are not priced (the built-in table covers the DSH `llm-deepseek` catalog — V4.1 Flash `deepseek-flash`, V4 Flash, V4 Pro, V4 Flash Vision Exp — plus the retired `deepseek-v4.1-flash-expires-on-0910` preview id and the MiMo-V2.5 series; every flash-series route shares the same pair). Each sample takes the rate revision in effect at its own timestamp: the base schedule is the DeepSeek pricing effective **August 17**; the **flash series** (V4.1 Flash, V4 Flash, V4 Flash Vision Exp, and the retired id) was re-priced effective **September 10, 12:00 Beijing time** to off-peak 0.02 / 1.0 / 4.0 CNY per 1M tokens with peak at twice those prices — samples from before that instant, the V4.1 Flash route's own earlier usage included, keep the superseded rates; the **V4 Pro** route is announced to switch to V4.1 Flash and its rates on **September 14, 12:00 Beijing time**; the MiMo-V2.5 series is untouched. The weekend-off-peak rule (weekends billed at off-peak prices all day) follows the adjustment effective **August 23**.

## Known limitations

- **Priced rows only** — the session, turn, and today spends only price models that have a `billing.models` row.
- **On-demand aggregation** — today's spend and the session ranking are computed on the host behind a 60-second cache and share ONE scan; a miss resolves live sessions from their eager projection cells and cold sessions from the zero-I/O projection-cache row when that row's own day is not the queried one, reading a log only for sessions whose persisted revision changed (or whose cached row covers the queried day). A failed resolution is remembered by revision instead of being retried every scan.
- **Ranking is fetched on demand** — the panel loads the ranking when it is opened (and on refresh), so a badge that stays closed never pays for the all-session scan.
- **Ranking capped at 10** — the panel shows at most the top 10 sessions, with a "…N more sessions" hint.
- **Turn cost needs a finalized closing message** — interrupted turns have no actions row, so no turn cost; cold sessions served straight from the projection cache may rank with an "Untitled" name until their log is read again.
- **Balance is TTL-cached** — the host reuses one snapshot for up to 15 seconds and each request aborts after 5 seconds; spending from another client does not move the shown value until the TTL expires, a manual refresh, or a browser reload (there is no polling).
- **Estimate, not a promise** — the session spend prices tokens at official rates; the provider's actual billing prevails.

## License

[MIT](LICENSE)
