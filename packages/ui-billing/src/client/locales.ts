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
  'info.hint': '仅能预估 DeepSeek 及 MiMo 相关模型。本会话花费按每条消息的发生时刻（北京时间）所在峰谷时段单价计费：缓存命中输入、未命中输入（含缓存写入）、输出（含推理）分别计价。DeepSeek 费率按 8 月 17 日实行的标准，高峰时段为北京时间周一至周五 9:00–12:00、14:00–18:00，周末全天按低谷价计费；MiMo 系列不区分峰谷，统一费率。',
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
  'info.hint': "Only DeepSeek and MiMo models are estimated. This session's spend is priced per message at the rate of its Beijing-time peak/off-peak hour: cache-hit input, cache-miss input (including cache writes), and output (including reasoning) are billed separately. DeepSeek rates follow the August 17 pricing; peak hours are Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00, and weekends are billed at off-peak prices all day. MiMo series uses a flat rate with no peak/off-peak distinction.",
  'badge.aria': 'DeepSeek balance {amount}',
  'panel.aria': 'DeepSeek balance details',
  'label.sessionRanking': 'Today session spend',
  'label.sessionRanking.more': '…{count} more sessions',
}

/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh
