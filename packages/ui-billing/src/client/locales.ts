/** `billing` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'billing'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // The trigger's two lines: the balance line drops the panel's "API" prefix
  // (the chip is narrow), while the spend line keeps the panel's own label —
  // `label.sessionSpend` — so the amount a user reads on the chip and in the
  // box is worded identically.
  'trigger.balance': '剩余金额：{amount}',
  'label.amount': 'API 剩余金额：{amount}',
  // Today's consumption measured from the balance series itself (the
  // balanceinfo caliber: the day's first queried balance − the current one +
  // the day's top-ups), riding the amount exactly like the other two riders:
  // the amount only, one leading space, no wording and no parentheses (the info
  // hint names it). Hidden — not `¥0` — until today holds a balance sample.
  'label.amount.todaySpend': ' {amount}',
  'label.sessionSpend': '本会话花费：{amount}',
  // This session's share of today, riding the session row itself: the amount only
  // (the row already names the session), no parentheses — the rider's leading
  // space and its level-one tone are what separate it from the row's own figure.
  // Rendered ONLY when the conversation did not start today: the creation day
  // decides (a session that started today billed exactly its own total today, so
  // the extra number would just repeat the one beside it).
  'label.sessionSpend.today': ' {amount}',
  'label.todaySpend': '今日花费：{amount}',
  'label.todayTokens': '今日 Token：{count}',
  // The day's cache-hit share, riding the 今日 Token figure the way the today
  // amount rides 本会话花费: bare percentage, no wording and no parentheses of its
  // own (level-one tone + the leading space set it apart). The number arrives
  // already formatted by DSH's own hit-rate rule (see format.ts).
  'label.todayTokens.hit': ' {percent}%',
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
  'card.aria': '本轮对话花费：{amount}',
  // The bare bucket names, in DSH's wording and row order (ui-chat's token
  // dialog). The panel's three today-bucket rows name themselves with these,
  // and the composer card's rows reuse them so both surfaces read identically.
  'label.bucket.input': '未缓存输入',
  'label.bucket.cacheRead': '缓存读取',
  'label.bucket.output': '输出',
  'stat.none': '暂无消耗记录',
  // The OTHER kind of empty: usage was measured but matched no pricing row at
  // all, so nothing could be billed. It looks identical to `stat.none` in a raw
  // figure (¥0), and claiming "no usage" here is exactly what hid the
  // MiMo-V2.6 gap — naming the difference is this key's whole purpose.
  'stat.unpricedOnly': '有消耗，但未匹配到费率',
  // Named offenders: the wire models today's fold could not price at all, and
  // the ones priced at a substituted family rate (so their share is a guess).
  'notice.unpriced': '未计价用量：{models}（无匹配费率）',
  'notice.estimated': '估算用量：{models}（按同类费率）',
  'stat.untitled': '未命名',
  'state.unavailable': '额度不可用',
  'action.refresh': '刷新',
  'info.aria': '花费说明',
  // The hint rides a DSH `Tooltip` (white-space: pre-line, so a `\n` starts a
  // new line): its bubble has no height clamp, so a long label is clipped at the
  // viewport edge, and the bubble cannot be hovered. Keep this SHORT — the full
  // rate schedule lives in the package READMEs. The lines follow the panel top
  // to bottom: the pricing estimate, the amount rider (today's consumption from
  // the balance series itself, with the caliber that produces it), what the
  // session amounts cover (this session plus the subagent sessions it
  // delegated), then the session rider; the version stays the last line, flush
  // with the bubble's left edge, with no blank line before it.
  'info.hint': '估算：仅 DeepSeek 与 MiMo 模型，按每条消息自身时刻的峰谷官方单价计价（高峰：工作日 9:00–12:00、14:00–18:00）。\nAPI 剩余金额后的数字为今日消费：今日首次查询余额 − 当前余额 + 今日充值（充值按 10 元步进识别）。\n金额含本会话委派的子代理会话。\n本会话花费后的数字为本会话今日花费。\nv{version}',
  'badge.aria': 'DeepSeek 额度：{amount}',
  'panel.aria': 'DeepSeek 额度详情',
  'label.sessionRanking': '今日会话花费',
  'label.sessionRanking.more': '…还有 {count} 个会话',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<BillingKey, string> = {
  // As in the Chinese dictionary: the trigger's balance line is the panel's
  // label without the "API" prefix, and its spend line matches the panel's.
  'trigger.balance': 'Balance: {amount}',
  'label.amount': 'API balance: {amount}',
  // Amount only, as in the Chinese dictionary: the API-balance rider is the
  // day's consumption from the balance series itself, named by the info hint.
  'label.amount.todaySpend': ' {amount}',
  'label.sessionSpend': 'This session: {amount}',
  // Amount only, as in the Chinese dictionary; rendered only when the session's
  // total and its share of today disagree (a day-crossing session).
  'label.sessionSpend.today': ' {amount}',
  'label.todaySpend': 'Today spend: {amount}',
  'label.todayTokens': 'Today tokens: {count}',
  // As in the Chinese dictionary: the day's cache-hit share rides the token
  // figure, percentage only, no parentheses, formatted by DSH's own hit-rate rule.
  'label.todayTokens.hit': ' {percent}%',
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
  'card.aria': 'This conversation’s spend: {amount}',
  // As in the Chinese dictionary: the bare bucket names, shared by the panel's
  // today-bucket rows and the composer card's rows.
  'label.bucket.input': 'Uncached input',
  'label.bucket.cacheRead': 'Cached input',
  'label.bucket.output': 'Output',
  'stat.none': 'No usage recorded',
  // The other kind of empty (see the Chinese dictionary): usage measured, but
  // no rate row matched it, so nothing could be billed.
  'stat.unpricedOnly': 'Recorded, but no rate matched',
  'notice.unpriced': 'Unpriced usage: {models} (no rate matched)',
  'notice.estimated': 'Estimated usage: {models} (proxy rate)',
  'stat.untitled': 'Untitled',
  'state.unavailable': 'Balance unavailable',
  'action.refresh': 'Refresh',
  'info.aria': 'About this spend',
  // Keep the hint short (see the Chinese dictionary note): the Tooltip bubble
  // clamps neither height nor hover. The lines mirror the Chinese dictionary —
  // the estimate, the amount rider and the caliber behind it, what the session
  // amounts cover, the session rider — with the version as the last line.
  'info.hint': 'Estimate: DeepSeek and MiMo models only, each message priced at the official peak/off-peak rate of its own time (peak: weekdays 09:00–12:00, 14:00–18:00).\nThe figure after the API balance is today\'s consumption: the day\'s first queried balance minus the current one, plus today\'s top-ups (identified in ¥10 steps).\nThe amounts include the subagent sessions this session delegated.\nThe figure after this session\'s amount is its spend today.\nv{version}',
  'badge.aria': 'DeepSeek balance {amount}',
  'panel.aria': 'DeepSeek balance details',
  'label.sessionRanking': 'Today session spend',
  'label.sessionRanking.more': '…{count} more sessions',
}

/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh
