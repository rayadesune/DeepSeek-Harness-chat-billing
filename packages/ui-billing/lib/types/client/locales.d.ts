/** `billing` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "billing";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'trigger.balance': "剩余金额：{amount}";
    readonly 'label.amount': "API 剩余金额：{amount}";
    readonly 'label.amount.todaySpend': " {amount}";
    readonly 'label.todaySpend': "今日花费：{amount}";
    readonly 'label.todayTokens': "今日 Token：{count}";
    readonly 'label.todayTokens.hit': " {percent}%";
    readonly 'unit.tokens': "{count} tok";
    readonly 'label.cost.input': "未缓存输入 {amount}";
    readonly 'label.cost.cacheRead': "缓存读取 {amount}";
    readonly 'label.cost.output': "输出 {amount}";
    readonly 'card.title': "花费金额";
    readonly 'card.aria': "本轮对话花费：{amount}";
    readonly 'label.bucket.input': "未缓存输入";
    readonly 'label.bucket.cacheRead': "缓存读取";
    readonly 'label.bucket.output': "输出";
    readonly 'stat.none': "暂无消耗记录";
    readonly 'stat.unpricedOnly': "有消耗，但未匹配到费率";
    readonly 'notice.unpriced': "未计价用量：{models}（无匹配费率）";
    readonly 'stat.untitled': "未命名";
    readonly 'state.unavailable': "额度不可用";
    readonly 'notice.unavailable': "额度不可用，请检查 API key";
    readonly 'notice.none': "该 API key 当前没有可用余额";
    readonly 'action.refresh': "刷新";
    readonly 'info.aria': "花费说明";
    readonly 'info.hint': "估算：仅 DeepSeek 与 MiMo 模型，按每条消息自身时刻的峰谷官方单价计价（高峰：工作日 9:00–12:00、14:00–18:00）。\nAPI 剩余金额后的数字为今日消费：今日首次查询余额 − 当前余额 + 今日充值（充值按 10 元步进识别）。\n会话花费含其委派的子代理会话。\nv{version}";
    readonly 'badge.aria': "DeepSeek 额度：{amount}";
    readonly 'panel.aria': "DeepSeek 额度详情";
    readonly 'label.sessionRanking': "今日会话花费";
    readonly 'label.sessionRanking.more': "…还有 {count} 个会话";
};
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<BillingKey, string>;
/** Key domain of the `billing` namespace (zh is the source of truth). */
export type BillingKey = keyof typeof zh;
//# sourceMappingURL=locales.d.ts.map