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

插件注册 `billing` Remote，含六个方法：`getBalance(force?)`（解析后的 `/user/balance` 快照；15 秒宿主 TTL 内复用，`force` 绕过，单次请求 5 秒超时）、`getSessionSpend(sessionId)`（单个会话的计费花费）、`getTodaySpend(force?)`（当前北京时间自然日内所有会话的计费花费合计；`force` 绕过宿主侧缓存，供徽标手动刷新使用）、`getTodaySessionsSpend(force?)`（今日按会话的计费花费，按花费从高到低排序，每行带会话的持久标题）、`getTurnSpend(sessionId, messageId)`（单个已完成回合的计费花费，按收尾助手消息 id 定位）与 `getSessionTurnSpends(sessionId)`（该会话所有已完成回合的 `messageId → 金额` 映射，一趟折叠——对话每个消息行都要显示金额，客户端因此每会话只拉一次，而不是逐行调用 `getTurnSpend`）。计价的样本来源有两处：`assistant/message` 自身的 usage，以及失败/重试的 `assistant/attempt` 内嵌 stream 里的 usage（后者用最近一条 `request/header` 的模型），各按样本自身发生时刻（北京时间）所在的峰/谷单价、以及该时刻生效的官方费率版本计价——高峰窗口仅周一至周五适用，周末全天按低谷价。同一 `(turn, step)` 的后一份样本替换前一份，`llm/retry-started` 之后重试的那次累加，与 DSH 自己的回合用量口径一致；随后按模型汇总。一个回合即收尾消息所在的 `turn/start`..`turn/end` 区间；排行从每个会话日志里最后一条 `session/title` 事件折叠标题（last-wins，重命名事件一旦提交、会话被重新读取即反映新名字）。

### 今日花费读取路径（消息触发不再全量扫描）

`getTodaySpend()` 每次请求都不会全量扫描所有会话日志。一个 60 秒的北京日缓存带 in-flight 合并，服务于消息触发的读取；只有手动刷新（`force`）绕过时间窗口。缓存未命中时，**一次扫描同时产出聚合与排行**（聚合即各行之和）：

- **投影路径**（当组合中装配了 `@deepseek-ai/dsh-session-projection` 时启用）：插件注册客户端可见的 `billingTodaySpend` 投影单元——**注册表一出现就提前注册**，因此 DSH 的 write-behind 会在每个 `turn/end` 为每个会话落一行检查点。live 会话零日志 I/O 直读其 eager 单元；冷会话若投影缓存的 `cachedSnapshot` 行（零 I/O）自身的最新计价日不是查询日，就直接作答，否则（或没有可用行时）才读取日志本地折叠。只有持久化 revision 在上次解析后变化过的会话才会被读取；读取失败的会话按 revision 记住，不再每轮重试。
- **事件路径**（无注册表时的回退）：对每个会话用同一套计价折叠（收集时按北京日过滤，20 万事件上限），跳过持久化 revision 未变的会话。

进程内首次解析之后，稳态读取只花在日志确实变化过的会话上。日志无法读取的会话带警告跳过（并被记住），而不是让整日合计失败。

注意：投影路径对每个会话的历史只计价一次，按事件被折叠时的费率。官方费率版本随定价闭包一起进入折叠，并按样本自身时刻解析，因此被调价的系列无论日志多晚折叠都能正确计价自身历史；只有**手工修改配置**（`billing.models`）才只影响变更后折叠的事件（事件路径会重算整个日志），而该解析口径变化时单元 `stateVersion` 会一并提升，使已落检查点被丢弃重折而不是沿用旧值。

## 分叉会话

分叉会话（DSH 的「分叉会话」）的日志以来源会话事件的逐字节副本开头。若不特殊处理，同一批模型输出会按副本数重复计费：子会话的会话花费会包含继承前缀，今日花费也会在父会话之外再计一次。插件只对会话的**自有事件**计费——分叉边界取自已持久化的会话状态（≤ 0.1.1-rc.2 运行时为 `header.seedLength`；0.1.2-alpha.4+ 运行时为 `Session.inheritedEventCount` / `inspect().inheritedEventCount`，两者都以结构方式读取）。`billingTodaySpend` 单元本身**带边界**（状态里存着切割点，`apply` 跳过其下事件），因此分叉子会话的 eager 单元直接可用；冷路径对 seeded 会话跳过投影缓存，用持久边界折叠自有事件。因此分叉子会话从分叉后的第一次新交流开始计费（刚分叉的会话花费为零），今日花费对每个模型输出只计一次，同一血缘规则同样覆盖多代分叉与 subagent 分叉（`context: 'fork'` 生成）。边界取自已持久化的值，所以恢复后的分叉子会话保持原边界；而创建时没有 seed 的会话——包括普通会话与冷恢复——不带边界，正常全额计费。

## 运行时兼容性

0.1.2-alpha.4 起，DSH 把 live `Session` 的日志读取表面从 `Session.events` 改为 `Session.snapshotEvents()`（无参 = 当前全量日志）与 `Session.ownEvents()`，并把 `SessionHeader.seedLength` 移至 `Session.inheritedEventCount`（持久化侧 `inspect()` 的结果在 `meta` 之外携带该值，`listSnapshots()` 的 header 只剩布尔 `isSeeded`）。插件的所有日志读取都走结构适配器 `liveSessionEvents` / `forkBoundaryOf` / `isSeededSession`，同时接受 ≤ 0.1.1-rc.2 与 0.1.2-alpha.4+ 两种形状——npm 发布基线（`^0.1.2-alpha.5`）与超前于它的 monorepo 运行时代码均无需改动即可工作。遇到两种形状都没有的未知运行时表面时，插件会显式失败而不是静默按零花费计价。

持久化服务的表面同样换代：0.1.1-rc.2 提供 `inspect(id)` / `listSnapshots()`，而 handle 化 seam 提供 `open(id, 'read')` + `SessionHandle.read()` / `list()`。扫描器通过 `persistenceInspect` / `persistenceListSnapshots` 同时读取两代表面（handle 总会关闭，读取失败时也一样），因此同一套插件既能服务已发布的 alpha 线，也能服务重构后的 checkout。`SessionHandle.read()` 自身也有两代：最初返回裸事件数组，DSH `9b78f99dec`（0.1.5-alpha.1 checkout 中）起返回 `{ eventState, events }`；`handleReadEvents` 同时接受两种形状，冷读因此不受该变更影响。

投影缓存的读取同样对准当前 seam：`cachedSnapshot(header, inheritedEventCount, keys)`（零 I/O，只读 wire 行）。它的前身——自己读日志的异步 `coldSnapshot(id)`——已不存在，插件不再依赖它。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4 Flash + V4.1 Flash + V4 Pro + V4 Flash Vision Exp + MiMo-V2.5 系列 | 展示用的模型行，按展示顺序。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京，仅工作日） | 高峰时段窗口，仅周一至周五适用；周末与其余时段均为低谷。 |
| `billing.models` | 官方 V4 + MiMo 费率 | 每个模型的单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token），可带生效时刻 `effectiveFrom`（epoch 毫秒，含该时刻）。 |

只想覆盖某个模型而不丢其它，就提供一个非空的 `billing.models` 列表；空或省略则回退到官方默认费率。同一个模型可以有多行：每行是一个费率版本，用量样本按**样本自身时刻**生效的那一版取峰/谷单价（不带 `effectiveFrom` 的行是该模型的基础版本，同时覆盖更早的一切时刻）。内置价目表已包含 DeepSeek **2026-09-10 12:00（北京时间）** 的调价（`FLASH_SERIES_RATE_CHANGE_AT`）：V4 Flash 系列降为谷时 0.02 / 1.0 / 4.0，峰时为其两倍；V4 Pro 与 MiMo-V2.5 系列仍按 2026-08-17 实行的费率。该时刻之前的样本沿用被取代的旧价，因此跨越调价点的会话或自然日也能精确计价。

## 模型体验

无，因为本包是 provider 与会话事实的只读 Remote 投影，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；它唯一的 provider 调用是一次带凭据的 `/user/balance` 读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **有费率行才计价** —— 会话花费与今日花费只统计价目表（`billing.models`）里有的模型；没有费率行的模型不计入。`assistant/attempt` 用最近一条 `request/header` 的模型计价，因此首条 header 之前的 attempt 不计入。
- **最多 60 秒延迟** —— `getTodaySpend()` 由宿主侧缓存服务最多 60 秒；只有手动刷新（`force`）立即重算（仍受 revision 门控，日志未变则零成本）。浏览器端「本会话花费」读的是推送的投影值，因此不会滞后。
- **额度带 TTL 缓存** —— 一份 `/user/balance` 快照最多复用 15 秒，单次请求 5 秒超时；`force`（手动刷新）绕过 TTL。
- **投影计价跟随官方费率版本** —— 投影折叠按样本时刻解析费率版本，官方调价因此无需重折；手工改 `billing.models` 则只影响变更后折叠的事件，直到状态版本或进程重置（事件路径回退会重算整个日志）。
- **冷缓存行可能滞后于日志** —— 冷会话若缓存行覆盖查询日，会重读日志以求精确；若缓存行自身的日期不是查询日则直接采信、不读日志，因此进程在最后一次检查点之后、最后一条事件之前崩溃的会话，其尾部可能暂时少算，直到该会话被重新读取。
