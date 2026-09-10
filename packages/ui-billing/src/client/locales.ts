/** `billing` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'billing'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.balance': '剩余额度：{amount}',
  'trigger.conversationSpend': '本轮对话花费：{amount}',
  'label.amount': 'API 剩余金额：{amount}',
  'label.sessionSpend': '本会话花费：{amount}',
  'label.todaySpend': '今日共花费：{amount}',
  'label.cost.hit': '缓存命中 {amount}',
  'label.cost.input': '未命中输入 {amount}',
  'label.cost.output': '输出 {amount}',
  'stat.none': '暂无消耗记录',
  'stat.untitled': '未命名',
  'state.unavailable': '额度不可用',
  'action.refresh': '刷新',
  'info.aria': '花费说明',
  // The hint rides a DSH `Tooltip`: its bubble has no height clamp, so a long
  // label is clipped at the viewport edge, and the bubble cannot be hovered.
  // Keep this SHORT — the full rate schedule lives in the package READMEs.
  'info.hint': '估算：仅 DeepSeek 与 MiMo 模型，按每条消息自身时刻的峰谷官方单价计价（高峰：工作日 9:00–12:00、14:00–18:00）。',
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
  'label.todaySpend': 'Today total: {amount}',
  'label.cost.hit': 'Cache hit {amount}',
  'label.cost.input': 'Missed input {amount}',
  'label.cost.output': 'Output {amount}',
  'stat.none': 'No usage recorded',
  'stat.untitled': 'Untitled',
  'state.unavailable': 'Balance unavailable',
  'action.refresh': 'Refresh',
  'info.aria': 'About this spend',
  // Keep the hint short (see the Chinese dictionary note): the Tooltip bubble
  // clamps neither height nor hover.
  'info.hint': "Estimate: DeepSeek and MiMo models only, each message priced at the official peak/off-peak rate of its own time (peak: weekdays 09:00–12:00, 14:00–18:00).",
  'badge.aria': 'DeepSeek balance {amount}',
  'panel.aria': 'DeepSeek balance details',
  'label.sessionRanking': 'Today session spend',
  'label.sessionRanking.more': '…{count} more sessions',
}

/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh
