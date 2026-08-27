# @rayadesu/dsh-client-ui-billing

English | [中文](README.zh.md)

Web billing feature owner: contributes one entry to `conversation.session.header.utilities` that mounts its own `billing` Remote, reads the DeepSeek account balance, this session's billed spend, and today's spend across every session through `billing/getBalance`, `billing/getSessionSpend`, and `billing/getTodaySpend`, and renders them as a top-right label box. The host half of the capability lives in [`dsh-llm-billing`](../llm-billing/README.md), which owns the `/user/balance` transport, the peak/off-peak pricing table, and the `billing` Remote namespace; this package mounts that Remote and renders what it returns.

The trigger shows two lines — the remaining balance and this conversation's billed spend ("本轮对话花费 ¥X") — and renders nothing while the first fetch is in flight. Clicking it opens a label box with the remaining amount, this session's billed spend (本会话花费, priced per message at the official peak/off-peak rate — peak windows apply weekdays Mon–Fri only, weekends are off-peak) with today's all-session spend beside it (今日共花费), one priced row per model with the cache-hit / cache-miss-input / output cost breakdown ("缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z"), a manual refresh action, and a spend disclaimer. Refreshing keeps the last values visible rather than blanking them, and a refresh failure retains the last good value. A session or day without priced usage shows a "no usage recorded" word rather than a fabricated figure. A failure — no API key configured, a rejected credential, a transport error — renders a muted "Balance unavailable" word whose tooltip carries the Remote's own error message.

The badge is account-level even though the slot is session-scoped: the header utilities row is simply the one always-visible title-bar seat the shell offers, and the balance it shows does not vary by session — but the spend lines do, because they price the current session's own token usage through `billing/getSessionSpend` and every session's usage through `billing/getTodaySpend`. Copy goes through the package's own `billing` locale namespace; styling uses tokens only.

## Refresh mechanics

The spends follow the conversation and the balance stays a manual snapshot:

- **Spends follow new messages, debounced** — the component subscribes to the current session's message count through the framework `useSession` seat. When a new message lands, it recomputes this session's spend (`billing/getSessionSpend`) and today's spend (`billing/getTodaySpend`), local pricing passes with no network request, so the spend lines stay live during an ongoing conversation. The recompute is debounced for two seconds, so a burst of messages (a streaming agent turn) prices once instead of once per message; the host-side cache (see `dsh-llm-billing`) then serves the first miss for the rest of the minute.
- **Balance is manual** — the account balance is fetched on mount, on session switch, and on the explicit refresh action (`billing/getBalance`). There is no polling and no automatic refetch: the balance line only changes when one of those events happens.
- **Refresh keeps the last values** — an in-flight refresh leaves the previous values on screen, and a failed refresh retains the last good value instead of blanking it. The refresh action calls `billing/getTodaySpend(true)`, which bypasses the host-side cache; the message-triggered recompute and the mount/session-switch read use the cached path.

## Model Experience

None, as this package renders account-level provider facts for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of provider quota lives with the `QUOTA` / `INVALID_CREDENTIAL` error codes surfaced by [`dsh-llm`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm) on failed requests.

#### KV Cache effect

None; the package never assembles or sends provider requests, and its one RPC is a credential-authenticated account read that is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **First balance line only** — the balance reads the primary (`balance_infos[0]`) currency line; other currency lines are not shown.
- **Balance does not follow automatically** — the balance is a manual snapshot (no polling): spending from another client does not move the shown value until a refresh or browser reload.
