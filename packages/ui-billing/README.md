# @deepseek-ai/dsh-client-ui-billing

English | [中文](README.zh.md)

Web billing feature owner: contributes one entry to `conversation.session.header.utilities` that mounts its own `billing` Remote, reads the DeepSeek account balance and this session's billed spend through `billing/getEstimate` and `billing/getSessionSpend`, and renders them as a top-right label box. The host half of the capability lives in [`dsh-llm-billing`](../llm/llm-billing/README.md), which owns the `/user/balance` transport, the cross-session usage fold, the peak/off-peak pricing table, and the `billing` Remote namespace; this package mounts that Remote and renders what it returns.

The trigger shows two lines — the remaining balance and this conversation's billed spend ("本轮对话花费 ¥X") — and renders nothing while the first fetch is in flight. Clicking it opens a label box with the remaining amount, this session's billed spend (本会话花费, priced per message at the official peak/off-peak rate), one priced row per model with the cache-hit / cache-miss-input / output cost breakdown ("缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z"), a manual refresh action, and a spend disclaimer. Refreshing keeps the last values visible rather than blanking them, and a refresh failure retains the last good value. A session without priced usage shows a "no usage recorded" word rather than a fabricated figure. A failure — no API key configured, a rejected credential, a transport error — renders a muted "Balance unavailable" word whose tooltip carries the Remote's own error message.

The badge is account-level even though the slot is session-scoped: the header utilities row is simply the one always-visible title-bar seat the shell offers, and the balance it shows does not vary by session — but the spend line does, because it prices the current session's own token usage through `billing/getSessionSpend`. Copy goes through the package's own `billing` locale namespace; styling uses tokens only.

## Model Experience

None, as this package renders account-level provider facts for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of provider quota lives with the `QUOTA` / `INVALID_CREDENTIAL` error codes surfaced by [`dsh-llm`](../llm/llm/README.md) on failed requests.

#### KV Cache effect

None; the package never assembles or sends provider requests, and its one RPC is a credential-authenticated account read that is not cached in the provider KV store.

## Known Limitations and Deferred Work

- **One estimate, first balance line only** — the estimate uses the primary (`balance_infos[0]`) currency and reports null for a non-CNY balance, so a USD-only account shows the balance but no task conversion. Multi-currency conversion is deferred.
- **Average is session-scoped, not per-model intent** — a session that switches models counts toward each model it actually called, so the per-model averages are per-call-session rather than per-declared task. The conversion is an estimate, not a billing promise.
- **Manual refresh only** — the figure is a point-in-time snapshot taken at mount and on the refresh action. It does not follow balance changes automatically during a long-lived session.
