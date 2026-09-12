/** `billing` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'billing'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.balance': '剩余额度：{amount}',
  'trigger.conversationSpend': '本轮对话花费：{amount}',
  'label.amount': 'API 剩余金额：{amount}',
  'label.sessionSpend': '本会话花费：{amount}',
  // This session's share of today, riding the session row itself: the amount
  // only (the row already names the session). Rendered ONLY when it differs
  // from the whole-session amount — a session that has not crossed a Beijing
  // day bills exactly its own total today, so the extra number would just
  // repeat the one beside it.
  'label.sessionSpend.today': '（{amount}）',
  'label.todaySpend': '今日花费：{amount}',
  'label.todayTokens': '今日 Token：{count}',
  // DSH's own token unit (its `unit.tokens` / `message.turnUsage.count` wording,
  // identical in both dictionaries): the compact count plus ` tok`. The
  // placeholder states ride the label instead, so `—` never grows a unit.
  'unit.tokens': '{count} tok',
  // The per-model cost breakdown's three bucket labels, taken from DSH's own
  // token dialog (ui-chat locale.ts: `message.turnUsage.input` = 未缓存输入 /
  // Uncached input, `message.turnUsage.cacheRead` = 缓存读取 / Cached input,
  // `message.turnUsage.output` = 输出 / Output), in DSH's row order. DSH splits
  // the cache-miss side into a fourth `cacheWrite` row; the host prices cache
  // writes at the miss rate, so this plugin folds them into the uncached-input
  // bucket's cost and says so in the READMEs.
  'label.cost.input': '未缓存输入 {amount}',
  'label.cost.cacheRead': '缓存读取 {amount}',
  'label.cost.output': '输出 {amount}',
  // The composer spend card: one row per billing bucket, under a heading that
  // names the amount. The three row labels deliberately repeat DSH's token-card
  // wording (`未缓存输入` / `缓存读取` / `输出`), so the cost card and the token
  // card read as one family even though only DeepSeek/MiMo usage is priced.
  'card.title': '花费金额',
  'card.input': '未缓存输入',
  'card.cacheRead': '缓存读取',
  'card.output': '输出',
  'card.aria': '本轮对话花费：{amount}',
  'stat.none': '暂无消耗记录',
  'stat.untitled': '未命名',
  'state.unavailable': '额度不可用',
  'action.refresh': '刷新',
  'info.aria': '花费说明',
  // The hint rides a DSH `Tooltip` (white-space: pre-line, so a `\n` starts a
  // new line): its bubble has no height clamp, so a long label is clipped at the
  // viewport edge, and the bubble cannot be hovered. Keep this SHORT — the full
  // rate schedule lives in the package READMEs. The second line names the
  // parenthesized amount on the session row; the version stays the last line,
  // flush with the bubble's left edge, with no blank line between them.
  'info.hint': '估算：仅 DeepSeek 与 MiMo 模型，按每条消息自身时刻的峰谷官方单价计价（高峰：工作日 9:00–12:00、14:00–18:00）。\n括号内为本会话今日花费。\nv{version}',
  'badge.aria': 'DeepSeek 额度：{amount}',
  'panel.aria': 'DeepSeek 额度详情',
  'label.sessionRanking': '今日会话花费',
  'label.sessionRanking.more': '…还有 {count} 个会话',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<BillingKey, string> = {
  'trigger.balance': 'Balance: {amount}',
  'trigger.conversationSpend': 'This conversation: {amount}',
  'label.amount': 'API balance: {amount}',
  'label.sessionSpend': 'This session: {amount}',
  // Amount only, as in the Chinese dictionary; rendered only when the session's
  // total and its share of today disagree (a day-crossing session).
  'label.sessionSpend.today': ' ({amount})',
  'label.todaySpend': 'Today spend: {amount}',
  'label.todayTokens': 'Today tokens: {count}',
  // As in the Chinese dictionary: DSH's own ` tok` unit, appended to the value
  // only (a placeholder stays a bare `—`).
  'unit.tokens': '{count} tok',
  // DSH's own bucket wording, as in the Chinese dictionary (and in DSH's row order).
  'label.cost.input': 'Uncached input {amount}',
  'label.cost.cacheRead': 'Cached input {amount}',
  'label.cost.output': 'Output {amount}',
  // Same key set as the Chinese dictionary; the row labels mirror DSH's
  // token-card wording (Uncached input / Cached input / Output).
  'card.title': 'Spend',
  'card.input': 'Uncached input',
  'card.cacheRead': 'Cached input',
  'card.output': 'Output',
  'card.aria': 'This conversation’s spend: {amount}',
  'stat.none': 'No usage recorded',
  'stat.untitled': 'Untitled',
  'state.unavailable': 'Balance unavailable',
  'action.refresh': 'Refresh',
  'info.aria': 'About this spend',
  // Keep the hint short (see the Chinese dictionary note): the Tooltip bubble
  // clamps neither height nor hover, the middle line names the parenthesized
  // amount on the session row, and the version is the line under the text.
  'info.hint': 'Estimate: DeepSeek and MiMo models only, each message priced at the official peak/off-peak rate of its own time (peak: weekdays 09:00–12:00, 14:00–18:00).\nThe parenthesized amount is this session\'s spend today.\nv{version}',
  'badge.aria': 'DeepSeek balance {amount}',
  'panel.aria': 'DeepSeek balance details',
  'label.sessionRanking': 'Today session spend',
  'label.sessionRanking.more': '…{count} more sessions',
}

/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh
