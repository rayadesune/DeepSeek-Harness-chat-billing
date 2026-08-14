/** `billing` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'billing'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.balance': '剩余额度：{amount}',
  'trigger.tasks': '按当前模型预计还能跑：{count} 个任务',
  'trigger.tasks.short': '按当前模型预计还能跑：不足 1 个任务',
  'label.amount': 'API 剩余金额：{amount}',
  'label.tasks': '还能跑 {count} 个任务',
  'label.tasks.insufficient': '按消耗能跑不足 1 个任务，该充钱了',
  'stat.none': '暂无消耗记录',
  'state.unavailable': '额度不可用',
  'action.refresh': '刷新',
  'info.aria': '估算说明',
  'info.hint': '仅能预估 DeepSeek 相关模型。任务量口径：1 个任务 = 1 次会话；按全部历史会话平均每模型的 token 消耗（缓存命中/未命中输入、输出含推理），按当前峰谷时段单价折算成平均每任务费用，再用剩余余额除以该费用并向下取整。费用按 8 月 17 日实行的标准。',
  'badge.aria': 'DeepSeek 额度：{amount}',
  'panel.aria': 'DeepSeek 额度详情',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<BillingKey, string> = {
  'trigger.balance': 'Balance: {amount}',
  'trigger.tasks': '~{count} tasks left on current model',
  'trigger.tasks.short': '<1 task left on current model',
  'label.amount': 'API balance: {amount}',
  'label.tasks': '~{count} more tasks',
  'label.tasks.insufficient': 'Less than 1 task left — time to top up',
  'stat.none': 'No usage recorded',
  'state.unavailable': 'Balance unavailable',
  'action.refresh': 'Refresh',
  'info.aria': 'About this estimate',
  'info.hint': "Only DeepSeek models are estimated. Task basis: 1 task = 1 session; each model's token usage (cache-hit/miss input and output, reasoning included) is averaged across all historical sessions, priced at the current peak/off-peak rate, then the remaining balance is divided by that per-task cost and floored. Pricing follows the August 17 rates.",
  'badge.aria': 'DeepSeek balance {amount}',
  'panel.aria': 'DeepSeek balance details',
}

/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh
