# @rayadesu/dsh-llm-billing

[English](README.md) | 中文

独立的宿主插件，把 DeepSeek 账户余额与会话花费变成 `billing` Remote。它拥有 `/user/balance` 传输、峰谷计价表与每会话的计费花费计价，因此部署可以在不把这个能力与聊天补全适配器耦合的前提下，展示「还剩多少、这个会话花了多少」。浏览器侧是 [`dsh-client-ui-billing`](../ui-billing/README.md)。

## 安装

把插件加进组合（一个 `cordis.yml` 行）并给它一个凭据。它先从凭据 seam（或 `apiKeyEnv` 指定的环境变量）解析 API key，再从 `baseURL`、其次 `$DEEPSEEK_BASE_URL`、最后公共 API 解析端点。

```yaml
- id: llm-billing
  name: '@rayadesu/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

插件注册 `billing` Remote，含五个方法：`getBalance()`（解析后的 `/user/balance` 快照）、`getSessionSpend(sessionId)`（单个会话的计费花费）、`getTodaySpend(force?)`（当前北京时间自然日内所有会话的计费花费合计；`force` 绕过宿主侧缓存，供徽标手动刷新使用）、`getTodaySessionsSpend(force?)`（今日按会话的计费花费，按花费从高到低排序，每行带会话的持久标题）与 `getTurnSpend(sessionId, messageId)`（单个已完成回合的计费花费，按收尾助手消息 id 定位）。会话花费把每条 `assistant/message` 事件的计费 token（缓存命中输入、含缓存写入的未命中输入、含推理的输出）按事件自身发生时刻（北京时间）所在的峰/谷单价计价——高峰窗口仅周一至周五适用，周末全天按低谷价——再按模型汇总。一个回合即收尾消息所在的 `turn/start`..`turn/end` 区间；排行从每个会话日志里最后一条 `session/title` 事件折叠标题（last-wins，重命名事件一旦提交、会话被重新读取即反映新名字）。

### 今日花费读取路径（消息触发不再全量扫描）

`getTodaySpend()` 每次请求都不会全量扫描所有会话日志。一个 60 秒的北京日缓存带 in-flight 合并，服务于消息触发的读取；只有手动刷新（`force`）绕过时间窗口。缓存未命中时，两种带 revision 门控的策略计算聚合：

- **投影路径**（当组合中装配了 `@deepseek-ai/dsh-session-projection` 时启用）：插件注册 `billingTodaySpend` 投影单元，随事件提交增量折叠每个会话的花费。live 会话零日志 I/O 直读其 eager 单元；冷会话走投影缓存阶梯（`coldSnapshot`），没有缓存服务时对每个会话做一次 detached 折叠。只有持久化 revision 在上次解析后变化过的会话才会被读取。
- **事件路径**（无注册表时的回退）：只收集今天的事件（收集时按北京日过滤），带 20 万事件上限，跳过持久化 revision 未变的会话。

进程内首次解析之后，稳态读取只花在日志确实变化过的会话上。日志无法读取的会话带警告跳过，而不是让整日合计失败。

注意：投影路径对每个会话的历史只计价一次，按事件被折叠时的费率——修改 `billing.models` 只影响变更后折叠的事件（事件路径会重算整个日志）。

## 分叉会话

分叉会话（DSH 的「分叉会话」）的日志以来源会话事件的逐字节副本开头。若不特殊处理，同一批模型输出会按副本数重复计费：子会话的会话花费会包含继承前缀，今日花费也会在父会话之外再计一次。插件只对会话的**自有事件**计费——持久的 `header.seedLength` 即分叉边界，凡是 `seq < seedLength` 的事件都视为已在来源会话计费。因此分叉子会话从分叉后的第一次新交流开始计费（刚分叉的会话花费为零），今日花费对每个模型输出只计一次，同一血缘规则同样覆盖多代分叉与 subagent 分叉（`context: 'fork'` 生成）。边界取自已持久化的 header 值，所以恢复后的分叉子会话保持原边界；而创建时没有 seed 的会话——包括普通会话与冷恢复——不带边界，正常全额计费。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4 Flash + V4 Pro + V4 Flash Vision Exp | 展示用的模型行，按展示顺序。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京，仅工作日） | 高峰时段窗口，仅周一至周五适用；周末与其余时段均为低谷。 |
| `billing.models` | 官方 V4 费率 | 每个模型的峰/谷单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token）。 |

只想覆盖某个模型而不丢其它，就提供一个非空的 `billing.models` 列表；空或省略则回退到官方默认费率。

## 模型体验

无，因为本包是 provider 与会话事实的只读 Remote 投影，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；它唯一的 provider 调用是一次带凭据的 `/user/balance` 读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **有费率行才计价** —— 会话花费与今日花费只统计价目表（`billing.models`）里有的模型；没有费率行的模型不计入。
- **最多 60 秒延迟** —— `getTodaySpend()` 由宿主侧缓存服务最多 60 秒；只有手动刷新（`force`）立即重算（仍受 revision 门控，日志未变则零成本）。
- **投影计价对历史冻结** —— 投影路径生效时，修改计价表只影响变更后折叠的事件；重启（或事件路径回退）才会重算整个日志。
