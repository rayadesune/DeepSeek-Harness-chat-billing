# 插件更新方案：本轮用量花费 + 今日会话花费排行（已实施）

> 状态：已实施（0.2.4 功能落地，0.3.0 发布到 npm）。以下为最终落地形态，与审核时的方案差异见「方案演变」。

## 一、最终方案（全部纯插件，零 DSH 改动）

### 需求 1：本轮花费（原「本轮用量后显示花费」）

- **位置**：ui-chat 的 `conversation.chat.assistant-actions` **list slot**（与
  `ui-message-feedback` 同一条操作条，多条目共存）——条目 `billing-turn-cost`
  （order 20），渲染在每条已完成回合的收尾消息操作行内（与时间、复制、分叉同一排，
  紧邻「本轮用量」卡片）：`本轮花费：¥0.0123`。
- **数据**：新 Remote `billing.getTurnSpend(sessionId, messageId)`——host 按收尾
  消息 id 定位回合的 `turn/start`..`turn/end` 区间，对区间内每个带 usage 的
  `assistant/message` 事件按**事件自身时间戳**峰谷计价（与「本会话花费」口径一致），
  返回回合总花费。
- **客户端**：按 `(sessionId, messageId)` 模块级 memo（回合落定后不可变，每回合
  只算一次）；花费为 0（无 DeepSeek 用量）或加载失败 → 不渲染。
- 需求 2（展开卡片内三个桶各自花费）：**已取消**。

### 需求 3：会话头部卡片「今日会话花费」排行

- **host**：`TodaySpendScanner.scanSessions(dayKey)`——复用现有扫描服务
  （投影路径 / 事件路径、revision 门控、北京日历日过滤），按会话累计**今日**花费
  （跨天会话只算今天），只返回花费 > 0 的会话，**按 total 从高到低排序**；每行带
  会话标题：live 会话从 `session.events` 折叠最后一条 `session/title`（重命名即时
  生效），冷会话在 `inspect` 时顺带折叠并缓存，投影缓存直接命中的会话标题为空 →
  客户端显示「未命名」。
- **新 Remote**：`billing.getTodaySessionsSpend(force?)`，独立 60s 北京日缓存
  （与「今日共花费」同 TTL，手动刷新可 force）。
- **客户端（BalanceBadge）**：挂载 / 手动刷新（force）/ 回合结算三条路径与
  `todaySpend` 同步拉取；面板模型明细行下方新增「今日会话花费」区：序号 + 会话名
  + 金额倒序；上限 `SESSION_RANKING_LIMIT`（10）条，超出显示「…还有 N 个会话」；
  无标题显示「未命名」；无记录不渲染该区。

## 二、改动文件清单

### host（`packages/llm-billing`）

- `src/types.ts`：新增 `DeepSeekTurnSpend { total }`、`DeepSeekTodaySessionSpend
  { sessionId, title, total }`、`DeepSeekTodaySessionsSpend { sessions }`。
- `src/billing.ts`：新增 `computeTurnSpend(events, billing, catalog, messageId)`。
- `src/today-spend.ts`：新增 `foldSessionTitle`（last-wins 折叠 `session/title`）、
  `scanSessions` / `scanSessionsProjections` / `scanSessionsEvents`；`resolveCold`
  顺带折叠标题并缓存；`TodaySpendCache` 泛型化。
- `src/index.ts`：接线 `fetchTurnSpend`、`fetchTodaySessionsSpend`（第二个
  `TodaySpendCache`）；导出新符号。
- `src/balance.ts`：gateway 新增 `@Remote('getTurnSpend')` 与
  `@Remote('getTodaySessionsSpend')`。

### client（`packages/ui-billing`）

- `src/client/TurnCostAction.tsx` + `.module.css`：本轮花费条目组件。
- `src/client/index.ts`：注册 `conversation.chat.assistant-actions` 条目；
  injected face 新增 `getTurnSpend` / `getTodaySessionsSpend`。
- `src/client/BalanceBadge.tsx` + `.module.css`：排行区（`SESSION_RANKING_LIMIT`）。
- `src/client/locales.ts`：新增 `turnCost`、`label.sessionRanking`、
  `label.sessionRanking.more`、`stat.untitled`（zh/en 成对）。

### 测试 / 版本 / 文档

- `tests/billing.spec.ts`：`computeTurnSpend`（峰谷、区间隔离、未知 id、孤儿回合、
  无费率行跳过）。
- `tests/today-spend.spec.ts`：`scanSessions`（events 路径：按会话汇总、跨天排除、
  标题折叠、重命名同步、降序排序；projection 路径：eager 单元格 + 冷会话标题、
  缓存命中标题为 null）。
- `tests/browser-plugin.client.spec.ts`：新 Remote face 注入 + 条目注册/拆除。
- `tests/balance-badge.client.spec.tsx`：排行渲染/上限/空态/force、TurnCostAction
  渲染/隐藏/memo。
- 版本 0.2.3 → 0.2.4（三包 + lockfile）；三包 README 双语 + i18n.yaml 更新。

## 三、方案演变（审核过程中的决策）

1. 原方案需求 1 拟改 DSH ui-chat（可选服务，卡片内加花费）→ **放弃**：卡片本体无
   slot，改 DSH 需要重建 web。
2. 拟用 `conversation.chat.turnTail`（卡片上方一行）→ **放弃**：turnTail 是单胜出
   chain slot，「本轮产出文件」行（ui-deliverables）已占用，两者互斥。
3. **最终**：`conversation.chat.assistant-actions` list slot（可多条目共存），
   花费行放在操作行内——用户确认接受该位置；需求 2（卡片内三个桶花费）用户确认取消。
4. 零 DSH 改动确认：`@deepseek-ai/dsh-client-ui-chat` 未发布 npm，但
   `@deepseek-ai/dsh-client-ui-conversation`（0.1.1-rc.2）已声明该 slot，插件直接
   复用其类型，无需自声明。

## 四、验证

- `pnpm run typecheck` / `pnpm run build` / `pnpm run test`（110 个用例）/ `pnpm run verify`。
- 安装：`dsh plugin --profile web add @rayadesu/dsh-billing@0.3.0 @rayadesu/dsh-llm-billing@0.3.0 @rayadesu/dsh-client-ui-billing@0.3.0`（或 `update`），重启 `dsh web`。
