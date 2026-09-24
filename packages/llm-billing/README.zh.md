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

插件注册 `billing` Remote，含七个方法：`getBalance(force?)`（解析后的 `/user/balance` 快照；15 秒宿主 TTL 内复用，`force` 绕过，单次请求 5 秒超时）、`getSessionSpend(sessionId)`（单个会话的计费花费）、`getTodaySpend(force?)`（当前北京时间自然日内所有会话的计费花费合计；`force` 绕过宿主侧缓存，供徽标手动刷新使用）、`getTodaySessionsSpend(force?)`（今日按**对话**的计费花费，按花费从高到低排序，每行带会话的持久标题与该会话自身今日份金额——见[子代理会话并入父会话行](#子代理会话并入父会话行)）、`getDelegatedSpend(sessionId, force?)`（一次对话的子代理部分——见同一节）、`getTurnSpend(sessionId, messageId)`（单个已完成回合的计费花费，按收尾助手消息 id 定位）与 `getSessionTurnSpends(sessionId)`（该会话所有已完成回合的 `messageId → 金额` 映射，一趟折叠——对话每个消息行都要显示金额，客户端因此每会话只拉一次，而不是逐行调用 `getTurnSpend`）。计价的样本来源有两处：`assistant/message` 自身的 usage，以及失败/重试的 `assistant/attempt` 内嵌 stream 里的 usage（后者用最近一条 `request/header` 的模型），各按样本自身发生时刻（北京时间）所在的峰/谷单价、以及该时刻生效的官方费率版本计价——高峰窗口仅周一至周五适用，周末全天按低谷价。同一 `(turn, step)` 的后一份样本替换前一份，`llm/retry-started` 之后重试的那次累加，与 DSH 自己的回合用量口径一致；随后按模型汇总。一个回合即收尾消息所在的 `turn/start`..`turn/end` 区间；排行从每个会话日志里最后一条 `session/title` 事件折叠标题（last-wins，重命名事件一旦提交、会话被重新读取即反映新名字）。

### 今日花费读取路径（消息触发不再全量扫描）

`getTodaySpend()` 每次请求都不会全量扫描所有会话日志。一个 60 秒的北京日缓存带 in-flight 合并，服务于消息触发的读取；此外 **stale-while-revalidate** 把「等」这件事也拿掉了：窗口一过期，普通读者手上只要有当天的值就立刻拿到它，重扫放到后台跑，因此切会话永远不会等当天那次全会话扫描。**带 `force` 的读取**则相反——它会阻塞等新值：这就是手动刷新，以及徽标在回合结束后的重算（这一轮刚刚改变了答案，不能把「这一轮之前的值」给它，否则今日行每轮都慢一拍）。当天还没有值的读取同样阻塞（首次读取，或跨北京日翻篇：昨天的合计绝不会当作今天的值返回），因为那时没有可诚实展示的东西。窗口按扫描**完成时刻**盖章，而不是开始时刻：慢于自身 TTL 的一趟扫描否则一出生就是过期状态，之后每次读取都会紧接着再起一趟。缓存未命中时，**一次扫描同时产出聚合、排行与子代理读取所需的全会话累计**（聚合即排行各行之和）：

- **投影路径**（当组合中装配了 `@deepseek-ai/dsh-session-projection` 时启用）：插件注册客户端可见的 `billingTodaySpend` 投影单元——**注册表一出现就提前注册**，因此 DSH 的 write-behind 会在每个 `turn/end` 为每个会话落一行检查点。live 会话零日志 I/O 直读其 eager 单元；冷会话若投影缓存的 `cachedSnapshot` 行（零 I/O）自身的最新计价日不是查询日，就直接作答，否则（或没有可用行时）才读取日志本地折叠。只有持久化 revision 在上次解析后变化过的会话才会被读取；读取失败的会话按 revision 记住，不再每轮重试。
- **事件路径**（无注册表时的回退）：对每个会话用同一套计价折叠（收集时按北京日过滤，20 万事件上限）。持久化 revision 未变的会话，改用本扫描器之前为**同一个 revision** 折出的结果作答，而不是重新读取；被事件上限截断的那一趟不留记忆，下一趟会重读被截断的部分。

两条路径因此都把 revision 门控当作**缓存，而不是过滤器**：日志未变既不花 I/O，也照样把完整的金额与标题计入合计与排行。若门控只是「跳过未变的会话」而不采用手上已有的解析结果，第一趟之后的每一趟都会悄悄少算今日合计（并丢掉排行行）——投影路径靠已解析单元的记忆避免，事件路径现在与它共用同一份记忆。

进程内首次解析之后，稳态读取只花在日志确实变化过的会话上。日志无法读取的会话带警告跳过（并被记住），而不是让整日合计失败。

两条路径的折叠都是**宿主主事件循环上的同步计算**——也就是处理 GUI 自身往返（切模型、新建会话）的那个循环——所以扫描每折叠 `SCAN_YIELD_SESSIONS`（8）个会话就让出一次事件循环，冷会话并发扇出也按同样节奏让出（`yieldToEventLoop`）。不让出的扫描会把该循环占满整趟，那正是冷扫期间这两个操作看起来「卡死」的原因。

注意：投影路径对每个会话的历史只计价一次，按事件被折叠时的费率。官方费率版本随定价闭包一起进入折叠，并按样本自身时刻解析，因此被调价的系列无论日志多晚折叠都能正确计价自身历史；只有**手工修改配置**（`billing.models`）才只影响变更后折叠的事件（事件路径会重算整个日志），而该解析口径变化时单元 `stateVersion` 会一并提升，使已落检查点被丢弃重折而不是沿用旧值。

### 子代理会话并入父会话行

子代理（subagent）子会话是委派它的那次对话花的钱，而不是用户打开的会话，所以今日排行列的是**对话**：每一行子代理会话在排序之前都被并入其 `parentSession` 链顶端那个顶层会话的行里。DSH 会在子会话的持久 header 上盖 `origin: 'subagent'`、委派方会话 id 与 `delegationDepth`（父深度 + 1），两个标记都以结构方式读取，任一存在即认定为子会话，因此多代委派（子代理又派子代理）同样落到同一个顶层行。**用户手动分叉**的会话虽然也带 `parentSession`，但不带任何 subagent 标记，仍然是自己一行。

合并后的行给出两个金额：`total` 是这次对话的整日花费（本会话加上它（递归）委派的每个子代理），`ownTotal` 是本会话自己的花费，当天没有任何后代计价时两者相等。整日**合计**（`getTodaySpend`）不变：两条路径求和的是同一批会话，合并只是把行重新归组，不会在总额之间搬钱。顶层会话自己当天没计价、但它的子代理计价了，它照样有一行（`ownTotal` 为 0），标题取自扫描时折出的日志。

浏览器还需要同一套「对话」口径去显示整日／整份日志的花费，而会话自己的日志无法为它的委派子会话计价——所以有了 `getDelegatedSpend(sessionId)`：返回那棵子树的金额，即该会话（递归）委派的每个子代理会话、按其日志覆盖的每一天求和，并把模型行合并（分项仍然加得起来）。它与今日花费**共用同一次缓存扫描**（那一趟本来就会折出每个会话的全会话累计，因此这里不额外读日志），并额外给出 `isSubagent`——被查询的会话自己是不是委派子会话（是的话它的花费落在委派它的那个会话的排行行里）。用户手动分叉永远不会被算作委派子会话（它带 `parentSession`，但不带任何 subagent 标记）。

徽标把这棵子树加到会话自身的实时花费上：`本会话花费` 因此读作**整次对话**的金额（徽标与面板共用同一文案）。同一次读取还会给出 `crossedDay`——被查询的会话是否创建于当前北京日之前——它是面板括号里「今日份」的开关：金额仍取排行行的 `total`（两边都是合并口径、数的是同一棵树），但**是否显示**取决于创建日，而不是比较两个金额，因为实时的会话数字与 60 秒缓存的排行行在回合中途本来就会不一致。

## 分叉会话

分叉会话（DSH 的「分叉会话」）的日志以来源会话事件的逐字节副本开头。若不特殊处理，同一批模型输出会按副本数重复计费：子会话的会话花费会包含继承前缀，今日花费也会在父会话之外再计一次。插件只对会话的**自有事件**计费——分叉边界取自已持久化的会话状态（≤ 0.1.1-rc.2 运行时为 `header.seedLength`；0.1.2-alpha.4+ 运行时为 `Session.inheritedEventCount`（live）／`SessionHandle.inheritedEventCount`（打开的 handle），两者都以结构方式读取）。`billingTodaySpend` 单元本身**带边界**（状态里存着切割点，`apply` 跳过其下事件），因此分叉子会话的 eager 单元直接可用；冷路径对 seeded 会话跳过投影缓存，用持久边界折叠自有事件。因此分叉子会话从分叉后的第一次新交流开始计费（刚分叉的会话花费为零），今日花费对每个模型输出只计一次，同一血缘规则同样覆盖多代分叉与 subagent 分叉（`context: 'fork'` 生成）。边界取自已持久化的值，所以恢复后的分叉子会话保持原边界；而创建时没有 seed 的会话——包括普通会话与冷恢复——不带边界，正常全额计费。

## 运行时兼容性

0.1.2-alpha.4 起，DSH 把 live `Session` 的日志读取表面从 `Session.events` 改为 `Session.snapshotEvents()`（无参 = 当前全量日志）与 `Session.ownEvents()`，并把 `SessionHeader.seedLength` 移至 `Session.inheritedEventCount`（live）／`SessionHandle.inheritedEventCount`（持久化侧 `open(id, 'read')` 返回的 handle）。插件的所有日志读取都走结构适配器 `liveSessionEvents` / `forkBoundaryOf` / `isSeededSession`：live 表面是保留两代形状的那一个——`liveSessionEvents` 同时接受 ≤ 0.1.1-rc.2 的 `events` 快照与 0.1.2-alpha.4+ 的 `snapshotEvents()` 读取器——而 `forkBoundaryOf` 优先用精确的 `inheritedEventCount`（live 或 handle），否则回退到持久化的 `header.seedLength`，因此 npm 发布基线（`^0.1.7-alpha.2`）与超前于它的 monorepo 运行时代码均无需改动即可工作。遇到两种形状都没有的未知运行时表面时，插件会显式失败而不是静默按零花费计价。排行的血缘读取同样以结构方式完成：header 里既没有 `origin: 'subagent'` 也没有非零 `delegationDepth` 的会话（旧日志，或创建时就没有这两个字段的会话）直接视作顶层会话、保留自己一行。

持久化服务现在是「仅 handle」一面：提供 `open(id, 'read')` + `SessionHandle.read()` / `list()`（DSH 0.1.2-alpha.5+，正是插件 `^0.1.7-alpha.2` peer 目标的那一族）。扫描器只走这一面：`persistenceListSnapshots` 就是对 `list()` 的薄封装，`persistenceInspect` 打开 handle、读取、并在 `finally` 里关闭（因此无论读取成功与否，handle 总会关闭）。旧的 `inspect(id)` / `listSnapshots()` 表面已删除（Item 7），生产现在只服务 handle 这一族。`SessionHandle.read()` 本身仍有两代返回形状——最初返回裸事件数组，DSH `9b78f99dec`（0.1.5-alpha.1）起返回 `{ eventState, events }`；`handleReadEvents` 同时接受两种形状，冷读因此不受该代际变更影响。

投影缓存的读取同样对准当前 seam：`cachedSnapshot(header, inheritedEventCount, keys)`（零 I/O，只读 wire 行）。它的前身——自己读日志的异步 `coldSnapshot(id)`——已不存在，插件不再依赖它。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4.1 Flash（`deepseek-flash`）+ V4 Flash + V4 Pro + V4 Flash Vision Exp + MiMo-V2.5/V2.6 系列 | 展示用的模型行，按展示顺序；与 DSH `llm-deepseek` 目录对齐（另保留已退役的 `deepseek-v4.1-flash-expires-on-0910` 预览 id，让历史日志仍有可读标签）。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京，仅工作日） | 高峰时段窗口，仅周一至周五适用；周末与其余时段均为低谷。 |
| `billing.models` | 官方 V4 + MiMo 费率 | 每个模型的单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token），可带生效时刻 `effectiveFrom`（epoch 毫秒，含该时刻）。 |

只想覆盖某个模型而不丢其它，就提供一个非空的 `billing.models` 列表；空或省略则回退到官方默认费率。同一个模型可以有多行：每行是一个费率版本，用量样本按**样本自身时刻**生效的那一版取峰/谷单价（不带 `effectiveFrom` 的行是该模型的基础版本，同时覆盖更早的一切时刻）。

内置价目表已包含 DeepSeek 的两轮调整，跨越任一变更点的会话或自然日都能精确计价：

- **2026-09-10 12:00（北京时间）**（`FLASH_SERIES_RATE_CHANGE_AT`）：整个 flash 系列——V4.1 Flash 路由 `deepseek-flash`（当日发布，现为 DSH 默认模型）、V4 Flash、V4 Flash Vision Exp 以及已退役的预览 id——降为谷时 0.02 / 1.0 / 4.0，峰时为其两倍；更早的样本（含该路由 12:00 之前的自身用量）沿用被取代的旧价。
- **2026-09-14 12:00（北京时间）**（`V4_PRO_ROUTE_SWITCH_AT`）：V4 Pro 路由按公告改由 V4.1 Flash 服务并按 V4.1 Flash 计费，该行因此带有第二个费率版本。
- MiMo-V2.5 与 V2.6 系列不受两轮调整影响（统一费率；V2.6 于 2026 年 9 月 22 日发布，沿用 V2.5 公布的费率）。

## 插件管理页的展示元数据

插件管理页上本包那一行显示的标题、描述与图标都取自包自身（宿主不执行任何插件代码）：

- `locale/en.json` 与 `locale/zh.json` —— 形状 `{"meta": {"title": …, "description": …}}`，按当前界面语言解析、回落英文。
- `icon.svg` —— 自包含 SVG（不引用任何外部字体或图片），由 `package.json` 顶层的 `icon` 字段声明。

两者都经包的 `exports` 解析，所以 `./locale/*.json` 必须保持导出——去掉它会让 locale 文件解析成 `ERR_PACKAGE_PATH_NOT_EXPORTED`，宿主把它当作「没有元信息」，静默回落到裸包名。`locale/*.json` 与 `icon.svg` 也必须留在 `files` 里，否则打出的 tarball 两个都不带。

## 模型体验

无，因为本包是 provider 与会话事实的只读 Remote 投影，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；它唯一的 provider 调用是一次带凭据的 `/user/balance` 读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **有费率行才计价，且不靠名字猜** —— 会话花费与今日花费只按价目表（`billing.models`）里该模型自己的行计价；没有行就不计价，但用量会记为 `unpriced` 并按模型告警一次（其中写明模型名），而不是无声丢弃。要给它计价，在 `billing.models` 补一行即可。`assistant/attempt` 用最近一条 `request/header` 的模型计价，因此首条 header 之前的 attempt 不计入。
- **合并行可能没有标题** —— 子代理的父会话不在本次扫描范围内时（例如父日志已被删除或归档），该行仍按其 header 里写的父会话 id 归属，但父会话日志从未被读取，合并行因此没有标题，浏览器显示「未命名」兜底。
- **最多 60 秒延迟，但不会让人白等** —— `getTodaySpend()` 由宿主侧缓存服务最多 60 秒；过了这个窗口，普通读取直接拿到上一次的值、重扫放到后台，因此读者从不等待当天那次扫描（除非它主动要求等）。带 `force` 的读取（手动刷新，以及徽标在回合结束后的重算）会等一次重算——仍受 revision 门控，日志未变则零成本。浏览器端「本会话花费」读的是推送的投影值，因此不会滞后；它括号里的今日份金额取自已拉取的今日会话排行（`getTodaySessionsSpend()`，同样受 60 秒缓存与 revision 门控），所以那一项最多滞后 60 秒。
- **额度带 TTL 缓存** —— 一份 `/user/balance` 快照最多复用 15 秒，单次请求 5 秒超时；`force`（手动刷新）绕过 TTL。
- **投影计价跟随官方费率版本** —— 投影折叠按样本时刻解析费率版本，官方调价因此无需重折；手工改 `billing.models` 则只影响变更后折叠的事件，直到状态版本或进程重置（事件路径回退会重算整个日志）。
- **冷缓存行可能滞后于日志** —— 冷会话若缓存行覆盖查询日，会重读日志以求精确；若缓存行自身的日期不是查询日则直接采信、不读日志，因此进程在最后一次检查点之后、最后一条事件之前崩溃的会话，其尾部可能暂时少算，直到该会话被重新读取。
