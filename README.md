# DeepSeek Harness billing plugin

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows your **DeepSeek account balance**, **this session's (this conversation's) billed spend**, and **today's total spend across all sessions** directly in the web session header.

> The balance is the real `GET /user/balance` figure; the session and today spends price each message's billed tokens at the official peak/off-peak rates and are estimates, not billing promises.

## What it shows

- **Session-header badge** — two lines: remaining balance (`剩余额度：¥X`) and this conversation's billed spend (`本轮对话花费：¥X`).
- **Detail panel** — the remaining amount, this session's spend (`本会话花费`) with today's all-session spend beside it (`今日共花费`), one priced row per model (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), plus a manual refresh action and a spend disclaimer.
- **Failures and empty states** — a session or day without priced usage shows "no usage recorded" instead of a fabricated figure; a missing key, rejected credential, or transport error renders a muted "Balance unavailable" whose tooltip carries the Remote's own error message.

## Data update mechanics

- **Session spend follows the conversation** — on every new message in the current session, the badge recomputes only **this session's spend** and **today's spend** (purely local pricing, no network request), so the spend lines stay live during an ongoing conversation. The host prices incrementally: an unchanged session log is served from the host-side cache, and only the appended tail of a growing log is re-priced.
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
  explicit pin bypasses the age gate; replace `0.2.3` with the version you want):

  ```bash
  dsh plugin --profile web add @rayadesu/dsh-billing@0.2.3 @rayadesu/dsh-llm-billing@0.2.3 @rayadesu/dsh-client-ui-billing@0.2.3
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

Run inside the deepseek-harness checkout (`pnpm dsh` is the harness-local CLI,
equivalent to a global `dsh`):

```sh
pnpm dsh plugin --profile web list    # list the web profile's installed plugins
pnpm dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
pnpm dsh plugin --profile web remove @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
pnpm dsh plugin --profile web update  # update plugins to the latest allowed versions
```

### Dependency notes

The two plugin packages declare the DeepSeek Harness packages they build on
(`@deepseek-ai/cordis`, `@deepseek-ai/dsh-credentials`, `@deepseek-ai/dsh-session`,
and the client runtime packages) as `peerDependencies` at `^0.1.1-rc.2`. A dsh
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
the published `@deepseek-ai/dsh-typert-protocol@0.1.1-rc.2` declarations; when
the dsh dependency line moves, refresh it from the installed package.

Publishing (the bundle and both plugins share one version; `prepublishOnly`
runs the `verify` gate automatically). Use `npm publish` from **inside each
package directory** — `pnpm publish` fails (token resolution) and a folder
argument like `npm publish packages/llm-billing` is parsed as a GitHub
shorthand, which triggers a bogus `git ls-remote` instead of a publish. The
registry requires a token that bypasses 2FA (an `npm login` session token gets
E403); `NODE_AUTH_TOKEN` does not work for `npm publish`, so pass the token
explicitly on the command line — never commit it:

```sh
cd packages/llm-billing && npm publish --//registry.npmjs.org/:_authToken=<TOKEN>
cd packages/ui-billing && npm publish --//registry.npmjs.org/:_authToken=<TOKEN>
npm publish --//registry.npmjs.org/:_authToken=<TOKEN>   # @rayadesu/dsh-billing bundle (repo root)
```

## Configuration

Both packages ship sane defaults; everything below is optional.

### Host (`llm-billing`)

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential-reference (environment-variable) name resolved per call. |
| `baseURL` | `$DEEPSEEK_BASE_URL` then `https://api.deepseek.com` | Endpoint base; `/user/balance` is appended. |
| `models` | V4 Flash + V4 Pro + V4 Flash Vision Exp | Advisory display rows, in presentation order. |
| `billing.peakHours` | 09:00–12:00, 14:00–18:00 (Beijing, weekdays) | Peak-hour windows, applied weekdays (Mon–Fri) only; weekends and all other hours are off-peak. |
| `billing.models` | Published V4 rates | Per-model peak/off-peak price rows (`cacheHitInput`, `cacheMissInput`, `output`, in CNY per 1M tokens). |

## How session spend is computed

- Each `assistant/message` event reports three billed token buckets: **cache-hit input**, **cache-miss input** (uncached input + cache writes), and **output** (including reasoning).
- Each message is priced at the peak/off-peak rate of its own **Beijing-time** hour, the three buckets are billed separately (`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`), then summed per model. Peak windows apply weekdays (Monday–Friday) only; weekends are always off-peak.
- **Today's spend** aggregates every session's events on the current Beijing-time calendar day with the same pricing rules; event dates are also assigned in Beijing time.
- Models without a rate row are not priced (the built-in catalog currently has the three V4 rows: V4 Flash, V4 Pro, and V4 Flash Vision Exp). Rates follow the DeepSeek pricing effective **August 17**; the weekend-off-peak rule (weekends billed at off-peak prices all day) follows the adjustment effective **August 23**.

## Known limitations

- **Priced rows only** — the session and today spends only price models that have a `billing.models` row.
- **On-demand aggregation** — today's spend is computed on the host behind a 60-second cache; a miss scans only sessions whose persisted log changed since the last resolution (live sessions fold through the projection cells when the registry is composed), and a growing session's spend is priced incrementally (only the appended tail is re-priced).
- **Balance does not follow automatically** — the balance stays a manual snapshot (no polling); spending from another client does not move the shown value until a refresh or browser reload.
- **Estimate, not a promise** — the session spend prices tokens at official rates; the provider's actual billing prevails.

## License

[MIT](LICENSE)
