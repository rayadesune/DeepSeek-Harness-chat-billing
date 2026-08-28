# @rayadesu/dsh-client-ui-billing

English | [中文](README.zh.md)

Web billing feature owner: contributes one entry to `conversation.session.header.utilities` that mounts its own `billing` Remote, reads the DeepSeek account balance, this session's billed spend, today's spend across every session, today's per-session ranking, and one turn's cost through `billing/getBalance`, `billing/getSessionSpend`, `billing/getTodaySpend`, `billing/getTodaySessionsSpend`, and `billing/getTurnSpend`, and renders them as a top-right label box. The host half of the capability lives in [`dsh-llm-billing`](../llm-billing/README.md), which owns the `/user/balance` transport, the peak/off-peak pricing table, and the `billing` Remote namespace; this package mounts that Remote and renders what it returns.

The trigger shows two lines — the remaining balance and this conversation's billed spend ("本轮对话花费 ¥X") — and renders nothing while the first fetch is in flight. Clicking it opens a label box with the remaining amount, this session's billed spend (本会话花费, priced per message at the official peak/off-peak rate — peak windows apply weekdays Mon–Fri only, weekends are off-peak) with today's all-session spend beside it (今日共花费), one priced row per model with the cache-hit / cache-miss-input / output cost breakdown ("缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z"), a manual refresh action, and a spend disclaimer. The remaining-amount row (`API 剩余金额`) renders larger than the spend rows below it. Below the model rows the panel ends with the **today session-spend ranking** (`今日会话花费`): sessions sorted by today's cost, highest first, each row a fixed right-aligned rank column, then the same middot separator the cost breakdown uses ("·" with the same size, tone, and spacing), then the session's durable title (renames sync automatically), then its amount — the title keeps its indented rank column; at most `SESSION_RANKING_LIMIT` (10) rows render, with a "…还有 N 个会话" hint for the rest. Refreshing keeps the last values visible rather than blanking them, and a refresh failure retains the last good value. A session or day without priced usage shows a "no usage recorded" word rather than a fabricated figure. A failure — no API key configured, a rejected credential, a transport error — renders a muted "Balance unavailable" word whose tooltip carries the Remote's own error message.

The package also contributes the **turn-cost entry** (`billing-turn-cost`, order 20) to ui-chat's `conversation.chat.assistant-actions` list slot — the same strip `ui-message-feedback` uses, so entries coexist; the entry uses flex `order: -1` to sit at the **front** of the actions row (before the copy control). For each completed turn's closing assistant message, the entry reads `billing/getTurnSpend` (memoized per session + message, since settled turns never change) and renders `本轮花费 ¥X` — the "本轮花费" word in the usage-card title tone and the amount in the summary tone, **always visible** (the hover rule only targets the clock text). Turns that priced to zero (no DeepSeek usage) and failed loads render nothing, so a Remote outage never clutters the row.

The badge is account-level even though the slot is session-scoped: the header utilities row is simply the one always-visible title-bar seat the shell offers, and the balance it shows does not vary by session — but the spend lines do, because they price the current session's own token usage through `billing/getSessionSpend` and every session's usage through `billing/getTodaySpend`. Copy goes through the package's own `billing` locale namespace; styling uses tokens only.

## Refresh mechanics

The spends follow the conversation and the balance stays a manual snapshot:

- **Spends follow settled turns, debounced** — the component subscribes to the current session's running flag through the framework `useSession` seat. When a prompt turn settles (the flag flips back to idle), it recomputes this session's spend (`billing/getSessionSpend`), today's spend (`billing/getTodaySpend`), and the ranking (`billing/getTodaySessionsSpend`), local pricing passes with no network request, so the spend lines stay live during an ongoing conversation. The recompute is debounced for two seconds, so a burst of turns (an agent continuing across turns) prices once instead of once per turn; the host-side cache (see `dsh-llm-billing`) then serves the first miss for the rest of the minute.
- **Balance is manual** — the account balance is fetched on mount, on session switch, and on the explicit refresh action (`billing/getBalance`). There is no polling and no automatic refetch: the balance line only changes when one of those events happens.
- **Refresh keeps the last values** — an in-flight refresh leaves the previous values on screen, and a failed refresh retains the last good value instead of blanking it. The refresh action calls `billing/getTodaySpend(true)` and `billing/getTodaySessionsSpend(true)`, which bypass the host-side cache; the turn-triggered recompute and the mount/session-switch read use the cached path.

## Model Experience

None, as this package renders account-level provider facts for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of provider quota lives with the `QUOTA` / `INVALID_CREDENTIAL` error codes surfaced by [`dsh-llm`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm) on failed requests.

#### KV Cache effect

None; the package never assembles or sends provider requests, and its one RPC is a credential-authenticated account read that is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **First balance line only** — the balance reads the primary (`balance_infos[0]`) currency line; other currency lines are not shown.
- **Ranking capped at 10** — the panel shows at most `SESSION_RANKING_LIMIT` sessions, with a "…N more sessions" hint.
- **Turn cost needs a finalized closing message** — interrupted turns have no actions row, so no turn cost is shown for them.
- **Balance does not follow automatically** — the balance is a manual snapshot (no polling): spending from another client does not move the shown value until a refresh or browser reload.
