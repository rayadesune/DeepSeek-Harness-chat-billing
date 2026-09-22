# HANDOFF — 适配 DSH 0.1.7-alpha.2 基线（2026-09-23 · 阶段 A，未提交）

* 背景：dsh 源码 checkout 升到 `dsh-v0.1.7-alpha.2`（vendor 同步 cordis 4.0.4 / schemastery
  3.18.4），插件按旧基线 0.1.6-alpha.1 构建后不可用；本轮把依赖基线整体升档并适配破坏面
* 破坏点与修复：
  - typert codec：0.1.7 loader 只认带 `create` 工厂的 codec；0.1.7 generator 已原生产出
    `create: schema`，产物直接可用。`typert-compat.mjs` 降级为安全网（无 create / 未知形状
    即非零退出），`verify` 改为按 codec 块判定（逐行计数会误伤清单里 `TYPERT.schemas` 的
    `create` 条目）
  - cordis 双实例：换装依赖后 `.pnpm` 残留两个 peer 组合的 cordis 4.0.4，`Context.invariants`
    的模块增强不合并、host 编译报 `Property 'invariants' does not exist`。pnpm v11 删 lockfile
    后仍以现有 node_modules 为真值回写（"Already up to date"），必须**清空 node_modules 强制
    重解析**才收敛为单实例（include@1.0.9 + loader@1.0.5）
  - 客户端包漏声明依赖（AGENTS 既有条款两例）：primitives 产物 import `simple-icons`（上游仅
    devDep）、`dsh-client-web` 产物 import `dsh-client-ui-dockkit`（清单完全未声明）→ 补进
    ui-billing devDeps
  - 已发布 test-runtime 的 lib import 三个未随包发布的 `src/` 路径 → 沿用 fixture + vitest
    alias 机制：刷新 `renderer-src`（scoped-slots/bindings + 新增 errors.ts）、新增
    `session-controller-src/client/scope.ts` 及对应 alias
  - locale 插件改走 `configForms`（不再 `settingsScope`，test-runtime 删 `stubSettingsScope`
    换 `stubConfigForm`）→ browser-plugin spec 的 bench 提供 `configForms` stub
  - 图标改名：`Icon*Outline14` → `Icon*OutlineRegular`（补 `size={14}` 保 14px 观感）
  - jsdom 无 ResizeObserver：0.1.7 Tooltip 等 observer 报尺寸才显示气泡 → module-loader.setup
    加同步回调尺寸的 stub
  - 内嵌 `packages/typert-protocol` 刷新到 0.1.7-alpha.2（新增 json-value/owned-value/PeerId
    等；`dsh-brand` 类型依赖以本地内联 `Branded` 替代，保持零新依赖）
* 校验（完整档，一轮）：`pnpm run test` 260/260 全绿（9 文件）→ `pnpm run build`（host+client
  两面，16 codec 全带 create）→ `pnpm run verify` 全绿
* 本地安装：`scripts/local-install.mjs ui-billing llm-billing --face both` 装入 web profile
  （0.3.14 同版本重打重装），抽查 `TYPERT.package` 与 16 个 `create:` 均在装好的 lib 内
* 文档跟改：AGENTS.md（依赖基线行、漏声明条款、typert 条款）、根双语 README + llm-billing
  双语 README（基线行与 typert 段）、两处 `README.i18n.yaml` hash 重录、pnpm-workspace 注释
* 用户侧同步：全局 npm 的 dsh CLI 已按用户要求卸载（用户以源码构建运行 dsh）；profile 内
  用户单独安装的 `dsh-browser-use` / `dsh-computer-use` 仍钉 0.1.6-alpha.1，与本轮无关、
  需要时另装

---

# HANDOFF — 发布记录（2026-09-18 · v0.3.14）

* 提交：`4c12442`（feat(ui)：余额序列口径的今日消费 + 可见页 5 分钟轮询）+ `ac03fa6`（docs：双语
  README 与 HANDOFF 记录口径）+ `3a9e630`（release: v0.3.14，三包版本对齐 + AGENTS.md + lockfile），
  已推送 origin/main；本条发布记录为随后的 `docs:` 提交
* tag：`v0.3.14` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.14
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-client-ui-billing` /
  `@rayadesu/dsh-billing` 均为 **0.3.14**（三个包发布后都处于 npm "being processed"，约 200 秒后复核
  已全部落库）
* 版本对齐：三包 0.3.13 → **0.3.14**（根 bundle 两条 peerDeps 与 ui-billing 的 peer/dev
  `@rayadesu/dsh-llm-billing` 范围同步 `^0.3.14`），`pnpm-lock.yaml` 随 `pnpm install` 刷新
* 发布前校验：`pnpm run test`（**260 用例全绿 / 9 文件**）/ `build`（host + client 两面）/
  `verify`（`client bundle stamps version 0.3.14`）全绿
* 本轮内容：面板 `API 剩余金额` 后的「今日消费」（纯 API 加减口径 + 10 元步进充值识别 + localStorage
  当日记录）+ 余额改为页面可见时每 5 分钟轮询（隐藏暂停、回到前台补一次）
* 发布流程未使用 token：本机 npm 已登录 `rayadesu`，`npm publish` 直接发布，**未把任何凭据写入仓库**
* 本机 web profile 仍是 `file:` 引用本地 tarball（那份 tarball 是版本号 bump 之前的同源码构建，
  面板说明里显示 0.3.13）；切到 npm 源：
  `dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`

---

# HANDOFF — 面板新增「余额序列口径的今日消费」（2026-09-17 · API 加减口径）

* 需求：面板 `API 剩余金额` 的金额后加一个「今日消费」小字（与另外两个紧跟数字同样式、只有数字没有文字），
  口径**纯按 API 加减** —— 以当日第一次查询余额为首、减去当前金额；消费与充值统计规则照
  `C:\Users\admin\Desktop\me\code\balanceinfo` 程序；并在 info 提示里补一行说明这个数字的含义
* 口径（对照 balanceinfo `client/src/utils/balance.ts` + `components/Dashboard.tsx`）：
  `今日消费 = max(0, 当日首次查询余额 − 当前余额 + 当日充值)`，当日充值 = 相邻两次采样余额**上涨**按
  **10 元步进向上取整**（`ceil(growth/10)*10`，growth ≤ 0 记 0）；「当日」用**本地自然日**
  （balanceinfo 的 `toLocalDayKey`），与宿主「北京日」的 token 计价口径刻意分成两个数字
* 改动（全部在 `packages/ui-billing` 客户端半面，宿主与 Remote 未动）：
  - 新增 `src/client/balanceDay.ts`：整数「分」账本（`{day, currencies:{first,last,recharge}}`）+
    `createBalanceDayTracker(storage)`，每次采样写穿 `localStorage`（键 `dsh.billing.balance-day.v1`），
    存储缺失/抛错退化为内存，坏 JSON 与版本不符读作「无记录」
  - `src/client/index.ts`：注入面新增 `getBalanceDaySpend(balance)`，采样只发生在 `getBalance` 这一个入口
    （`getCachedBalance` 是重放已记过的值，不采样，避免用陈旧值挪动当日基准）
  - `useBillingData` 从屏幕上的同一个 balance state 派生 `balanceDaySpend`（不发 Remote、不会与金额不同步）；
    `BalancePanel` 在金额行渲染 `.amountToday` 小字（amount-only 的 `label.amount.todaySpend`，与另两个
    rider 共用同一条一级样式规则），`null`（当天无该币种采样）时整块不渲染而不是显示 `¥0`
  - `useBillingData` 新增可见页余额轮询：`BALANCE_POLL_MS`（5 分钟），`visibilitychange` 隐藏即停、回前台
    立刻补一次；失败沿用「保留最后一次已落定值」
  - locale 提示 4 行 → 5 行：新增「API 剩余金额后的数字为今日消费：今日首次查询余额 − 当前余额 + 今日充值
    （充值按 10 元步进识别）。」；原「紧跟的数字为本会话今日花费」改为「本会话花费后的数字为…」（现在有两个
    紧跟数字，旧说法有歧义），测试的字数预算与行断言同步
* 取舍：**加轮询**（用户在看到首日数字偏小后拍板）—— 「今日消费」的基准是「当天第一次采样到的余额」，
  采样节奏就是它的分辨率：原来只在挂载/切会话/手动刷新时查询，页面跨 0 点开着也不会在 0 点后采样，中途充值
  也只能在下一次挂载才被发现。现按 balanceinfo 本体的节奏补齐：**页面可见时每 5 分钟轮询**（走缓存路径，
  宿主 15 秒 TTL 仍合并），页面隐藏暂停、回到前台立刻补一次（跨 0 点睡过去的标签页因此会重新起算当天基准）。
  注意这与「今天」无关：本插件是新装上的，今天的第一条采样只能是装上之后第一次查询的金额，今天早上到装上
  之前的消耗取不回来（API 无历史接口），从这个新版本起才有完整的一天
* 校验：`pnpm run test` 全套（**260 例 / 9 文件全绿**）+ `local-install.mjs ui-billing --face client`（构建 →
  打包 → 装入 web profile，产物命中 `label.amount.todaySpend` / `amountToday`）；文档：两包 README 双语 +
  两处 `README.i18n.yaml` blob hash

---

# HANDOFF — 文档修复（2026-09-16 · README 预览图在收录站不显示）

* 问题：收录站详情页 https://awesome-dsh-plugin.com/zh/p/rayadesune/DeepSeek-Harness-chat-billing/
  只渲染 README 文字，三张 `preview-*.png` 一张都不显示（页面 HTML 里 `<img>` 数为 0）
* 根因（对照同站其它插件页实测）：站点渲染器**只对 Markdown 图片语法 `![alt](相对路径)` 做
  「相对路径 → raw.githubusercontent.com」重写**；README 里用裸 HTML `<img src="相对路径" />`
  的条目（`Aafff623/dsh-callout`、`2768651338/dsh-effort-slider`、`addie-ace/dsh-livebench-rankings`
  以及本站）在该站页面上一律 0 张图，而用 Markdown 语法的（`Han-1413141/dsh-cost-meter`、
  `zh667/TokenLedger`、`bowenliang123/dsh-context`）图片正常
* 改动：`README.md` / `README.zh.md` 三处 `<img width=… alt=… src="preview-*.png" />` 改为
  Markdown 写法（代价是丢掉 `width` 属性，两个站点都按容器宽度自适应）；`README.i18n.yaml`
  blob hash 同步。`screenshots.json` 本来就在仓库根、与 `package.json` 同级，无需改动
* 站点 README 由它自己的 nightly 构建（`.github/workflows/build-site.yml`，cron `23 2 * * *`）
  抓取，push 本站不触发它重建 —— 推送后要等它下一次成功构建才会显示图片；顺带发现它当前
  抓到的还是 **2026-09-12 之前**的旧版 README，说明上一次 nightly 抓取已滞后

---

# HANDOFF — 发布记录（2026-09-15 · v0.3.13）

* 提交：`b48f3fe`（fix：DSH 0.1.6 基线 + typert 桥接）+ `2b882f0`（feat：宿主对话口径）
  + `786fd9a`（feat(ui)：整次对话口径）+ `d17bbf4`（feat(ui)：命中率 + 三级字体）
  + `81b638a`（chore：收尾脚本 + gitignore）+ `f46f6af`（docs：双语文档与成本纪律）
  + `5760ecb`（release: v0.3.13），已推送 origin/main；本条发布记录为随后的 `docs:` 提交
* tag：`v0.3.13` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.13
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-billing` 立即为 **0.3.13**；
  `@rayadesu/dsh-client-ui-billing` 首次查询仍是 0.3.12（npm "being processed" 暂存，约 3 分钟后落库）
* 版本对齐：三包 0.3.12 → **0.3.13**（根 bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.13`），
  `pnpm-lock.yaml` 随 `pnpm install` 刷新；`release` 提交同时带上阶段 A 的依赖线升级
  （`@deepseek-ai/dsh-*` → `^0.1.6-alpha.1`）与 ui-billing 为独立测试补齐的客户端运行时 devDependencies
* 发布前校验：`pnpm run test`（**238 用例全绿 / 8 文件**）/ `build`（host + client 两面）/
  `verify`（`client bundle stamps version 0.3.13`）全绿
* 本轮发布内容（阶段 A 累积多轮）：DSH 0.1.6 基线适配 + typert codec 双字段桥接、宿主与 UI 的
  「整次对话」口径（委派子代理并入本会话、今日排行按对话归组）、今日 Token 缓存命中率（DSH 官方
  命中率规则）、面板三级字体体系 + 两个紧跟数字去括号 + 单模型隐藏整行模型行、一条命令的阶段 A 收尾脚本
* token 由用户提供，**仅内联传参，未写入仓库任何文件**
* 本机 web profile 仍用 `file:` 引用本地 tarball（那份 tarball 是版本号 bump 之前的同源码构建，
  面板说明里会显示 0.3.12）；切到 npm 源：
  `dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`

---

# HANDOFF — 发布记录（2026-09-12 · v0.3.12）

* 提交：`81a4899`（feat：面板今日口径 + DSH 官方文案，含另一会话停放的输入框卡片源码）
  + `76f6b24`（docs：双语文档与预览图）+ `59dc8d1`（chore：打码脚本入库）
  + `005512e`（release: v0.3.12），已推送 origin/main；本条发布记录为随后的 `docs:` 提交
* tag：`v0.3.12` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.12
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-billing` 立即为 **0.3.12**；
  `@rayadesu/dsh-client-ui-billing` 首次查询仍是 0.3.11（npm "being processed" 暂存，约 3 分钟后落库）
* 版本对齐：三包 0.3.11 → **0.3.12**（根 bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.12`），
  `pnpm-lock.yaml` 随 `pnpm install` 刷新。**与往轮的偏差**：README 的版本示例与 `AGENTS.md`
  版本行已在 `docs` 提交里同步，`release` 提交因此只含三包 package.json 与 lockfile
* 发布前校验：`pnpm run test`（**211 用例全绿**）/ `build` / `verify` 全绿（`client bundle stamps
  version 0.3.12`）
* **另一会话的工作一并入库**：输入框花费卡片（`SpendCard.tsx` / `spendBuckets.ts` / `useCardDialog.ts` /
  `icons.tsx` + 11 条用例 + `card.*` locale 键 + `@types/react-dom` devDependency）随 `feat` 提交
  进入仓库并发布；其注册块按注释停在 `src/client/index.ts`，**bundle 行为不变**。因为 `locales.ts`
  与两份 README 里两个会话的改动交织在同一批行上，没有硬拆提交，而是在 feat 提交信息与
  release notes 里写明了这部分来源与停放状态
* token 由用户提供，**仅内联传参，未写入仓库任何文件**
* 本机 web profile 仍用 `file:` 引用本地 tarball；已按 0.3.12 重新打包安装（换 npm 源：
  `dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`）

---

# HANDOFF — 面板三级字体体系 + 两个紧跟数字去括号（2026-09-15 已实施，阶段 A 未提交）

## 需求（用户原话）

> 「定义一下字体样式：未缓存输入 ¥0.232 · 缓存读取 ¥0.314 · 输出 ¥0.599 和 会话排行连带后面金额数字
> 是一级样式 / 今日会话花费 的标题，模型名这些，是二级样式 / 本会话花费，今日token这些，是三级样式 /
> 以上样式均包含对应的金额数字相关的元素 / 将括号的元素改成一级样式，并且去掉括号，只保留数字本身」

**编号口径**：一级 = 最细的一档（明细与数字），三级才是那几行「有名字的行」。面板此前事实上已经是
这三档，但没有任何地方把它们定义或约束住——本轮把它写成体系。

## 改动

* **三级字体只定义在一处**：`BalanceBadge.module.css` 的 `.panel` 新增 9 个自定义属性
  （`--billing-type-{1,2,3}-{size,line,tone}`），每个文本类只引用自己那一级的 token，改一级即整级生效：
  * **一级** `11px/16px` tertiary tabular-nums —— 桶明细行（`.costBreakdown`：今日两行 + 每个模型一行）、
    今日会话排行整行（`.rankingIndex` / `.rankingDot` / `.rankingName` / `.rankingAmount`）、
    `.rankingMore`，以及两个「紧跟数字」。
  * **二级** `12px/18px` secondary —— 模型名（`.modelName`）**及其行金额**（`.tasks`，原为最暗的
    tertiary，现与模型名同级同色）、`今日会话花费`（`.rankingTitle`）。
  * **三级** `13px/18px` primary tabular-nums —— 今日 Token / 今日花费 / 本会话花费（`.amountLabel`；
    余额行仍在 `.amountRow > .amountLabel` 里叠加 15/22 的抬头尺寸）。
* **两个紧跟数字并为一级样式、去括号**：`.subValue` 拆成 `.sessionToday`（本会话今日份）与
  `.todayHit`（当天命中率），共用同一条一级规则；locale 由 `（{amount}）` / `（{percent}%）` 改为
  ` {amount}` / ` {percent}%` —— **只靠一级色调 + 一个前导空格**与行内自己的数字区分。
  说明气泡第三行随之改为「紧跟的数字为本会话今日花费。」/「The figure after it is this session's
  spend today.」（仍在 122 / 295 字符上限内）。
* **测试**：新增一条锁死体系的用例（读样式表逐类断言所属级别、9 个级别定义存在、两个 locale 无括号）；
  命中率与今日份的断言改为按 `.todayHit` / `.sessionToday` 类名 + `waitFor` 取值。
* **文档**：4 份 README 共 32 处「括号」措辞改为「紧跟」（`node` 脚本一次改完，逐条回计数，规则零 miss）；
  `ui-billing` 中英 README 各补一条「面板排版只有三级」的说明。预览图注仍描述旧图，未改。

## 校验（常规档）

* `vitest run packages/ui-billing`：**83 用例全绿**。
* `node scripts/local-install.mjs ui-billing --face client --check billing-type-1-size --check sessionToday
  --check todayHit`：一条命令完成构建 → pack → remove/add → 产物抽查。

## 后续微调（同日 · 第二、三次）

* 用户原话（第二次）：「模型金额亮度改回去吧，并且二级样式得数值金额就依次定义 / 在只有单模型的时候，
  隐藏模型金额，多模型才显示 / 还有本会话今日花费和命中率小字离前面数值再远一点，现在太近了」；
  （第三次澄清）「.tasks 也算二级成员呀，二级成员里面文字色调可以不和数字一样呀，今后如果有二级成员的
  金额也按照这个色调来 / 单模型不仅隐藏金额，把模型名一块隐藏」
* **同一级里文字与数字的色调允许不同**：`.tasks` 仍是**二级成员**（二级字号 12/18），数字改用该级自己的
  数字色调 `--billing-type-2-number-tone`（= tertiary，比模型名暗一档）——今后二级成员的金额一律用它。
  三级体系用例把 `.tasks` 放回二级分组，并显式断言它引用 `--billing-type-2-size` +
  `--billing-type-2-number-tone`（判级别的助手取规则体里第一个级别 token，因此色调 token 的命名也带级别）。
* **只有一个计价模型时整行模型行都不渲染**（`BalancePanel` 的 `modelCount`）：名字在只用一种模型的会话里
  说明不了什么，金额又是上一行「本会话花费」的数字，只留它下面那行桶明细。为此新增
  `.spendRow + .costRow { padding-top: 2px }`——没有名字行接手时，桶明细行自己接下那份表头间距，
  不会贴到分隔线上。用例覆盖两个方向（单模型无名无金额、双模型每行带名字与金额）。
* 两个紧跟小字加 `margin-left: 5px`（叠加 locale 里那一个前导空格 ≈ 排行金额那 8px 间距）。
* 校验：`vitest run packages/ui-billing` 全绿；再走一次 `local-install` 一条命令重打重装。

---

# HANDOFF — 「今日 Token」加缓存命中率括号（2026-09-15 已实施，阶段 A 未提交）

## 需求（用户原话）

> 「给今日token后面的token数值，加上命中率判定 / 样式同'本会话花费'后面的括号 /
> 括号内只有百分比数值，没有文字说明 / 百分比数值的小数位数保留按照官方的命中率规则来」

## 实现

* **口径**：命中率 = 缓存读取 ÷（缓存读取 + 未缓存输入），即 DSH `billedInputTokens` 的
  **prompt 侧**口径（宿主把缓存写入按未命中单价计价、并入「未缓存输入」桶，所以分母与官方一致），
  输出侧不进分母。数据取同一批 `todaySpend.models`，不发新请求。
* **小数位按 DSH 官方命中率规则**（ui-chat `src/client/chat/token-format.ts` 的
  `formatCacheHitPercent` —— 输入框统计 pill 与 token 用量对话框共用的那条）：默认**整数**百分比；
  只有「部分命中会被四舍五入到 100%」时才逐位补小数（`99` → `99.5` → `99.95`），全部走整数运算、
  正半数进位，不吃浮点误差；真·全命中才输出 `100`；prompt 侧 0 token 返回 null。该函数在
  `format.ts` 里**逐条规则照搬**（与 `formatTokens` 同一做法），并保留官方的 `decimalPlaces` 形参。
* **呈现**：括号骑在「今日 Token」的数值后面（`今日 Token：331M tok（99%）`）——只有百分比、
  无文字说明；样式复用「本会话花费」括号那一套（CSS 类 `spendToday` 改名 `subValue`，两处共用
  12px 三级色调）。占位态（`—` / `暂无消耗记录`）不长括号。
* 新增 locale 键 `label.todayTokens.hit`（zh `（{percent}%）` / en ` ({percent}%)`）与
  `spendBuckets.ts` 的 `cacheHitPercentOf()`（纯函数，单测直接盯分母口径）。

## 校验（轻量档）

* 只跑受影响用例：`vitest run packages/ui-billing`（**82 用例全绿**）。原有 5 条「不渲染今日份
  金额括号」的用例用 `queryByText(/^（/)` 断言，会误伤新的命中率括号，已收窄成 `/^（¥/`。
* 新增用例：官方规则（`0` / `50` / `99` / `99.5` / `99.95` / `100` / null，以及一位小数去尾零）、
  输出不进分母、面板里括号跟随 token 数值且类名与「本会话花费」括号一致、无计价日不长括号。
* `pnpm run build:client` 后**只重打重装改动的那一个包**（`rayadesu-dsh-client-ui-billing-0.3.12.tgz`），
  产物抽查含 `label.todayTokens.hit` 与 `subValue`（7 处）。装包时 `plugin remove` 一度被 300s
  超时打断、client 包从 profile 临时消失，随后单条 `plugin add` 重新装回并核对三个 `@rayadesu`
  包齐全。
* 文档：根 README 双语 + `ui-billing` README 双语（面板段落与「今日 Token 只数计价行」条目各补一句
  命中率口径），两份 `README.i18n.yaml` 的 blob hash 同步重记。

---

# HANDOFF — 计费插件适配 DSH 0.1.6 基线（2026-09-15 已实施，阶段 A 未提交）

## 需求（用户原话）

> 「现在dsh更新到0.1.6了，你更新一下计费插件，适配新版本」

## 背景（问题 → 根因）

* 运行的 DSH 是本地 checkout（`me\code\deepseek-harness`）以 `pnpm dsh web`
  （`node --import tsx/esm apps/cli/src/bin.ts web`）跑的源码态，版本 **0.1.6-alpha.1**；
  npm 上 `@deepseek-ai/*` 的 `alpha` dist-tag 也是 0.1.6-alpha.1。
* **根因一：prerelease 区间解析不到新基线。** 本仓库此前把依赖写成 `^0.1.2-alpha.5`，
  而 semver 规定预发布版本只被「同 `major.minor.patch` 元组且带预发布」的比较符匹配，
  所以它永远解析到 0.1.2-alpha.5，跟着 DSH 升到 0.1.6 必须整体改写成 `^0.1.6-alpha.1`。
* **根因二：插件在本机 web profile 里整行消失。** `profiles/web/package.json` 的
  `dsh.profile.bundles` 只剩 `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app`，
  `cordis.patch.yml` 是 `[]`，`node_modules/@rayadesu` 是空目录——profile 是 0.1.6
  更新后重建的模板态，所以这轮除改依赖还要把三包装回去。
* **根因三：0.1.6 的客户端包把运行时依赖漏在 devDependencies 里。** dsh monorepo 靠根
  node_modules 兜住，本仓库独立安装就 `Cannot find package`。

## 改动

1. **依赖基线 0.1.2-alpha.5 → 0.1.6-alpha.1**：根 bundle、`llm-billing`、`ui-billing`
   三处 package.json 的 peer/dev 依赖整体替换；`@deepseek-ai/cordis` `^4.0.1` → `^4.0.2`、
   `@deepseek-ai/schemastery` `^3.18.1` → `^3.18.2`（对齐 monorepo `vendor/` 版本）。
2. **内嵌 typert 协议声明同步到 0.1.6-alpha.1**：0.1.6 删除了 `TypertContextAdapter` 与
   `TypertHostContextIdentity`，`TypertHostContextAdapter` 不再继承前者并自带
   `resolve(id)`，registry 的 `identifyHost()` 也下线；`packages/typert-protocol/src` 按
   发布包逐行同步（`types.ts`/`remote-error.ts` 已 0 差异），`src/invariant.ts` 与
   `./invariant` 导出随 0.1.6 一并移除，package.json 版本/description/peer 同步。
3. **补上游漏声明的客户端运行时依赖**：`dsh-client-store@0.1.6-alpha.1` 的产物直接
   `import 'zustand'`（含 `/vanilla`、`/middleware`、`/shallow`）与 `'immer'`；
   `dsh-client-ui-primitives@0.1.6-alpha.1` 的产物直接 import markdown 视图栈
   （`mdast-util-{from-markdown,gfm,math}`、`micromark-*`、`shiki`、`@shikijs/langs`、
   `katex`、`diff`、`anser`、`clsx`）。二者在上游都只写在 devDependencies，故按上游同版本
   范围补进 `ui-billing` 的 devDependencies（发布 bundle 是外部依赖，运行时仍由 dsh 侧提供）。
4. **清掉内嵌包里的僵尸 node_modules**：`packages/typert-protocol/node_modules` 是它还是
   workspace 成员时留下的，其中 cordis 仍是 4.0.1；workspace 升到 4.0.2 后
   `balance.ts` 的 `super(ctx, 'billing')` 报 TS2379（两个 `Context` 不是同一类型），
   删掉该目录、让它从仓库根解析同一份 cordis 后消失。
5. **关闭 pnpm 发布龄门槛**：`pnpm-workspace.yaml` 显式 `minimumReleaseAge: 0`。pnpm ≥11
   默认 1 天门槛会把刚发布几小时的 0.1.6-alpha.1 挡在 lockfile 校验外，而校验阶段不认
   `minimumReleaseAgeExclude`（那是解析期自动追加的），原先那份自动生成的排除清单随之删除。

## 验证

* `pnpm run test` **235 用例全绿**（8 个 spec 文件，含浏览器半测 module-loader 路径）、
  `pnpm run build`（host + client 两编译面）、`pnpm run verify`（typert 清单归属正确 +
  client bundle 版本戳 0.3.12）全绿。
* 三包沿用 0.3.12 本地 pack（阶段 A 不 bump 版本），`dsh plugin --profile web add` 三个 tgz
  重新装入 web profile；`dsh --profile web --dump-config` 已确认 bundle 补丁层展开出
  `llm-billing` / `ui-billing` 两行。
* 待用户重启 `dsh web` 并硬刷新验证：会话头部余额徽标、本轮花费与今日花费是否正常。

## 追加（同日首轮交验失败 → 修复）

**现象**：三包装进 web profile 重启后 DSH 直接停在启动页——
`Failed to load plugins / @rayadesu/dsh-client-ui-billing / web boot: 1 entry did not activate /
@rayadesu/dsh-client-ui-billing: failed`（一个客户端条目没激活，整个 Web shell 拒绝挂载）。

**根因**：宿主行先挂，客户端行随后 `$mount` 跟着失败；真正原因只在宿主 stderr 里。
用隔离实例（`DSH_HOME=<临时目录>` + 独立端口）复现，一次就拿到：

```
dsh: warning: 1 entry did not activate
typert-loader (@deepseek-ai/dsh-typert-loader): AggregateError: typert-loader: 1 typert contributor(s) failed to register:
  - typert-loader: @rayadesu/dsh-llm-billing invocation
    "@rayadesu/dsh-llm-billing#billing/getBalance" parameter codec has no create() factory
```

即**运行中的 dsh 是 checkout HEAD，领先于 npm 上的 0.1.6-alpha.1**：HEAD 的
`perf(typert): materialize generated schemas on first use` 把 strict codec 从
`{ mode, typeSymbol, schema }` 改成 `{ mode, typeSymbol, create() }`，loader 见不到
`create` 就拒绝注册；而 npm 上最新的生成器（仍是 0.1.6-alpha.1）只生成 `schema`，其
loader 又要求 `schema` 是 zod v4 对象。两代读取方都不拒绝自己不读的字段——所以
**两个字段都带**即可同时满足两条线。客户端半面同理：HEAD 的 api-gateway client 用
`codec.create().parse()` 解析参数，旧产物在调用时也会炸。

**改动**：新增 `scripts/typert-compat.mjs`，挂在 `build:host` 的 tsdown 之后，给
`lib/typert.host.js` 与 `lib/typert.remote-client.js` 里每个 strict codec 补上
`create: () => <schema>`（保留 `schema`）；脚本幂等，遇到两种形状都没有的 codec 直接
构建失败（换生成器时不会静默放过）；`verify-packages.mjs` 增加「strict codec 数 ==
`create: () =>` 数」门禁。**教训**：只跑 tsdown 不跑 `build:host` 会漏掉这一步。

**验证方式（可复用，全程未碰用户 GUI）**：宿主用
`DSH_HOME=<临时目录> pnpm dsh web --port <空端口> --no-open` 起隔离实例读 stderr；
客户端用无头 Edge + CDP（`--remote-debugging-port`，Node 内置 `WebSocket` 直连）加载带
token 的 URL，读 `document.body.innerText` 有无失败浮层，并查
`style[data-plugin="@rayadesu/dsh-client-ui-billing"]` 是否注入（证明 bundle 真被物化）。
修复后：宿主启动零告警、失败浮层消失、样式注入到 2 个 `<style>` 标签、console 零错误；
调试实例与临时 `DSH_HOME` 已删除，用户 3080 上的实例全程未受影响。

---

# HANDOFF — 本会话花费改为「整次对话」口径（含委派的子代理）（2026-09-14 已实施，阶段 A 未提交）

## 需求（用户原话）

> 「徽标/本会话花费也显示含子代理的花费吧，不用改文案『本会话花费 ¥A · 含子代理 ¥B』，保留原文案，
> 只数字改动，在hint页加上说明就行」

## 口径

* 会话行（徽标「本轮对话花费」与面板「本会话花费」）显示的是**整次对话**的花费：本会话自身的
  花费（实时投影）**加上它（递归）委派的每个子代理会话**（跨天累计，模型分项一并合并，所以分项
  仍然加得起来）。文案不变，说明加在「?」提示里。
* 括号里的「今日份」同时改为**合并口径**：与排行行的 `total`（宿主已把子代理并进其中）比较，
  两边数的是同一棵树；`ownTotal` 保留为行的分解事实（自身今日份），面板不再读它。
* 子代理自己的模型调用仍计在**子会话**日志里，父会话另付「读回子代理回报」的输入 token——
  两边相加不重复（原本就是这样，只是父会话行过去只显示自有部分）。

## 实现

* 宿主 `today-spend.ts`：`TodaySpendDetail` 增加 `ownSpend`（每个会话的**全会话**自有花费，
  与当日口径同一趟折叠）与 `lineage`；新增纯函数 `delegatedSpendOf(id, ownSpend, lineage)` —— 只
  沿 `isSubagentSession` 的子节点 DFS（用户分叉不算委派），带环守卫（查询节点预置 visited，
  环不会把自身算进自己的小计）。
* 宿主 `types.ts` 新增 `DeepSeekDelegatedSpend { total, models, isSubagent }`；`balance.ts` 新增
  第七个 Remote `getDelegatedSpend(sessionId, force?)`；`index.ts` 的 loader **复用同一个
  `TodaySpendCache`**（那一趟扫描本来就算全会话累计，所以子代理读取零额外日志 I/O，与
  `getTodaySpend` 共享 60 秒缓存与 `force`）。
* 浏览器：新 `spends.ts` 提供 `sumSpends(own, delegated)`（纯加法：total 相加、模型行按 model id
  合并）；`useBillingData` 增加 `delegated` 状态与 `getDelegatedSpend` 拉取（挂载 / 手动刷新 /
  回合结束，与其它花费同一套 `fetchLine`，失败保留旧值），对外暴露的 `spend` = 实时自身 + 上次
  子代理小计（自身部分仍是逐事件实时），并暴露 `isSubagent`；`BalancePanel` 的括号改读行的
  `total`，且当**当前会话自己就是被委派的子代理**时不渲染括号（它的花费在委派方的行里，
  「未知」不能冒充 `（¥0）`）。
* 文案：`info.hint` 增加一行「金额含本会话委派的子代理会话。」/「The amounts include the subagent
  sessions this session delegated.」（zh 实测 114 字符、en 287，守卫 122/295；四行结构有用例锁定）。

## 后续微调（同日）：徽标两行改用面板文案

* 用户要求：「把徽标的『剩余额度』和『本轮对话花费』改成面板里面的『剩余金额』和『本会话花费』」，
  随后澄清：**「剩余金额」不含 `API` 三个字**（面板标题仍是 `API 剩余金额`）。
* 最终口径：徽标主行 = `trigger.balance`（`剩余金额：{amount}` / `Balance: {amount}`，面板标题
  去掉 `API` 前缀的短版）；徽标副行 = **面板的 `label.sessionSpend`**（`本会话花费：{amount}` /
  `This session: {amount}`，共用同一键，一字不差）。`trigger.conversationSpend` 键已删除；
  `badge.aria`（无障碍名）保持不变。
* 用例：徽标侧断言改 `剩余金额：`；面板侧断言一律经 `panel()`（`within(dialog)`）作用域，仍断
  `API 剩余金额：`；新增一条「触发器副行 = 面板文案」的字典一致性用例，以及旧文案的反断言。
* 文档：根 README 双语、ui-billing README 双语同步；ui-billing 与根 `README.i18n.yaml` hash 重算
  （llm-billing README 本轮未改，hash 保持）。
* `pnpm run test` **229 全绿**；只重建了 client 面并只重装 `@rayadesu/dsh-client-ui-billing`
  （宿主包未动）。

## 后续微调（同日 · 第二次）：今日 Token 下面加两行桶明细

* 用户要求：「在今日 Token 下面，新增未缓存输入 · 缓存读取 · 输出 同样的三个模块，一行是 token
  细则，一行是花费细则，模块样式同下方模型下面的样式」；第一版做成了**三个两行模块**，用户随后的
  更正：「按照这种排列，两行，而不是三个模块」并给出目标排布；再随后要求「tok 和计费换一行」，
  最终**token 行在上、花费行在下**。
* 最终做法（纯浏览器侧，宿主与 wire 零改动）：
  - `spendBuckets.ts` 新增 `tokenBucketsOf(spend)`（三个桶的 token 计数）；花费侧复用已有的
    `spendBucketsOf`（含把末位小数残差并进最大桶的规则，所以三笔花费相加正好等于「今日花费」）。
  - `BalancePanel.tsx` 的 `todayBucketLines()` 生成两行：第 1 行 = 三个桶的 token 数
    （`未缓存输入 2.3M tok · …`，桶名用 `label.bucket.*`、计数用 `unit.tokens`），第 2 行 = 三个桶的
    花费（`未缓存输入 ¥X · 缓存读取 ¥Y · 输出 ¥Z`，复用 `label.cost.*`）。两行都用下方模型分项那一行
    的 `costRow`/`costBreakdown` 类，插在「今日 Token / 今日花费」行与本会话花费之间；数据与
    「今日 Token」同一批 `todaySpend.models`，两处必然对得上。
  - 桶名改成中性键 `label.bucket.input/cacheRead/output`（原为只服务停用卡片的 `card.*`）；
    停用的 `SpendCard.tsx` 一并改用新键，`card.title`/`card.aria` 保留。
* 用例：badge spec 46 → 49——「两行明细的文字与顺序（花费行在上、token 行在下，DOM 相邻）」
  「与模型分项同一类名」「当天无可计价行时不渲染（按 token 行的 `tok · ` 特征判定）」。
* 本轮按**轻量档**执行：先跑受影响的 2 个 spec，收尾跑一次全套（**231 全绿**）；只 `build:client`、
  只重打并重装 `@rayadesu/dsh-client-ui-billing`；文档与 hash 在本轮末尾一次补齐。
* **同日再调**：两行顺序改为「token 行在上、花费行在下」（用户：「tok 和计费换一行」）；随后
  「今日花费金额 + 三个桶金额」改用**三位有效数字**（`formatSpendSignificant`，新增于 `format.ts`；
  其余金额仍走 `formatSpend` 的至多四位小数）。用例 231 → **233**（新增格式化规则直测 + 用用户
  实测数字的一整套渲染断言：`今日花费：¥9.58`、`未缓存输入 ¥0.507 · 缓存读取 ¥6.94 · 输出 ¥2.13`、
  token 行 `2.3M / 328M / 986K`）。
  注意：取整后三笔桶金额**显示上**可能不再恰好等于今日花费（真实值相加仍然相等，残差由
  `spendBucketsOf` 并进最大桶），README 已按「各自按三位有效数字渲染」措辞，不再声称显示值可加总。
* **同日再调（间距）**：用户要求「今日模块的这两行计数，间隔调低，调到第三部分今日会话花费排行的
  各个标题之间的间隔」——新增 CSS 类 `.dayBucketRow`（排版同 `.costRow` 内的 `.costBreakdown`，
  纵向 padding 2px）：两行之间 2 + 面板 gap 2 + 2 = **6px**，与相邻排行行 3 + 0 + 3 = 6px 一致；
  模型分项的 `.costRow`（2/8/6）保持不变。用例断言改为按类名判定（`css.dayBucketRow` /
  `css.costRow`，并确认内层仍是 `costBreakdown`），全套仍 **233 全绿**。
* 文档：根 README 双语（详情面板那一条）、ui-billing README 双语（面板段落）同步；
  ui-billing 与根 `README.i18n.yaml` hash 重算（llm-billing README 未改）。

## 后续微调（同日 · 第三次）：括号判定改为「会话是否今日创建」+ 明细行下间距

* 用户实测反馈：「本会话花费：¥10.5288（¥10.4929）……括号里面今日会话花费判定条件改为此会话是不是
  今日产生的，原来判定逻辑是金额相等与否，会临时造成金额不相等导致括号出现」。
  - 根因：主金额是**实时**投影（回合中途持续增长），括号金额取自**60 秒缓存**的排行行，两者本来就
    会差几分钱，「金额不相等」于是给今天新建的会话闪出括号。
  - 改法：宿主在既有的 `getDelegatedSpend` 响应里新增 `crossedDay`（被查询会话的创建日 ≠ 查询日；
    创建时间取不到时为 `false`——**未经证实的跨天不得凭空显示**）：`TodaySpendDetail` 增加 `dayKey`
    与 `createdAt`（live 取 `header.createdAt`，冷会话取列表 header 的 `createdAt`，都是那一趟扫描
    顺带收集的），loader 用 `beijingDayKey` 比较；浏览器把 `crossedDay` 透传到面板。
  - 面板：删掉 `SPEND_SAME_EPSILON` 与金额比较，改为 `spend !== null && !isSubagent && crossedDay`
    才显示括号（排行未落定时仍不显示；跨天会话当天没花钱则显示「（¥0）」）。
* 用户同时要求：「今日 token 离上线的距离和最后一行离下线的距离不相等，调整最后一行离下线距离」
  ——新增 `.dayBucketRow + .dayBucketRow { padding-bottom: 4px }`：最后一行到下方分隔线 = 4 + 面板
  gap 2 = **6px**，与「今日 Token」到它自己上方那条线的 6px（`.spendRow` 的 padding-top）一致；
  两行之间仍是 2 + 2 + 2 = 6px（与排行行同距）。
* **同日再调（对齐）**：用户要求「调整第二行的『未缓存输入』『缓存读取』『输出』，动态调节三项之间的
  宽度，让它这三个标题对齐上一行三项标题」——两个 `flex` 行改成**一个三列网格**：`.dayBuckets`
  = `grid-template-columns: minmax(0, max-content) auto minmax(0, max-content) auto minmax(0, max-content)`，
  DOM 依次是「token 行三格 + 每格后一个 ` · ` 分隔格」再「花费行三格 + 分隔格」（共 10 个子元素）；
  内容列取两行中较宽者，所以三个标题与中间的点在两行之间严格对齐、列宽随数值动态变化；
  `minmax(0, max-content)` 保留面板过窄时可换行的退路。原 `.dayBucketRow` 两条规则由
  `.dayBuckets` / `.dayBucketCell` / `.dayBucketDot` 取代（行距仍 6px、下间距仍 4px + 2px gap）。
  用例同步改写为按单元格断言（6 个单元格文本、网格 10 个子元素及其顺序、单元格类名、网格紧跟今日行
  且在会话行之前）。
* **同日再修（间距回归）**：用户随即指出「第一行按照原来的间隔调整，第二行才根据第一行动态调整」
  ——根因是分隔列用了 `auto`：CSS Grid 里 `auto` 作为最大值**可被拉伸**，面板的剩余宽度被两条窄
  分隔列吃掉，于是 **token 行自身的 ` · ` 间距被拉大**。改为 `max-content` 分隔列 + 
  `justify-content: start`（两者都加，任一条即足以阻止拉伸），现在 token 行严格保持原始间距、
  花费行才跟随 token 行定义的列对齐；`minmax(0, max-content)` 仍是内容列，保留过窄时换行的退路。
* **同日再调（收尾两件）**：
  - 大幅金额收口：用户要求「不足 ¥0.0001 的桶花费按面板其它金额的惯例显示成 ¥0」——
    `formatSpendSignificant` 在三位有效数字之后再用 `toFixed(4)` 收口（0.000123 → `¥0.0001`，
    0.00002 → `¥0`）。用例补三条（0.00002 / 0.0000099 → `¥0`；0.000123 → `¥0.0001`）。
  - 纵向间距还原：用户「还原这个间隔吧」——两行明细的间距回到最初那套（与下方模型分项同一节奏）：
    两行之间 = 6 + 2 + 2 = 10px，最后一行到下方分隔线 = 6 + 面板 gap 2 = 8px。
* **同日再调（第二部分节奏）**：用户「调整一下第二部分的上下间隔……使得他看起来均衡，并且跟其他
  两部分看起来融合的很自然」——按仓库里的面板特写图（`preview-detail.png`，496px 宽 ≈ 1.48×
  缩放）量出第二部分内部是 30px（表头→模型名）/ 24px（模型名→分项行），表头离自己的行比行与行
  之间还松。改法：`.spendRow + .modelRow { padding-top: 2px }`，把会话花费行当作模型块的**表头**
  收紧到 10px（= 模型名到分项行的间距），整面板节奏统一为「同块 10 / 换块 14 / 换区 8 + 分隔线」。
* **同日再调（用户撤回对齐）**：用户「还原这个间隔吧」+「这个间隔改为没有对齐的那一版」——
  两行明细**撤掉三列网格**，恢复成两条各自成行的 `.costRow`（token 行在上、花费行在下，各保持
  自然的 ` · ` 间距，互不对齐）。`.dayBuckets` / `.dayBucketCell` /
  `.dayBucketDot` 三条 CSS 与 `todayBucketCells()` 一并删除，恢复 `todayBucketLines()`（两行字符串）；
  用例回到两条整行文本的断言（含「紧跟今日行、在会话行之前」的顺序断言）。全套 **234 全绿**，
  只重打并重装客户端包，文档与 hash 同步。
* **同日定稿（行距归第三部分）**：用户「这两行的间隔不用回调」「这两行的间隔是回到第三部分，
  会话排行的间隔」——撤掉网格后两行明细的行距**不是**模型分项那套，而是**今日会话花费排行**那套：
  单独建 `.dayBucketRow { padding: 2px 8px }` + `.dayBucketRow + .dayBucketRow { padding-bottom: 4px }`，
  于是两行之间 = 2 + 面板 gap 2 + 2 = 6px（与相邻两条 `rankingRow` 的标题间距同为 3 + 3 = 6px 等值），
  末行到下一分隔线 = 4 + 2 = 6px（与 `今日 Token` 行到自身边框的 6px 一致）；`todayBucketLines()`
  两行字符串不变、仍不对齐。
* **同日再调（模型块内收紧）**：用户「『DeepSeek-V41-Flash / ¥13.8221』与『未缓存输入 … 输出 …』
  这两行靠近一点，这两行的距离应比『本会话花费 / DeepSeek-V41-Flash』那两行大标题近」——上一轮把
  会话花费行当表头收紧到 10px 之后，块内（模型名→它的分项行）也是 10px，两者等值，层次读不出来。
  改法：模型名与它的分项行作为一个**紧凑对**——`.modelRow { padding: 6px 8px 4px }` +
  `.costRow { padding: 0 8px 6px }`，块内 = 4 + 面板 gap 2 + 0 = **6px**（与今日两行明细同节奏），
  表头→首块仍是 2 + 6 + 2 = **10px**，换块仍是 costRow 下 6 + 2 + 模型行上 6 = **14px**。面板节奏
  由「同块 10」改为「**同对 6 / 表头→块 10 / 换块 14 / 换区 8 + 分隔线**」；`.modelRow` 的下内边距
  只影响块内（块间隔由 `.costRow` 的下内边距决定），所以三档层次反而更清楚。52 条徽标 spec 通过、
  全套 234 全绿，只重打并重装客户端包；README 未描述该处像素节奏，无需改动。
* **同日再调（全部花费金额统一三位有效数字）**：用户「把其他花费的金额也改成三位有效数字」——
  上一轮只有今日花费与它的三个桶走 `formatSpendSignificant`，本轮把**所有花费金额**都换过去：
  本会话行（含括号内的今日份）、每个模型行的金额与它那三个桶、排行金额，以及徽标副行
  （`BalanceBadge.tsx` 的 `formatSpend(spend.total)`）。**只有余额行**（面板 `API 剩余金额` 与徽标
  主行 `剩余金额`）保持 `formatSpend` 的至多四位小数——余额不是花费读数。`formatSpend` 的 JSDoc
  改成「余额行的渲染器」，`formatSpendSignificant` 的说明改成「插件渲染的每个花费金额（今日行与
  三个桶、本会话行与括号、模型行与分项、排行、徽标副行），四位小数封顶、低于 ¥0.0001 显示 ¥0」。
  用例：单位断言补 `13.8221 → ¥13.8`、`10.4422 → ¥10.4`；新增一条端到端用例（模型行 `¥13.8`、
  分项 `未缓存输入 ¥0.604 · 缓存读取 ¥10.4 · 输出 ¥2.78`、本会话行与徽标副行 `¥13.8`、排行 `¥13.9`、
  余额仍是 `¥110.00`）；「实时 10.5288 对缓存 10.4929」那条的断言随渲染改成 `¥10.5`。
  **未改动**：每条消息的回合花费（`TurnCostAction`，逐回合的小额、四位小数更能分辨）与未注册的
  输入框花费卡片（`SpendCard`）——等用户定夺。
* **同日再调（一级距离）**：用户「让会话排行之间的距离定义为一级距离；图上的两个模型分花费，互相之间的
  距离统一为一级距离，而不是两两间隔开」——把**排行行的 6px 定为一级距离**，模型列表里的每一个间隔都用它：
  `.modelRow { padding: 4px 8px }` + `.costRow { padding: 0 8px }`，于是「模型名 → 它自己的分项行」=
  4 + 面板 gap 2 + 0 = 6px，「上一块的分项行 → 下一块的模型名」= 0 + gap 2 + 4 = 6px（块与块不再按上一轮的
  14px 两两分家）；`.ranking { margin-top: 4px }` 把「最后一行 → 排行区上边框」补回 6px（模型行不再有下内边距，
  这段距离不能再挂在它身上）。表头 `本会话花费` → 首个模型名仍是 10px（`.spendRow + .modelRow { padding-top: 2px }`），
  是全列表里唯一不是一级距离的间隔，正好标记它是列表的主人。另外补一条兜底
  `.costRow:last-child { padding-bottom: 6px }`：排行区还没有内容可显示时，最后一行就是面板的最后一个子元素，
  由它取回 6px 下内边距，面板底部不会贴住文字。53 条徽标 spec 通过、全套 235 全绿，
  只重打并重装客户端包；README 未描述模型列表的像素节奏，无需改动。
* **同日修正（末行到分隔线按墨迹算）**：用户「第 2 行桶明细 → 分隔线你说也是 6，但看起来明显比两行桶之间的
  距离短」——**盒间距相同并不等于视觉相同**：两行桶明细之间 6px 盒 → **11px 墨迹**（2.5 半行距 + 2 + 2 + 2
  + 2.5 半行距），而末行到分隔线 6px 盒只有 **8.5px 墨迹**（2.5 + 4 + 2），因为**分隔线没有半行距**，
  文字行有。修法：把两处「末行 → 分隔线」的盒距从 6 提到 8 —— `.dayBucketRow + .dayBucketRow
  { padding-bottom: 6px }` 与 `.ranking { margin-top: 6px }`，墨迹变成 2.5 + 8 = **10.5px**，
  与一级距离的 11px 差半个像素，肉眼即等距。带半行距的完整视觉账已写进这两处注释，避免后续再按盒距误判。
  53 条徽标 spec 通过、全套 235 全绿，只重打并重装客户端包。
* **同日再调（分隔线下侧统一 12px 墨迹）**：用户「分隔线到各个元素的距离都改成『排行区分隔线 → 今日会话花费
  标题』的 12 左右」——以排行区标题那条为基准（1 边框 + 2 `.ranking` 上内边距 + 6 标题上内边距 + 3 半行距 =
  **12px 墨迹**），把两个 `.spendRow` 表头（`今日 Token`／`本会话花费`）的上内边距从 6 提到 8：
  1 + 8 + 2.5 = **11.5px 墨迹**（差半个像素）。下内边距保持 6px，所以「表头 → 它拥有的列表」的 15～15.5px
  表头距离不变，`.spendRow + .modelRow` 那条 10px 盒距也不用动。分隔线**上侧**不动，仍是上一轮定为一级距离的
  10.5～11.5px。53 条徽标 spec 通过、全套 235 全绿，只重打并重装客户端包。
* **同日定稿（二级距离）**：用户「像这种最后一行到分割线底的也同样得 12 左右，**这个距离定义为二级距离**」——
  给出正式词汇：**一级距离** = 行与行之间（盒 6px，墨迹 11～11.5px）；**二级距离** = 区块末行到收尾分隔线、
  以及分隔线到其下首行（两侧都约 12px 墨迹），因为分隔线没有半行距，二级要用更多盒距。修法：把两处仍为
  10.5px 的上侧也提到 11.5px —— `.dayBucketRow + .dayBucketRow { padding-bottom: 7px }`、
  `.ranking { margin-top: 7px }`（各 +1px 盒距）；`.amountRow` 那条本来就是 11.5px，不动。现在六处二级距离为
  11.5 / 11.5 / 11.5（三条分隔线上侧）与 11.5 / 11.5 / 12（下侧，含基准的排行区标题）。词汇与两档算法写进
  `.panel` 的注释（一级/二级各自的组成与例外：表头 → 列表 10px 盒 / 15～15.5px 墨迹）。53 条徽标 spec 通过、
  全套 235 全绿，只重打并重装客户端包。
* 用例：234 全绿（徽标 spec 新增两条——「今天创建的会话不显示括号（含实时 10.5288 对缓存 10.4929
  的回归用例）」；宿主 balance spec 断言 `crossedDay` 三态：老会话 true、无创建时间 false、
  子代理自身 false）。
* 文档：根 README 双语、ui-billing README 双语、llm-billing README 双语（`crossedDay` 口径）同步；
  三处 `README.i18n.yaml` hash 重算（llm-billing 也改了）。宿主与客户端都重打并重装。

## 验证

* `pnpm run test`：**234 用例全绿**（today-spend 48 → 51：subtree 纯函数两例 + 同趟读取一例；
  balance 28 → 29：`getDelegatedSpend` 网关一例；ui-billing 新增 `spends.spec.ts` 3 例、
  badge 45 → 46、browser-plugin 12 → 13）。
* `pnpm run build` / `pnpm run lint` / `pnpm run verify` 全绿；三包重新 pack 装入 web profile
  （版本仍 0.3.12，阶段 A 不 bump）。
* 待用户重启 `dsh web` 并硬刷新验证：会话行金额 = 本会话 + 其子代理；模型分项之和等于该金额；
  跨天才出现括号；「?」提示多一行说明。

---

# HANDOFF — 今日会话排行把子代理会话并入父会话（2026-09-12 已实施，阶段 A 未提交）

## 需求（用户原话）

> 「在『今日会话花费』，显示会话排行那里，把子代理会话并入父会话」

## 根因与口径

* 排行原本一行一个**会话**：DSH 为每个 subagent 子会话单独建日志（header 带 `origin: 'subagent'`、
  `parentSession`、`delegationDepth`），宿主按会话各自计价，于是**一次委派在排行里占掉好几行**，
  把用户真正打开的对话挤出前十（面板只显示前 10）。
* 采用口径：**行 = 对话**。子代理是委派它的那次对话花的钱，因此每个子代理行并入其
  `parentSession` 链顶端的顶层会话行；**用户手动分叉**的会话同样带 `parentSession`、但不带任何
  subagent 标记，仍是自己一行。整日合计不变——两条扫描路径求和的是同一批会话，归组不搬钱。

## 改动

* 宿主 `today-spend.ts`：新增 `SessionLineage` / `isSubagentSession` / `topLevelSessionOf` /
  `rollUpSubagentSpend`；`ScannerSession` 与 `ScannerPersistedHeader` 的 header 切面合并为
  `SessionHeaderSlice`（在分叉边界之外补上 `parentSession` / `origin` / `delegationDepth`，全部
  结构读取；旧日志没有这些字段就按顶层会话处理）。两条扫描路径都在同一趟里顺带收集 lineage 与
  标题（投影路径：live header + 已折出的标题；事件路径：`collectTodayEvents` 回调多带一个 lineage
  参数），扫描结束统一 `rollUpSubagentSpend`：
  - 顶层行 `total` = 这次对话的整日花费（含全部后代），`ownTotal` = 该会话自身花费；
  - 自己当天没计价、但子代理计价了的顶层会话照样出行（`ownTotal` 为 0，标题取自扫描时折出的日志）；
  - 父会话不在扫描范围内时仍按 header 里写的父会话 id 归属（标题显示「未命名」兜底）；
  - malformed 的父子环有 `seen` 守卫，不会空转。
* `types.ts`：`DeepSeekTodaySessionSpend` 新增必填 `ownTotal`；`total` 与 `DeepSeekTodaySessionsSpend`
  的文档改写为「对话」口径。`balance.ts` / `index.ts` 的 Remote 导出与说明同步。
* 浏览器 `BalancePanel.tsx`：括号里的「本会话今日份」改读该行的 **`ownTotal`**（不是 `total`），
  以保住「括号 = 旁边那个金额里落在今天的部分」这条不变式——否则同一天里子代理的花费会让括号
  无故出现并与「本会话花费」不等。排行显示仍是 `total`。
* 用例：宿主 42 → 47（合并、嵌套合并 + 未知父会话、用户分叉不合并、投影路径冷子会话并入 live
  父会话、lineage 纯函数与环守卫），`scanSessions` 既有断言补 `ownTotal`；ui-billing 44 → 45
  （合并行不冒充本会话今日份，同时排行仍显示合并后的 `total`），排行/括号 fixture 补 `ownTotal`。
* 文档：根 README 双语（详情面板排行、计价规则、按需聚合/按需拉取/上限/新增「合并行可能未命名」）、
  llm-billing README 双语（新增「子代理会话并入父会话行」小节 + Remote 方法说明 + 运行时兼容 +
  限制条目）、ui-billing README 双语（排行=对话、括号读 `ownTotal`、上限在合并之后生效），
  三处 `README.i18n.yaml` hash 重算。

## 验证

* `pnpm run test`：**219 用例全绿**；`pnpm run build` / `pnpm run lint` / `pnpm run verify` 全绿。
* `npm pack` 三包 → remove + add 装入 web profile（沿用 0.3.12，阶段 A 不 bump 版本）。
* 用构建产物复跑事件路径缺陷的复现脚本：三趟 `scanDetail()` 的合计与行完全一致
  （`13.6` / 1 行，子代理会话已并入父行且标题保留），`inspect` 次数停在 2（两个冷会话各读一次）。
* 待用户在重启 `dsh web` 并硬刷新后验证：排行里不再出现子代理会话单独占行，子代理花费计入
  委派它的那个会话行；整日「今日花费」与合并前一致；括号金额仍只在会话跨天时出现。

## 顺带修复：事件路径第二轮扫描丢数据（用户知情后要求一并修）

* **问题**：`collectTodayEvents` 按 revision 跳过未变的冷会话，但事件路径只有一张
  `lastEventsScan` **水位表**（id → revision），没有像投影路径的 `coldResolved` 那样留下结果，
  于是被跳过的会话当轮既不入合计、也不入排行。实测（修复前）：同一份未变日志 `scanDetail()`
  两次 → 第一轮 `total 13.6` / 1 行，第二轮 `total 0` / 0 行；这套部署走投影路径不受影响，
  但「注册表行尚未 active / 被 live reload 重建」的窗口里降级到事件路径就会算错，且错值被
  60 秒缓存记住。
* **根因**：省 I/O 的那一半（revision 门控）做到了，正确性的那一半（采用已有解析结果）没做——
  revision 门控本应是**缓存**，不是**过滤器**。
* **改法**（顺手把两条路径的分叉面收窄）：
  - `coldResolved` 升级为两条路径**共用**的记忆：`Map<SessionId, ColdResolution>`，
    `ColdResolution = { revision, fold, title }`（新导出类型）；新增私有 `rememberCold()`
    统一 `evictOldest` 上限与写入，投影路径与事件路径都改用它。
  - 事件路径：revision 未变时 `onSession(header.id, resolved.fold, resolved.title, header)`
    采用记忆值（零 I/O，血缘仍取自 header）；读过的日志在 `!truncated` 时写回记忆；
    `lastEventsScan` 水位表删除（记忆表本身就是门控）。
  - 为让记忆可复用，`collectTodayEvents` 的回调签名由 `(id, fold, events, lineage)` 改为
    `(id, fold, title, lineage)`：标题在折叠处算一次，被采用的会话沿用上次折出的标题。
  - 被 event cap 截断的那一趟不写记忆（避免把半价折叠钉死），下一趟重读——与原水位表语义一致。
* **用例**：`today-spend.spec.ts` 47 → 48——把「未变则跳过」改为「未变则采用记忆值」并断言
  第二趟合计与行（含标题）与第一趟逐字段相等；新增「revision 变化则重算」（13.60 → 27.20）；
  截断用例改名并保留「部分折叠不留记忆、下一趟重读」的断言。
* **文档**：llm-billing README 双语改写「今日花费读取路径」两条 bullet + 新增一段
  「两条路径都把 revision 门控当缓存」；`README.i18n.yaml` hash 重算。

---

# HANDOFF — 面板加「今日 Token」、本会话花费下移一行、括号金额改为跨天才显示（2026-09-12 已实施，随 v0.3.12 发布）

## 需求（用户原话）

1. 「将本会话花费改到下一行，第一行的原位置改成今日Token，后面的今日花费文案从『今日』改成『今日花费』」
2. 「本会话花费的括号里面的今日本会话花费，只在会话花费和今日本会话花费对不上的时候才显示，
   也就是说只有会话跨天了才显示，今日新会话则不显示」
3. 「修改一下 token 数量的表示方式，按照 dsh 官方的规则来。数字加单位（K/M 等）加 tok，
   小数点和省略规则按照 dsh 处理 tok 数的规则来」
4. 「在卡片悬停问号的介绍里，说明括号里面的是今日的本轮会话花费」
5. （追问）「只有 k 和 m 两个单位吗，十亿的 token 在 dsh 里面是怎么处理的呢」——已核对：DSH 只有
   `number.thousand`/`number.million` 两个共享单位（zh/en 字典各一处，全仓库无 G/B/trillion 键），
   同一 K/M 规则在 ui-chat `token-format.ts`、ui-conversation `ContextMeter.tsx`、
   ui-subagent `SubagentHeaderLineage.tsx` 各实现一次且写法一致；十亿 token 走 M 分支、
   `scaled(1000)` 取整 → `1000M tok`（1 234 567 890 → `1235M tok`），已是本插件的行为。
6. 「把卡片里面的三个计费桶名称换成 dsh 官方的，未缓存输入，缓存读取，输出」
7. 「我要更新 readme 的话需要截图插件，你能截图之后把我内容打码，只剩插件的样子吗」——已重拍
   `preview-detail.png`（542×508）与 `preview-overview.png`（720×620），除插件本身外全部马赛克，
   根 README 双语的图片宽度/说明文字同步（见下方「预览图重拍」）。

## 改动（宿主零改动）

* 布局：面板第一行变成「今日 Token」+「今日花费」（左/右），**本会话花费独占下一行**（仍是 `.spendRow`，
  只是各自一个 div）。样式表顶部注释与新注释同步改名。
* 今日 Token：直接把已拉取的 `billing/getTodaySpend` 的模型行**原地求和**（缓存命中输入 + 未命中输入
  + 输出三个计费桶），**不加 Remote、不改宿主**；三态与同一行的「今日花费」一致：未落定 `—`、
  当天无计价行 `暂无消耗记录`（` tok` 单位只跟真数字走，`—` 后面不挂单位）。
* Token 表示法**逐条复刻 DSH**：`formatTokens` 对齐 ui-chat 的 `chat/token-format.ts`——
  <1e3 输出原整数（不做千分位分组），<1e6 用共享 `number.thousand` 单位（`{value}K`），再往上用
  `number.million`（`{value}M`）；缩放值 <100 保留一位小数、≥100 取整（`12.2K` 而 `517K`），
  没有第三个单位，所以 1.2e9 渲染成 `1200M`（与 DSH 一致）。单位后缀沿用 DSH 自己的写法
  （`{count} tok`，中英字典相同），作为独立 locale 键 `unit.tokens` 只包在数值外面。
  ui-chat 的 `formatTokens` 不在其公开导出面（`./client` 不导出 `token-format.ts`），所以这里是
  按规则复刻并在 JSDoc 里注明出处，而不是 import 私有模块。
* 括号金额：由「总是显示」改为**仅在两个金额对不上时显示**——`spend.total` 与排行里该会话的今日份
  之差超过 `SPEND_SAME_EPSILON`（1e-9；两者是同一批样本的和，同天会话逐位相同，这点余量只吸收浮点
  求和顺序噪声）。排行未落定则不渲染括号（「未知」不算对不上），没跨天的会话今日份恰好等于会话总额，
  括号只会重复旁边的数字。面板 JSDoc/README 的取值口径同步改写。
* 「?」悬停说明加一行**解释括号**：`info.hint` 变成三行——估算口径 / `括号内为本会话今日花费。` /
  版本号（版本仍是最后一行、与上一行之间不留空行；DSH 气泡 `white-space: pre-line`，`\n` 即换行）。
  长度守卫随之上调（zh ≤ 100 → 105，实测 98；en ≤ 200 → 225，实测 221，约 5 行），两个字典的行结构
  各有用例锁定。
* 分项桶名换成 **DSH 官方文案与行序**：`label.cost.hit` → `label.cost.cacheRead`（缓存命中 → **缓存读取**
  / Cache hit → Cached input），`label.cost.input` 值改 **未缓存输入** / Uncached input（键名不变，
  与 DSH 的 `message.turnUsage.input` 同名），`label.cost.output` 不变；渲染顺序改为
  **未缓存输入 · 缓存读取 · 输出**（DSH token 对话框的行序）。出处写进 locales 注释
  （ui-chat `locale.ts` 的 `message.turnUsage.{input,cacheRead,output}`）。**口径提示**：DSH 的 token
  对话框把 cache-miss 侧拆成 `未缓存输入` 与 `缓存写入` 两行，而宿主把缓存写入按未命中单价计价、
  合并进 `cacheMissInputCost`，所以本插件的「未缓存输入」含缓存写入——README 双语与限制条目都写明了
  这一点，行尾未新增第四行（成本上同价，拆行需要宿主侧新增桶）。

## 预览图重拍（最终采用用户自己的未打码截图）

* 我先按用户要求拍了一版**打码图**（`dsh-ui` 驱动 Edge 里的 DSH 页面：`under` 确认命中
  `Button "DeepSeek 额度：…"` → 点击展开面板 → `shot -R` 抓图；临时放大 125% 提升清晰度、拍完
  `ctrl+0` 还原；打码用纯 System.Drawing 脚本——整幅马赛克后贴回插件矩形，排行里的会话名按像素扫描
  逐行定位再糊）。脚本留在 `scripts/compose-previews.ps1` 备用（含它假设的截图原点与缩放）。
* **用户随后改主意：不打码**，直接提供两张自己的截图——详情 496×472、总览 1920×1020（未打码，
  含真实余额/金额/会话名）。已按此替换仓库内的 `preview-detail.png` / `preview-overview.png`，
  根 README 双语的图片宽度改为 **1200（总览）/ 496（详情）**，说明文字去掉「已打码」字样，
  `README.i18n.yaml` hash 重算。
* `preview-turn-cost.png` 未重拍（本轮没动行尾金额渲染），沿用旧图。
* 数字取自拍摄时刻的实时数据；后续会话继续烧钱时不必追着更新。

## 验证

* `pnpm run test`：**211 用例全绿**（其中 badge spec 39 → 44：新增「本会话花费独占一行（与今日行不同父节点）」、
  「DSH 紧凑记数规则表（517 / 12.2K / 517K / 999 → 1000K / 1.2M / 1e9 → 1000M / 1234567890 → 1235M）」、
  「面板里的 ` tok` 后缀」、「跨天显示括号」、「问号说明的第二行解释括号且版本仍在最后一行」五组，
  并把「排行未落定先 `（—）`」改为「未落定不渲染括号」、把分项断言改成 DSH 桶名
  （`未缓存输入 ¥0.02 · 缓存读取 ¥0.01 · 输出 ¥0.01`））。
  全套还包含另一个会话新增的 `spend-card.client.spec.tsx`（11 例）。
* `pnpm run build` 全绿；`npm pack` ui-billing → remove + add 装入 web profile（沿用 0.3.11 版本号，
  阶段 A 不做版本 bump）；核对安装产物含 `今日 Token：`/`今日花费：`/`本会话花费：`/` tok`，无旧 `今日：`。

## 并发写入提醒（重要）

* 本轮实施期间**另一个会话正在同一工作区开发输入框花费卡片**（`SpendCard.tsx`/`spendBuckets.ts`/
  `icons.tsx`/`useCardDialog.ts` 及其用例与文档，注册块在 `src/client/index.ts` 里注释停放）。
  文档改动因此多次撞车（`README.md`/`README.zh.md`/`packages/ui-billing/README*` 都在被对方写入），
  本轮的文档同步是在对方写入间隙完成的：**合并后的 README 与 `README.i18n.yaml` hash 以当前工作区内容为准**
  （root `6a9342b7…`/`6505e486…`，ui-billing `592ad0ee…`/`38f9f171…`）。
* 代码侧互不重叠：本轮只动 `BalancePanel.tsx`/`format.ts`/`locales.ts`/`BalanceBadge.module.css`/badge 用例，
  对方的卡片注册处于注释状态、不影响 bundle 行为。

---

# HANDOFF — 输入框下方「花费金额」卡片（2026-09-12 已实现，**注册已暂停**，阶段 A 未提交）

## 需求（用户原话）

* 附图是输入框底下那条官方 Token 用量 pill + 卡片，要求「照这个样式制作一个卡片」：
  标题「💰花费金额」，钱袋图标**用之前绘制的图标**（git 里有记录），底下子标题文案与
  token 统计一致：**未缓存输入 / 缓存读取 / 输出**。
* 用户审核通过的四项决策：挂在 `conversation.composer.dock` 新增一条独立行、口径取
  本会话累计、点 pill 向上弹出卡片、复用 git 历史的自制钱袋 SVG。

## 问题与根因（为什么之前没有）

* 钱袋图标随 v0.3.5（`e393833`）一起被删：那一版把「本轮花费」改成行尾纯静态 `¥X`，
  「删除图标/标签/卡片皮肤」是当时的明确需求，图标只存在于 `2d6c67e` 的
  `TurnCostAction.tsx` 里（自制 `WalletIcon`，16 视框、stroke currentColor）。
* 成本明细此前只在头部详情面板里、且是**按模型分行**；输入框下方没有任何入口。

## 改动（宿主零改动）

* **关键发现：投影里已经有三桶成本**。`billingTodaySpend` 的 `state.session.models[]`
  每行本就带 `cacheHitInputCost` / `cacheMissInputCost`（含缓存写入）/ `outputCost`，
  正是 token 卡那三行的成本口径。所以卡片的金额直接由客户端把 `session.models[]` 三个桶
  相加得到——**不加 Remote、不改 fold、不 bump 投影 `stateVersion`**，且随投影推送实时更新。
* 新增 `src/client/spendBuckets.ts`：纯函数求和 + 浮点残差吸收（残差并入最大桶，保证三行
  显示的 `¥` 值之和恒等于标题里的总额）。
* 新增 `src/client/icons.tsx`：把 `2d6c67e` 的 `WalletIcon` 原样搬回，做成共享图标。
* 新增 `src/client/SpendCard.tsx` + `.module.css`：pill 触发器（复刻官方 StatsPills 的
  14px 图标/三级色调/hover 药丸）+ 门户卡片（复刻官方 `stat-dialog.module.css` 的皮肤：
  `--dsw-specific-menu`、r12、`--dsw-elevation-prominent`、标题行 + 0.5px 分隔线、
  `minmax(76px,auto)/minmax(0,1fr)` 右对齐等宽数字网格）；根部带 `data-composer-stats`
  让输入框底部留白维持官方 B8 节奏。
* 新增 `src/client/useCardDialog.ts`：官方 dialog 席位在 ui-chat 的私有 bundle 里无法导入，
  用两个公开原语（`useAnchoredPosition` + `useDismissOnOutsidePointer`）复刻同款行为：
  向上弹出、8px 间距、12px 视口夹取、点外/Esc 关闭。
* `locales.ts` 新增 6 键（zh/en）：`card.title` 花费金额、`card.input` 未缓存输入、
  `card.cacheRead` 缓存读取、`card.output` 输出、`card.aria`、以及卡片标题右侧的总额。
  行文案刻意与 DSH token 卡逐字一致，两张卡读起来是一家。
* 依赖：`packages/ui-billing` devDependencies 增 `@types/react-dom@~18.3.0`
  （门户需要 `createPortal` 的类型，此前包内没有；`pnpm install` 已刷新 lockfile）。

## 注册暂停（用户决定，同日）

* 用户追问「这个 pill 没法和官方两个 pill 并排吗」。核实后的结论：**在宿主当前契约下不行**——
  `conversation.composer.dock` 是 `kind: 'list'`，列表条目**没有 DOM 包裹**且各自独占一行，
  而官方两枚 pill 是 ui-chat **一次注册的内部结构**（根 div `width:100%`、内部才居中），
  第三方注册进不去那条 flex 行；输入框 `.root` 又是 `flex-direction: column`，所以再注册一个
  条目只能渲染成**官方行下方的第二条居中行**（已实现形态即如此）。
* 纯本地的替代方案只有「绝对定位叠到官方行右侧」：靠实测官方行宽定像素偏移，窄窗口/长文案
  会挤，属于脆弱近似——**用户否决**，选择先不动、等官方给真正的席位。
* **用户决定：输入框那条 pill 先不要出现**（「以后官方加上了插槽再改」），且卡片**不另找地方
  落地**（不进详情面板）。据此本轮只做一件事：**关掉注册**，代码与用例全部保留。
* 落地方式：`src/client/index.ts` 里 `conversation.composer.dock` 那段 `ctx.slots.inject(...)`
  整块注释掉（注释里写清为何暂停、恢复需要哪两处改动），`SpendCard` 的 import 一并撤掉
  （不给死代码留 import，`noUnusedLocals` 也不允许），`browser-plugin.client.spec.ts` 里
  与 dock 相关的两处断言与 bench 的子插槽声明同步撤掉并留下恢复说明。
* 重新启用要等的能力：宿主在统计行内开放**子插槽**（如 `conversation.composer.stats`），
  或在 dock 的 list 规格上支持**同行分组**；届时放开注释 + 补回 import 即可，其余代码零改动。
* 目标形态（届时按此对齐）：pill 贴在**官方行右侧、留 12px**（用户选定）。

## 验证

* `pnpm run typecheck` / `pnpm run test`（**206 用例全绿**：卡片自身 11 条仍在，撤掉的是
  dock 注册相关的 2 条）/ `pnpm run build` / `pnpm run verify` 四绿。
* 卡片用例覆盖：三桶求和、缓存写入计入未缓存输入行、浮点残差吸收、投影路径零 Remote 调用、
  投影缺失时回退 Remote、未计价会话不渲染、卡片三行文案与顺序、Esc 关闭、命中 aria。
* **产物核对**：重建后 `lib/client.js` 由 190.85 kB 降到 176.87 kB，`billing-spend`、
  `data-spend-card`、`composer.dock` 三个串均已从 bundle 消失（死代码被 tree-shake），
  而 `billing-balance` / `billing-turn-cost` 仍在——即线上行为回到只有徽标 + 行尾金额。
* 已重新 pack 并重装进 web profile（`file:` 引用，仍 0.3.11），安装后的 `lib/client.js`
  同样查无 `billing-spend`。

## 用户待办

* 重启 `dsh web` 并硬刷新，核对：输入框下方**没有**多出任何 pill 或行，头部徽标与详情面板、
  消息行尾的本轮花费一切如旧。
* 等官方为输入框统计行给出子插槽（或 dock 同行分组）后再复活这张卡片。
* 本轮为**阶段 A**：改动全部留在工作区未提交，确认无误后说「发布」再进入阶段 B。

---

# HANDOFF — 发布记录（2026-09-12 · v0.3.11）

* 提交：`d5f9770`（feat：面板「今日」与括号内的本会话今日份金额）+ `acb9e2b`（docs：双语文档同步）
  + `0d27dc1`（release: v0.3.11），已推送 origin/main；本条发布记录为随后的 `docs:` 提交
* tag：`v0.3.11` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.11
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-client-ui-billing` /
  `@rayadesu/dsh-billing` 均为 **0.3.11**（发布顺序 llm-billing → client-ui-billing → dsh-billing；
  `dsh-client-ui-billing` 首次查询仍是 0.3.10 —— npm 的 "being processed" 暂存，约 3 分钟后落库，已复核）
* 覆盖范围：**v0.3.10 tag 之后累积的全部未发布改动**，除本轮面板改动外还含上一轮阶段 A 留在工作区的两笔
  —— `343b73a`（fix：气泡超限，改短文案 + 下方弹出）与 `6e061b3`（feat：气泡末行显示插件版本号），
  两者此前只在本机 tarball 里验证过，本次随 0.3.11 正式发布
* 版本对齐：三包 0.3.10 → **0.3.11**（根 bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.11`），
  `pnpm-lock.yaml` 随 `pnpm install` 刷新（3 个 specifier 行）；`AGENTS.md` 版本行与两份 README 的
  版本示例（`v0.3.11`）同步，`README.i18n.yaml` hash 重算
* 发布前校验：`pnpm run test`（**195 用例全绿**）/ `build` / `verify` 全绿；`prepublishOnly`
  （verify-packages.mjs）随发布自动运行并通过（`client bundle stamps version 0.3.11`）
* 踩坑记录：bump 时先改了根 peer 范围却漏改 `packages/ui-billing/package.json` 的 version，
  `pnpm install` 报 `ERR_PNPM_NO_MATCHING_VERSION … @rayadesu/dsh-client-ui-billing@^0.3.11`
  （workspace 链接要求本地版本先满足范围）——补上后 7 秒装完。**下次 bump 记得三个包一起改**
* token 由用户提供，**仅内联传参，未写入仓库任何文件**（用户自己的 `~/.npmrc` 早已存有该 token，不属本次改动）
* 本机 web profile 仍是 local-tarballs 的 `file:` 引用；如需换 npm 版本：
  `dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`

---

# HANDOFF — 面板花费文案精简 +「本会话花费」今日份金额（2026-09-10 已实施，随 v0.3.11 发布）

## 需求（用户原话，含两处补正）

* 「今日共花费」改为「今日」。
* 在会话金额后面加一个**今日的本会话花费**，金额用括号括起来。
* **补正 1**：括号里**不显示**「今日」文案，只显示数字金额。
* **补正 2**：会话标签在「本会话花费 → 此会话 → 本会话」之间来回后，**最终定回「本会话花费」**（即原标签不变；
  阶段 A 未提交，故中间形态一律不留痕，最终形态才落进代码）。
* 语义经用户二选一确认：括号内是**本会话自己今天的花费**，右侧独立的「今日」项保留（仍是所有会话今日合计）。

## 问题与根因

* 面板那一行原先只有两个数：本会话**整个会话**的总花费（可跨天）与今日**所有会话**的合计。
  「本会话今天花了多少」这个中间量无处可看——用户今天新花的钱被混进会话总额里，两个数字都不回答它。

## 改动

* `packages/ui-billing/src/client/locales.ts`：
  - `label.sessionSpend`：文案**保持** `本会话花费：{amount}`（en 同样不变：`This session: {amount}`）。
  - `label.todaySpend`：`今日共花费：{amount}` → `今日：{amount}`（en：`Today total: {amount}` → `Today: {amount}`）。
  - 新增 `label.sessionSpend.today`：zh `（{amount}）` / en ` ({amount})` —— **只有金额**，无「今日」字样。
* `packages/ui-billing/src/client/BalancePanel.tsx`：
  - 新增 `sessionId` prop，在已拉取的今日会话排行里按 id 取本会话的今日份金额：
    `sessionsSpend === null ? undefined : find(...)?.total ?? 0`。**不新增任何 Remote 调用**——
    排行本来就在面板打开时拉取（徽标关着就不付费）。
  - 该金额作为嵌套 `span` 渲染在「本会话花费」金额之后：外层 span 直接文本仍是 `本会话花费：¥X`，
    因此既有的 `getByText('本会话花费：¥X')` 断言依然成立（testing-library 只比直接文本子节点）。
  - 三态：排行未落定 → `（—）`（与「今日」行的占位符同一套口径）；落定但没有本会话的行 →
    `（¥0）`（排行只列出今天真的计价过的会话，缺席即今天确实为 0）；否则 → `（¥Y）`。
* `packages/ui-billing/src/client/BalanceBadge.tsx`：把 `sessionId` 透传给面板（组合根不变，仍无新增数据流）。
* `packages/ui-billing/src/client/BalanceBadge.module.css`：新增 `.spendToday`（12px、tertiary），
  比所在行的 13px 主色低一档；括号自带间距，故不加 margin；顶部注释同步说明新的「今日」行名。
* `tests/balance-badge.client.spec.tsx`：该 spec 37 → 39 用例（全套 193 → 195）——① 括号金额按**当前会话 id**匹配
  （排行里另一会话 ¥0.29、当前会话 ¥0.02，断言只出 ¥0.02，且不泄漏当日合计 ¥0.31）；
  ② 排行未落定先 `（—）`、落定无本行后 `（¥0）`；另把「今日共花费」的全部旧断言改为「今日：」。
* 文档：根 `README{,.zh}.md`、`packages/ui-billing/README{,.zh}.md`（面板行描述 + 更新机制一节：括号金额复用排行那次读取，
  代价是与排行同进同退、最多滞后 60 秒）、`packages/llm-billing/README{,.zh}.md`（60 秒滞后一条补注）、
  `AGENTS.md`（仓库一句话描述里的指标名），三份 `README.i18n.yaml` blob hash 重算。

## 验证

* `pnpm run test`：**195 用例全绿**（193 → 195，新增 2 条在 ui-billing 面）。
* `pnpm run build`：host + client 两个编译面全绿；`pnpm run verify` 通过。
* 本地 `npm pack` 三包 → `%DSH_HOME%\local-tarballs\`，remove + add 装入 web profile；
  核对 profile 内 `node_modules/@rayadesu/dsh-client-ui-billing/lib/client.js` 已含新文案、无旧文案。
  （阶段 A 期间沿用 0.3.10 打包验证；发布时随 0.3.11 重新 pack 并复核，见上方发布记录。）

## 用户待办

1. **重启 `dsh web` 并硬刷新**（插件在进程启动时加载）。
2. 打开面板该行应显示：`本会话花费：¥X（¥Y）` 与 `今日：¥Z`——括号里只有金额，X 是整个会话的总额、
   Y 是本会话今天的部分、Z 是今天所有会话的合计；刚打开面板、排行还没回来时括号先显示 `（—）`。
3. 根 README 里的截图 `preview-detail.png` 仍是旧界面（图内文案为「本会话花费 / 今日共花费」），
   需要的话重启后重拍替换。

---

# HANDOFF — 花费说明气泡超限修复（精简悬停文案 + 底部弹出 · 2026-09-10 已实施，未发布）

## 流程变更（2026-09-10，第三次修订 · 立即生效）

* **阶段 A 不再本地提交**：改代码 → test/build → 本地 pack 安装 → 交给用户重启验证，**改动留在工作区**，
  不 `git add` / `commit` / `stash` / `reset`。
* **阶段 B（用户说「发布」）才提交**：bump 版本 → test/build/verify → **把工作区改动按类型分别提交**
  （`feat` / `fix` / `perf` / `refactor` / `style` / `docs` / `chore`；用例跟代码走；同一文件多意图用
  `git add -p` 分块）→ 最后一条 `release: vX.Y.Z` → 推送 → npm 顺序发布 → tag + GitHub Release
  → HANDOFF 发布记录。
* 理由：用户在阶段 A 常反复试错（本轮气泡布局就来回改了四轮），逐次提交会把中间形态留在历史里；
  阶段 A 不提交、阶段 B 一次性按类型归拢，历史只留最终形态。
* 细则见 `.agents/skills/dsh-release/SKILL.md`；本文件下方历史记录里「阶段 A = 改代码后直接本地提交」
  的说法自本条起作废（历史条目本身不改写）。

## 问题与根因

* 用户反馈：详情面板「?」的花费说明**超出气泡容量**（截图里上半截被裁掉），且**鼠标一离开「?」按钮就消失**
  （即使指针还在说明文字上）。
* 根因（全在 DSH `@deepseek-ai/dsh-client-ui-primitives` 的 `Tooltip`；本仓库不改 DSH 源码）：
  1. 气泡 `.bubble` 只有 `max-width`（50vw 或 `maxWidth`），**没有任何限高**；`side='right'` 时纵向按锚点
     居中（`translateY(-50%)`），而视口适配函数对 `side === 'right'` **提前 return**、不做纵向修正
     —— 锚点靠上时高气泡的上半截被裁到视口外。
  2. 气泡是 `pointer-events: none`，显示/隐藏挂在**锚点**的 `mouseenter/mouseleave` 上 —— 指针离开按钮
     （包括移向气泡本身）立即 `setPos(null)`。
  上一轮把费率历史写进 `info.hint`（~230 字）后正好触发了这两点。
* **用户决策（本轮已确认）**：只大幅精简悬停文案、保留 DSH 自带 Tooltip；不改点击展开、也不自绘悬停卡片。

## 改动

* `locales.ts`：`info.hint` 由 ~230 字压到 **~55 字（zh）/ ~150 字符（en）**——只留三件事：只估算
  DeepSeek 与 MiMo 模型、按每条消息自身时刻的峰谷官方单价、高峰窗口（工作日 9:00–12:00、14:00–18:00）；
  费率明细（8/17 基准表、9/10 flash 调价、9/14 V4 Pro 切价）本就在两个 README 里，不再塞进气泡。
  中英两处都补了「Tooltip 无限高、不能悬停，故必须保持短」的维护注释。
* `BalancePanel.tsx`：`Tooltip` 改 `side="bottom"`、`maxWidth` 340 → 300 —— 只有 bottom/top 侧才做纵向适配
  （放不下会翻到另一侧），`right` 侧不会，这正是上一版被裁的原因。
* `tests/balance-badge.client.spec.tsx`：+2 用例（35 → 37）——① 悬停「?」后气泡 `data-side="bottom"` 且
  文本等于 `zh['info.hint']`（真实 primitives 的 Tooltip 在 jsdom 里渲染，不是桩）；② 文案长度守卫
  （zh ≤ 80 字、en ≤ 200 字符），防止再次写出超限文案。
* `packages/ui-billing/README{,.zh}.md`：说明「?」现在是一句短说明及其原因；
  `packages/ui-billing/README.i18n.yaml` blob hash 重算。

## 验证

* `pnpm run test`：全套 **193 用例全绿**（191 → 193，新增的 2 条在 ui-billing 面）。
* typecheck / build / lint / verify 全绿。
* 本地 `npm pack` 三包 0.3.10 → `%DSH_HOME%\local-tarballs\`，remove + add 装入 web profile。

## 用户待办

1. **重启 `dsh web` 并硬刷新**。
2. 悬停「?」：气泡应出现在按钮**下方**、完整两三行、不再被裁切，末行是纯版本号（如 `v0.3.10`）；
   鼠标移开即消失——DSH 气泡本身 `pointer-events: none` 且不能悬停，这是本轮选择的取舍（要完整费率口径请看
   llm-billing README）。

## 补记：气泡里显示插件版本（同日，已实施）

* 需求：用户要求在气泡里显示版本号（便于反馈时指明所用构建）。
* 做法——**构建期注入**，浏览器包不读 manifest：
  - `packages/tsdown.client.ts`：`clientConfig` 的 `define` 增加
    `__DSH_PLUGIN_VERSION__`（值取该包 `package.json` 的 `version`；`WorkspaceManifest` 补 `version` 字段）。
  - 新文件 `packages/ui-billing/src/client/version.ts`：`declare const __DSH_PLUGIN_VERSION__` +
    导出 `PLUGIN_VERSION`（`typeof` 守卫，未注入时回落 `dev`，源码直跑不抛错）。
  - `vitest.config.ts`：同源定义同一常量（读 `packages/ui-billing/package.json`），使用例看到的就是发布值。
  - `locales.ts`：`info.hint` 末尾换行后**顶格**接纯版本号 `v{version}`（无缩进、无空行），左对齐。
  - **布局经过多轮试错**（右对齐 → 空一行 → 紧接下一行 → 同排空隙 → 下一行缩进 → 下一行顶格），
    中间形态按用户要求逐次撤回；这些来回提交**已合并成本轮的这一条提交**（不再单独保留在历史里），
    最终形态就是 `\nv{version}`。留档的取舍：DSH `Tooltip` 的 `label` 只接受 `string | (() => string)`
    （不能用 JSX，气泡是单一文本节点），「右对齐」只能靠
    `.amountActions > :global([role='tooltip'])::after` + 自定义属性（依赖「气泡与按钮同级 DOM、无 portal」）
    实现——既然撤回，该 CSS 与自定义属性一并删除，不留残迹。
  - `scripts/verify-packages.mjs`：发布门新增两条检查——`lib/client.js` **不得**残留未替换的
    `__DSH_PLUGIN_VERSION__`（先剔除注释再判定，因为 version.ts 的 JSDoc 会合法地提到该名字），
    且必须含本包版本字面量；通过时打印 `client bundle stamps version x.y.z`。
* 测试：悬停用例断言——气泡文本 == `zh['info.hint'].replace('{version}', PLUGIN_VERSION)`、
  含 `\nv<manifest 版本>`、**无空行**且**无不换行空格**（缩进已取消）、
  `PLUGIN_VERSION` == manifest 版本；文案长度守卫沿用（zh ≤ 100）。
* 验证：全套 **193 用例全绿**；typecheck / lint / build / verify 全绿；构建产物核对——
  `lib/client.js` 内 `PLUGIN_VERSION = "0.3.10"`、label 为 `…\nv{version}`，且不再含 `::after` 规则。
* 文档：根 README 与 ui-billing README 双语补「「?」说明附当前插件版本」，两份 `README.i18n.yaml` hash 重算。

---

# HANDOFF — 发布记录（2026-09-10 · v0.3.10）

* 提交：`2561922`（按事件时刻取费率版本）+ `a8a4d84`（V4.1 Flash 路由与 V4 Pro 9/14 切价）
  + `5caa388`（release: v0.3.10），已推送 origin/main
* tag：`v0.3.10` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.10
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-client-ui-billing` /
  `@rayadesu/dsh-billing` 均为 **0.3.10**（发布顺序 llm-billing → client-ui-billing → dsh-billing；
  `dsh-client-ui-billing` 首次 PUT 后 registry 仍显示 0.3.9 —— npm 的 "being processed" 暂存，
  约 3 分钟后落库，已复核为 0.3.10）
* 版本对齐：三包 0.3.9 → **0.3.10**（根 bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.10`），
  `pnpm-lock.yaml` 随 `pnpm install` 刷新；`AGENTS.md` 版本行同步
* 发布前校验：`pnpm run test`（**191 用例全绿**）/ `build` / `verify` 全绿；`prepublishOnly`
  （verify-packages.mjs）随发布自动运行并通过
* token 由用户提供，**仅内联传参，未写入仓库任何文件**
* 本机 web profile 仍是 local-tarballs 的 0.3.9 `file:` 引用（与 0.3.10 同代码，仅版本号不同）；
  如需换 npm 版本：`dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`

---

# HANDOFF — Flash 系列 9/10 12:00 调价 + V4.1 Flash 上线 + V4 Pro 9/14 切价（按事件时刻取费率版本 · 2026-09-10 已实施，随 v0.3.10 发布）

## 需求与决策

* 官方通知一：**北京时间 2026-09-10 12:00 起**调整 flash 系列定价——空闲时段（低谷）缓存命中输入 **0.02** 元、
  未命中输入 **1** 元、输出 **4** 元（元/百万 token）；高峰时段为空闲时段的 **2 倍**（0.04 / 2 / 8）；
  高峰窗口不变（周一至周五 9:00–12:00、14:00–18:00）。
* 官方通知二（同日补充截图）：**9 月 10 日正式发布 V4.1 Flash 模型**并执行上述新 Flash 定价（同一时刻生效）；
  **9 月 14 日 12:00 下线 V4 Pro 服务**，届时 V4 Pro 路由由 V4.1 Flash 承接并按 V4.1 Flash 计费；
  「V4 Pro 服务期间价格不变」。
* 用户要求：把 **DSH 新增的默认模型**也加进插件（模型名以 DSH 源码/配置界面为准）。核对 DSH checkout
  `packages/llm/llm-deepseek/src/index.ts` 的 `DEFAULT_MODELS`（提交 `bc5fd3b8dc` / `441385fe38`）：
  新增 **`deepseek-flash`（显示名 `DeepSeek-V41-Flash`，text+image，1M 上下文）**，且已退役的预览 id
  `deepseek-v4.1-flash-expires-on-0910` 从目录移除；用户 `~/.dsh/settings.yaml` 的 `agent-default-model`
  正是 `deepseek-flash`，5 个 `subagent-model-selection.allowedModels` 仍是 8 月的旧 id。
* **用户决策（已确认）**：**按事件时刻取对应费率版本**——各调价时刻之前的事件与历史记录仍按 8 月 17 日的旧价
  （峰 0.10 / 3.0 / 9.0、谷 0.05 / 1.5 / 4.5），12:00 起按新价；这样「今日共花费」与官方账单一致
  （实施时正是 12:00 刚过，当天上午的用量必须仍按旧价计）。

## 改动

* `billing.ts`
  - 新增 `DeepSeekRateRevision`（峰/谷单价 + 可选 `effectiveFrom`，**含**该时刻）；`DeepSeekModelPricing`
    改为 `{ peak, offPeak, revisions }`（`peak`/`offPeak` = 最新版本，供展示与兼容读取）；
    `BillingConfigModel` 继承 `DeepSeekRateRevision`，配置面因此新增 `effectiveFrom`。
  - 新增 `FLASH_SERIES_RATE_CHANGE_AT = Date.UTC(2026, 8, 10, 4, 0, 0)`（= 北京时间 2026-09-10 12:00）
    与 `V4_PRO_ROUTE_SWITCH_AT = Date.UTC(2026, 8, 14, 4, 0, 0)`（= 北京时间 2026-09-14 12:00）。
  - `DEFAULT_MODEL_PRICING` 现为 **12 行 / 6 个模型**：`deepseek-flash`（V4.1 Flash，新增）、
    `deepseek-v4-flash`、`deepseek-v4.1-flash-expires-on-0910`（退役预览 id，留作历史计价）、
    `deepseek-v4-flash-vision-exp` 各「基础版 + 新版」两行（共享 `FLASH_BASE_RATES` / `FLASH_REPRICED_RATES`）；
    `deepseek-v4-pro` 两行（自身费率 + 自 `V4_PRO_ROUTE_SWITCH_AT` 起改用 V4.1 Flash 费率，见
    `V4_PRO_SWITCHED_RATES`）；MiMo 两行不变。
  - `resolveBilling` 按模型聚合成费率版本表：按 `effectiveFrom` 升序（无日期的基础版本最前），
    同一生效时刻的多行**后者覆盖前者**（沿用「显式行覆盖同一模型」的既有语义，避免重复版本或第二个基础版本）。
  - `BeijingParts` 新增 `time`（epoch 毫秒，`beijingPartsOf` 一次解析即带回，不新增解析）；
    新增私有 `ratesAt(revisions, time)` 取「生效 ≤ 样本时刻」的最新版本；`priceUsage` 用它取代原来的
    单一 `pricing.peak/offPeak`。样本早于最早的带日期版本时**按该版本计价**（不静默不计费）。
* `projection.ts`：`stateVersion` 3 → 4——旧检查点行是按「单一费率」折出来的，12:00 之后折叠进旧行的样本会
  留着被取代的旧价，故提升版本丢弃重折（每会话一次性重折，非全量冷读）；同时把「投影计价对历史冻结」的说明
  改为「官方费率版本随闭包按样本时刻解析，只有手工改 `billing.models` 才只影响之后折叠的事件」。
* `index.ts`：`DEFAULT_MODELS` 与 DSH `llm-deepseek` 目录对齐——新增 `deepseek-flash` / `DeepSeek-V41-Flash`
  置于最前（DSH 当前默认路由），保留退役预览 id 供历史会话显示可读标签；导出 `FLASH_SERIES_RATE_CHANGE_AT`、
  `V4_PRO_ROUTE_SWITCH_AT` 与 `DeepSeekRateRevision`；配置 schema 把行 schema 抽成
  具名 `billingRateRow: z<BillingConfigModel>` 并加 `effectiveFrom: z.number().min(0)`（具名标注同时解决
  schemastery `ObjectT` 要求字段必填、与 `effectiveFrom` 可选之间的类型冲突）。
* `types.ts`：模块头的计费口径补「费率版本按样本自身时刻取，含 V4 Pro 9/14 起改用 V4.1 Flash 费率」。
* 本轮改动已随 **v0.3.10** 发布（提交 `2561922` + `a8a4d84`，见上一条发布记录）。

## 验证

* **语料核对**（对 `%DSH_HOME%\sessions` 近 3 天日志按 zstd 帧解码——每文件数百帧——扫描，5750 条模型引用）：
  `deepseek-flash` **120 条，最早一条 2026-09-10 11:56:31**——新路由在 12:00 前确有用量（本会话自身就跑在
  `deepseek-flash` 上），所以它的「基础版本行」是必需的，不是冗余；其余 `deepseek-v4-flash-vision-exp` 3077、
  `deepseek-v4.1-flash-expires-on-0910` 1580、`deepseek-v4-flash` 848、`deepseek-v4-pro` 2 条，全部有费率行；
  `dots3-note-prev` 123 条无费率行（第三方 Dots，插件本就不预估非 DeepSeek/MiMo 模型，面板文案已声明）。
* `billing.spec.ts`：默认费率、目录覆盖、费率版本历史断言重写；`beijingPartsOf` 断言补 `time`；
  `rate revisions` 两组共 **12 条**用例——flash 切点前 1 毫秒 / 切点整 / 切点后峰时、flash 四个路由同价且
  标签正确、新增路由 `deepseek-flash` 跨切点、V4 Pro 在 flash 切点不变而在自身切点（09-14 12:00）改按
  V4.1 Flash 计费、同一北京日两段费率求和、配置化版本表（行序颠倒、同刻后者覆盖）、仅带日期版本的兜底。
  **全套 191 用例全绿**（185 → 191）。
* typecheck / build / lint / verify 全绿。
* **构建产物运行期核对**（临时脚本，核对后删除）：`Config({})` → 目录 7 行（首行
  `deepseek-flash=DeepSeek-V41-Flash`）、`billing.models` **12 行**；`deepseek-flash` / `deepseek-v4-flash` /
  `deepseek-v4-pro` 各 2 个版本、`mimo-v2.5` 1 个；两切点分别打印 `2026-09-10T04:00:00.000Z` 与
  `2026-09-14T04:00:00.000Z`；`deepseek-v4-pro` 09-14 11:59:59 → 40.80（自身峰价）、12:00:00 → 5.52
  （V4.1 Flash 谷价）。
* 文档：根 README 与 llm-billing README 双语（模型目录对齐 DSH、两轮调整、配置表 `effectiveFrom`、
  已知限制改写），两份 `README.i18n.yaml` blob hash 已重算；ui-billing `info.hint`（中英）补
  V4.1 Flash 上线与 V4 Pro 9/14 切价说明。

## 本地安装（已完成）

* `npm pack` 三包 0.3.9 → `%DSH_HOME%\local-tarballs\`；
  `dsh plugin --profile web remove`（三个 @rayadesu 包）后 `add` 三个 `file:` 0.3.9 tarball（本轮共装两次，
  第二次含 V4.1 Flash 路由与 V4 Pro 切价）。
* 装后核对：profile `package.json` 三行均为 0.3.9 tarball 且 bundle 行恢复；宿主 `lib/index.js` 含
  `FLASH_SERIES_RATE_CHANGE_AT` / `V4_PRO_ROUTE_SWITCH_AT` / `deepseek-flash` / `effectiveFrom`；
  客户端 `lib/client.js` 含新 hint 文案。（`dsh: warning: ... declares no dsh.bundle` 两条为既有正常提示。）

## 用户待办

1. **重启 `dsh web` 并硬刷新**（当前进程仍是旧插件：既没有 `deepseek-flash` 费率行，也会在 12:00 之后继续
   按旧价折新事件）。
2. 今日共花费覆盖 09-10 全天：上午按旧价、12:00 起按新价，与官方账单口径一致；**本会话（默认模型就是
   `deepseek-flash`）**跨 12:00，正好用来核对分段。首次读取因投影 `stateVersion` 4 会重折一次缓存行
   （略慢，不是错误）。
3. 面板说明文字应显示「flash 系列自 9 月 10 日 12:00 起执行新价…V4 Pro 自 9 月 14 日 12:00 起改由
   V4.1 Flash 服务」。
4. 09-14 12:00 之后如仍能选到 V4 Pro 并用它聊天，核对金额是否已按 V4.1 Flash 费率计（届时 DSH 可能已把
   该路由从目录移除，那就只影响历史日志的计价）。

---

# HANDOFF — 发布记录（2026-09-09 · v0.3.9）

* 提交：`98bad2a`（release: v0.3.9，含本轮 8 个优化提交与 `a6c0367` 的 V4.1 Flash 计费）
* tag：`v0.3.9` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.9
* npm `dist-tags.latest`：`@rayadesu/dsh-llm-billing` / `@rayadesu/dsh-client-ui-billing` /
  `@rayadesu/dsh-billing` 均为 **0.3.9**（发布顺序 llm-billing → client-ui-billing → dsh-billing；
  `dsh-client-ui-billing` 首次 PUT 被 npm 暂存（"being processed"），约 5 分钟后自动落库，
  已从 registry 拉回 tarball 复核新代码在包内）
* 发布内容：DSH 0.1.5 冷读回归修复 + 全量性能优化（P0/P1/P2，见下一节）+ V4.1 Flash 计费
* **用户重启后已验证（主机侧证据）**：DSH 进程于 13:33:43 重启；`session_projcache` 中新写入的
  `billingTodaySpend` 行为 `ver: 3`（含 `session` / `inheritedEventCount` / `last` 字段），
  且当前会话的 `seq` 实时推进 → 新投影单元已注册、折叠并在每个 `turn/end` 落检查点。
  客户端观感（徽标即时渲染、行尾金额补齐）需用户目视确认。
* 本机 web profile 仍为 local-tarballs 的 0.3.8 `file:` 引用（与 0.3.9 同代码，仅版本号不同）；
  如需换 npm 版本：`dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  后重启 `dsh web`。

---

# HANDOFF — 全量性能优化（DSH 0.1.5 冷读回归修复 + 传输/渲染重排 · 2026-09-09 已实施，已随 v0.3.9 发布）

## 问题与根因（先看这段）

用户反馈「dsh 更新几轮后插件显示有些迟钝」。全量审计（三个并行子代理 + 真实语料实测）结论：

* **根因 A（致命，性能 + 正确性）**：DSH `9b78f99dec`（2026-09-06，在 0.1.5-alpha.1 中）把
  `SessionHandle.read()` 的返回从裸数组改成 `{ eventState, events }`。插件仍按数组处理
  （`today-spend.ts` 的 `events: await handle.read()`），折叠时对对象 `for…of` 抛错 → 被 catch
  吞掉 → **失败不写 `coldResolved`** → 每 60 秒对全部冷会话重读一遍日志再丢弃。语料实测：
  233 个逻辑会话 / 544 MB 解压 / 63 万事件，全量冷读 ≈ 13–17 秒/轮。
* **根因 B（阶梯长期失效）**：插件的 `projectionCache.coldSnapshot(id)` 只匹配 0.1.1-rc.2 的
  异步签名；0.1.2-alpha.1 起真实签名是同步三参 `coldSnapshot(meta, inheritedEventCount, events)`，
  调用必然抛错 → 从不走缓存行。而磁盘上 233 份投影缓存里已有 225 份存了 `billingTodaySpend` 行。
* **根因 C（渲染卡顿）**：每条已定稿消息一次 `getTurnSpend` Remote（一次 HTTP POST，无批处理），
  宿主侧每次两遍全日志 → 实测 **1.57 ms/条**（10 个大会话 4070 条共 6.37 秒）；一趟映射只需 0.9 µs/条。
* 次要：余额每次挂载走网络且无超时/缓存（切会话徽标先空一会儿）、今日花费 60 秒 TTL 导致数字不动、
  排行在挂载时就扫、客户端 turnCost 缓存满 1024 整表清空、只计 `assistant/message`（DSH 自身口径还计
  `assistant/attempt`）。

## 改动（每项一个提交，均「四绿」通过）

1. `30e50b7` fix: 冷会话读取兼容 DSH 0.1.5 形状、接回投影缓存零 I/O 快路径并提前注册单元 ——
   `handleReadEvents` 兼容两种 read 形状；`cachedSnapshot(header, 0, [key])` 零 I/O 作答（行自身日期
   非查询日即采信）；失败按 revision 负缓存（`COLD_FAILED_CACHE_LIMIT`）；`apply()` 里注册表一存在就注册
   投影单元（`createUnitRegistrar`），DSH write-behind 因此从启动起为每个 `turn/end` 落行。
2. `395955d` perf: 回合成本改为一次批量拉取 —— 新增 `getSessionTurnSpends(sessionId)`（`SessionTurnSpendFolder`
   增量折叠，宿主按会话缓存 64 条）+ 客户端 `createTurnCostStore`（每会话一次、并发共享、缺失 id 只重拉一次）。
3. `c200eac` perf: 余额 15s 宿主 TTL + 5s 超时（`AbortSignal.timeout`），客户端 `getCachedBalance` 让
   徽标挂载即渲染、后台校验；`getBalance(force?)` 手动刷新绕过 TTL。
4. `abdf470` perf: 聚合与排行共用一次 `scanDetail`（一次扫描同时产出两者），排行改为面板打开时才拉取。
5. `3f05e0f` feat: 投影单元 v2——状态加 `session`（全量累计）与 `inheritedEventCount`（单元自身带边界，
   分叉子会话的 eager cell 直接正确，删除 `ownBillingState` 旁路）；客户端「本会话花费」改读
   `useProjection('billingTodaySpend')`（零 Remote、实时），Remote 仅作回退；新增包导出子路径 `./projection`。
6. `8515d8c` feat: 对齐 DSH 口径——`applyBillingEvent` 把 `assistant/attempt` 内嵌 stream 的 usage 也计价
   （模型取最近 `request/header`），同 `(turn, step)` 后样本替换前样本，`llm/retry-started` 后重试累加；
   `SpendAccumulator` 之外新增 `subtractSpend`/`negateSpend`/`BillingFolder`，`computeSessionSpend` /
   `computeTodaySpend` / `computeTurnSpend` / 投影单元全部走同一折叠。**金额会略增**（语料中 115 条带
   usage 的 attempt，其中 41 个 step 同时有 message → 靠替换不双计）。投影 `stateVersion` 3。
7. `6b4b43a` perf: `beijingPartsOf` 改纯整数运算（去掉每事件 `Date` + `toISOString().slice`）；
   920,039 个时间戳与 Date 参照零差异，补月/年/闰日/纪元边界用例。

## 验证

* **174 用例全绿**（新增 30 条：read 形状、负缓存、缓存行快路径、批量回合成本、余额 TTL/强制、
  attempt 计价/替换/重试、北京日算术边界、共享扫描、useProjection 渲染等）。
* `pnpm run test` / `build` / `typecheck` / `lint` / `verify` 全绿；typert 已重生成
  （`getSessionTurnSpends` 进入 `lib/typert.remote-client.*`）。
* 文档：根 README 与两个包 README 双语同步（Remote 方法、读取路径、分叉边界、运行时兼容、
  已知限制），三份 `README.i18n.yaml` blob hash 重算。
* 未改版本号（0.3.8），未推送、未发布。
* **本地安装已完成**：三包 0.3.8 `npm pack` → `%DSH_HOME%\local-tarballs\`，remove + add 装入 web profile。
* **用户待办**：重启 `dsh web` 并硬刷新，重点核对——① 徽标切会话立即出现（不再空白等待）；
  ② 长会话打开/滚动时行尾 `¥金额` 迅速补齐、不再逐个转圈；③ 今日共花费在回合结束后 2 秒内更新；
  ④ 详情面板打开时才拉排行；⑤ 终端不再刷 `llm-billing:` 警告；⑥ 金额与 DSH 的 🗄用量口径一致
  （重试回合会略高于旧版）。

---

# HANDOFF — 新增 deepseek-v4.1-flash-expires-on-0910 计费（与 V4 Flash 同价 · 2026-09-09 已实施，未发布）

## 本轮改动

* **需求**：用户 DSH 新增模型 `deepseek-v4.1-flash-expires-on-0910`（`~/.dsh/settings.yaml` 的
  `llm-deepseek.models` 行：显示名 `DeepSeek-V4.1-Flash`、上下文 1M、支持图片输入），要求按 V4 Flash 同价计费。
* `billing.ts`：`DEFAULT_MODEL_PRICING` 紧跟 flash 行新增一行——峰 `0.10 / 3.0 / 9.0`、谷
  `0.05 / 1.5 / 4.5`（元/百万 token，与 `deepseek-v4-flash` 逐桶一致；图片按同一单价折算 token，
  与 vision-exp 同理）。
* `index.ts`：`DEFAULT_MODELS` 新增展示行 `{ id: 'deepseek-v4.1-flash-expires-on-0910',
  name: 'DeepSeek-V4.1-Flash' }`（显示名取自用户 settings.yaml 的 `name`，徽标/面板直接显示）。
* 测试：`billing.spec.ts` +1 用例（新模型与 flash 在峰/谷两端总额与三个 token 桶等价、displayName 正确）
  + 默认费率表断言；**全套 144 用例全绿**。
* 文档：根 README 与 llm-billing README 双语模型列表补 V4.1 Flash（顺带补上此前遗漏的 MiMo 行），
  两份 `README.i18n.yaml` blob hash 已重算。
* 版本未动（0.3.8）；未推送、未发布。

## 验证

* `pnpm run test` / `pnpm run build` / `pnpm run lint` / `pnpm run verify` 全绿。
* 本地 pack 三包 0.3.8 → `%DSH_HOME%\local-tarballs\`，remove + add 装入 web profile。
* **用户待办**：重启 `dsh web` 并硬刷新，用 V4.1 Flash 聊一轮，核对「本轮花费」与详情面板里该模型
  的金额（应与同用量的 V4 Flash 一致）、模型名显示为 `DeepSeek-V4.1-Flash`。

---

# HANDOFF — 全量代码优化（P0 性能/结构 + P1 可维护性 · 2026-09 已实施，纯重构，未发布）

## 实施范围（每项一个 commit，均「四绿」通过）

* `3e8f781` perf: price each event with one Beijing-time parse — 今日扫描每条事件只做一次时区解析（原为「日过滤 + 计价」各解析一次）；新增 `priceEventAt` / `beijingPartsOf`
* `8537481` perf: evict oldest cache entries instead of clearing on capacity — `sessionSpendCache`（含 LRU touch）、`coldResolved`、`ownStates` 满额逐出最旧（原为整体 clear / 无上限）
* `de9ad49` refactor: dedupe the four today-spend scan paths — 投影两路共享 `liveBillingEntries` + `coldAdopt`；事件两路共享 `collectTodayEvents`（单遍收集 + 截断 + revision watermark 语义不变）
* `69a2442` refactor: share client money formatting — 新建 `packages/ui-billing/src/client/format.ts`（formatSpend / currencySymbol / primaryLine）
* `0d17c78` polish: type the published tables as readonly and name tunable constants — `DEFAULT_PEAK_HOURS` 标注 `PeakHourWindow[]`、表 readonly（schemastery default 改为展开副本）；`TURN_SETTLE_DEBOUNCE_MS` 具名
* `34ed492` ci: GitHub Actions workflow — push/PR 跑 install → typecheck → build → test → verify
* `1f235b5` build: minimal ESLint config（`eslint.config.mjs` + `pnpm lint`）— typescript-eslint recommended + react-hooks 两条规则；`_`-前缀参数豁免；顺带修复 BalanceBadge 一处真实 `exhaustive-deps`（ref 读取「values already present」）
* `96d9199` refactor: split BalanceBadge — `useBillingData.ts`（状态 + 三个 effect + fetchLine）+ `BalanceTrigger.tsx` / `BalancePanel.tsx` 纯视图；导出面（BalanceBadge / 类型 / SESSION_RANKING_LIMIT / TURN_SETTLE_DEBOUNCE_MS）不变
* `2ecf394` refactor: converge apply() — `resolveFacts` / `resolveApiKey` / `createSessionSpendFetcher` / `createTodaySpendLoaders` / `createTurnSpendFetcher`；apply 变 15 行装配，缓存仍按实例持有、扫描依赖保持惰性解析
* `cc9f3ed` docs: dedupe repeated billing-semantics JSDoc — 峰谷口径只写一次（types 模块头 / priceEvent），其余引用

## 验证

* 143 用例全绿；typecheck / lint / build / verify 全绿（每项提交前均跑）。
* 未改版本号（0.3.8），未发布；计费逻辑、双运行时兼容层、定价表零改动；README 无功能变化未改。
* 已知权衡：P2 项（turn 花费二分、balance 超时、环境解析缓存、Remote cancellation）经评估**不做**，理由见讨论记录。

# HANDOFF — billing 插件适配 DSH 0.1.2-alpha.5 基线（persistence handle 面 + 客户端栈重构 · 2026-09-03 检查并修复）

## 发布记录

### 2026-09-09 · v0.3.8

* 提交：`58f0942`（feat: 新增 MiMo-V2.5 系列模型计费）+ `a84ef65`（release: v0.3.8）
* tag：`v0.3.8` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.8
* npm dist-tags.latest：
  - `@rayadesu/dsh-billing` → 0.3.8
  - `@rayadesu/dsh-llm-billing` → 0.3.8
  - `@rayadesu/dsh-client-ui-billing` → 0.3.8
* 发布内容：新增 MiMo-V2.5 系列模型计费（mimo-v2.5-pro、mimo-v2.5），不区分峰谷，统一费率

### 2026-09-08 · v0.3.7

* 提交：`da1875b`（fix: 适配 DSH 0.1.2-alpha.5 兼容性问题）+ `16f8e69`（release: v0.3.7）
* tag：`v0.3.7` — https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.7
* npm dist-tags.latest：
  - `@rayadesu/dsh-billing` → 0.3.7
  - `@rayadesu/dsh-llm-billing` → 0.3.7
  - `@rayadesu/dsh-client-ui-billing` → 0.3.7
* 发布内容：DSH 0.1.2-alpha.5 兼容性修复（handle-based persistence seam 双运行时探测、客户端栈重构适配、React 去重、typert 清单修正）

## 问题与根因

- **现象**：用户 DSH（checkout master，`49a606bc5b` = 0.1.2-alpha.5 版号 + 38 个后发布提交）更新后，
  插件 0.3.6 按 `^0.1.1-rc.2` 基线编译，存在两类运行时断点：
- **根因 1（致命，宿主侧）**：`refactor(session-persistence)!: handle-based seam`（在 alpha.5 发布之后、
  当前 master 已含）把 `SessionPersistence` 的服务面从 `inspect(id)` / `listSnapshots()`
  换成 `stat(id)` / `list()` / `open(id, 'read')` + `SessionHandle.read()`。插件在
  `sessionEvents`（`getSessionSpend`/`getTurnSpend` 冷读）与 `TodaySpendScanner` 全部四个
  扫描路径上直接调用 `inspect` / `listSnapshots` → 新运行时下 `TypeError: not a function`。
- **根因 2（客户端）**：客户端栈重构把运行时 bundle（`dsh-client-runtime`，已删除）拆成
  `dsh-client-store` / `dsh-client-ui-session` / `dsh-client-ui-chat` + renderer 自持的
  `SlotRegistry`；`conversation.chat.assistant-actions` slot 行从 ui-conversation 移到 ui-chat；
  `SlotCore.register` 类型面（`init` 元数据参数等）收紧。旧测试底座（module-loader shim 直接回退
  Node require）在跨 bundle require 时拿到空 `module.exports`；本地 fixture renderer 源码为旧版。

## 修复（双运行时形状兼容，与既有 Session 双面同一设计）

- `today-spend.ts`：`ScannerPersistence` 双面（legacy `inspect`/`listSnapshots` vs handle
  `open`+`read`/`list`），新增 `persistenceListSnapshots` / `persistenceInspect`
  （handle 读取后必定 `close`，读失败也 close）；`ScannerSession` /
  `ScannerPersistenceHandle` 的签名改为方法语法保持对真实类的双侧可赋值（branded
  `SessionLogOffset` 参数）；`TodaySpendScannerDeps.persistence` 收窄为 `ScannerPersistence`。
- `index.ts`：`sessionEvents` 改走 `persistenceInspect`。
- `billing.ts`：`ForkBoundarySource.header/meta` 扩成 `{ seedLength?, isSeeded? }`（HEAD
  `SessionHeader` 无 `seedLength` 时仍可弱类型匹配）。
- `projection.ts`：`BillingUnitFold`（`init(...metadata: never[])` 兼容 0.1.1-rc.2 无参与
  0.1.2-alpha.5+ 带 header/inheritedEventCount 两种声明），`foldBillingUnit` /
  `foldOwnBilling` 改用它。
- `ui-billing`：客户端类型合并补 `@deepseek-ai/dsh-client-ui-chat/client`（assistant-actions
  行来源）；测试底座升级：module-loader shim 在 fallback require 后复查已注册 bundle 导出；
  test-runtime 依赖闭包补齐 `dsh-client-store` / `dsh-api-gateway` / `dsh-client-ui-chat`；
  vitest 用 resolve alias 把 react/react-dom/use-sync-external-store 钉到本仓库副本
  （checkout 链接包会解析出 DSH 自己的 react 副本，hooks 双引擎崩溃）；
  renderer fixture 同步到 HEAD（bind.ts / bindings.tsx / scoped-slots.tsx；删 session-provider.tsx）。
- **基线提升**：全部 `@deepseek-ai/dsh-*` dev+peer 依赖 `^0.1.1-rc.2` → `^0.1.2-alpha.5`；
  内嵌 `packages/typert-protocol` 声明同步到 npm 0.1.2-alpha.5（新增 remote-error.ts）。
- 测试：+4 用例（handle 家族事件路径/分叉边界/读失败仍 close/投影阶梯），
  **全套 139 用例全绿**（npm 0.1.2-alpha.5 基线复验 + checkout HEAD link 复验双通过）；
  `build` / `verify` 全绿。

## 关键文件清单
- 修改：packages/llm-billing/src/{today-spend.ts,index.ts,billing.ts,projection.ts}、
  packages/llm-billing/tests/today-spend.spec.ts、
  packages/ui-billing/src/client/index.ts、packages/ui-billing/tests/{module-loader.setup.ts,browser-plugin.client.spec.ts}、
  packages/ui-billing/tests/fixtures/renderer-src/client/{bind.ts,bindings.tsx,scoped-slots.tsx}（同步 HEAD；删除 session-provider.tsx）、
  vitest.config.ts、tsconfig.base.json（无净变更）、package.json、packages/{llm-billing,ui-billing}/package.json、
  packages/typert-protocol/{package.json,src/index.ts,src/types.ts,src/remote-error.ts}、
  pnpm-workspace.yaml、AGENTS.md、README{,.zh}.md、packages/llm-billing/README{,.zh}.md、README.i18n.yaml×2、pnpm-lock.yaml、HANDOFF.md

## 剩余步骤（用户自行执行，可选）
1. 打包本地 tarball 并重装验证：`pack` 三个包 → `.dsh/local-tarballs` → `dsh plugin --profile web update --latest`（或先 remove 再 add），重启 `pnpm dsh web` 核对徽标与详情面板。
2. 验证分叉会话（fork 后今日花费不双计）与冷恢复会话（旧会话今日花费可读）。

## 注意事项
- npm 发布线 `0.1.2-alpha.5`（alpha dist-tag）的 persistence 仍是旧服务面
  （`inspect`/`listSnapshots`）；handle 化只在 checkout master（版本号仍 0.1.2-alpha.5）。
  双面实现让同一产物同时服务两代，宿主按其自身能力调用。
- 客户端测试依赖 `dsh-client-test-runtime` 的 bundle 闭包；npm 包的 `files` 不含
  renderer `src/*`，fixture 副本必须与对应 DSH 版本的 renderer 源文件一致。

# HANDOFF — billing 插件 0.3.6（适配 DSH 0.1.2-alpha.4 会话日志表面 · 2026-09-02 已实施 + 本地安装）

## 问题与根因

- **现象**：DSH 更新到 0.1.2-alpha.4 后，徽标的「本轮会话」与「今日会话」不再显示
  （余额仍正常）。
- **根因**：0.1.2-alpha.4 移除了 live `Session` 的 `events` getter 与
  `SessionHeader.seedLength`（后者在内存 header 上直接被校验拒绝）：
  1. `Session.events` → `Session.snapshotEvents()` / `ownEvents()`；
  2. `header.seedLength` → `Session.inheritedEventCount`（持久化 `inspect()` 结果在
     `meta` 之外携带；`listSnapshots()` 的 header 只剩布尔 `isSeeded`）。
  插件 0.3.5 按 npm 基线 `^0.1.1-rc.2` 编译、读取旧形状，运行时：
  - `getSessionSpend`：`live.events` 为 `undefined` → `events.length` TypeError → 「本轮」失败；
  - `getTodaySessionsSpend`：`foldSessionTitle(session.events)` → 同样 TypeError
    （`scanSessionsProjections` 的 `session.events` 访问）→ 「今日会话」排行失败；
  - `getTodaySpend` 聚合在投影路径下仍可算（live 会话经 `stateOf`，未触碰 `.events`），
    但分叉边界恒为 0（`forkBoundaryOf` 读不到 `seedLength`）→ 分叉重复计费回归。
- 已用复现脚本在 0.1.2-alpha.4 运行时（cordis + SessionStore + SessionProjectionRegistry +
  真实会话日志解码）确认：`getSessionSpend` / `scanSessions` 抛
  `Cannot read properties of undefined (reading 'length')`；投影聚合正常；会话事件形状
  （`assistant/message` + `usage` + `message.source.model`）未变。

## 修复（0.3.6 · 双运行时形状兼容）

- `billing.ts`：`forkBoundaryOf` 泛化为结构读取（`inheritedEventCount` 优先，回退
  `header.seedLength` / `meta.seedLength` / `seedLength`），新增 `isSeededSession`
  （`isSeeded === true` 或旧头部 `seedLength > 0`）。
- `today-spend.ts`：`ScannerSession` / `ScannerPersistedHeader` 取双形状；新增
  `liveSessionEvents`（`events` 优先，否则 `snapshotEvents()`，两者皆无显式抛错——
  未知运行时表面不静默按零计费）；四个扫描路径全部改走
  `liveSessionEvents(session)` + `forkBoundaryOf(session)`；冷会话改用
  `isSeededSession(快照 header)` 决定是否跳过投影缓存阶梯，精确边界由
  `inspect()` 的结果（`inheritedEventCount` 或 `meta.seedLength`）提供。
- `index.ts`：`sessionEvents` 读 live 会话走 `liveSessionEvents(live)` +
  `forkBoundaryOf(live)`；持久化侧 `forkBoundaryOf(inspection)`。
- 投影路径对分叉子会话的行为不变（绕过 eager cell、折自有事件）；事件路径与冷阶梯
  语义不变，只是边界来源换成双形状。
- 测试：+10 用例（`forkBoundaryOf` 三形状与优先级、`isSeededSession`、事件路径
  新形状 live/冷分叉/阶梯跳过、apply 层新形状会话花费/今日聚合）；
  **全套 135 用例全绿**；`build` / `verify` 全绿。
- 文档：llm-billing README 双语补「Runtime compatibility / 运行时兼容性」并更新
  分叉会话边界描述；`README.i18n.yaml` blob hash 已重算；AGENTS.md 版本号同步 0.3.6。
- 版本：三包统一 **0.3.6**（bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.6`），
  lockfile 随 `pnpm install` 重生成。
- **本地安装已完成**：`npm pack` 三包 0.3.6 → `%DSH_HOME%\local-tarballs\`，
  经 `dsh plugin --profile web remove`（三个 @rayadesu 包）后 `add` 装入 web profile
  （package.json 现为三个 `file:` 0.3.6 引用；安装后的 `lib/index.js` 已确认含
  `snapshotEvents` / `inheritedEventCount` / `liveSessionEvents`）。
- **用户待办**：重启 `dsh web` 并硬刷新，验证「本轮会话」金额、「今日会话」排行与
  「本轮花费」（每条消息的行尾 ¥金额）恢复显示；分叉会话今日花费不再含继承前缀。

## 发布记录（2026-09-02 · 0.3.6）

- **已发布完成**：提交 `95b60d0`（中文提交信息）已推送 origin/main；tag `v0.3.6` 已推送；
  GitHub Release **v0.3.6** 已创建（中文发布说明，
  https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.6）。
- **npm 三包均发布成功**：顺序 llm-billing → ui-billing → dsh-billing，registry
  `dist-tags.latest` 均为 0.3.6（token 由用户提供，仅内联传参，未写入任何文件；
  prepublishOnly 自动运行并通过）。
- 本机 web profile 仍为 local-tarballs 的 `file:` 引用 0.3.6（本地验证用）；
  如需换 npm 版本：`dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  后重启 `dsh web`。
- **Release 格式统一（2026-09-02）**：全部 8 个 GitHub Release（v0.1.0 → v0.3.6）改为
  DSH 官方格式——裸版本号标题 + 中文/English 双语双段 + `h3 id="cn-v<ver>"` 锚点 +
  逐条 `@作者`（英文 `by @作者`）+ `Full Changelog` compare 链接（v0.1.0 用 commits 链接）；
  修复了 v0.3.6 正文被 PowerShell 内联转义破坏（反引号丢失、`` `e `` → ESC 等控制字符）的问题。
  **分组词汇核对（2026-09-02）**：逐一核对了 DSH 官方全部 8 个 release——分组为四类
  「新增功能/体验优化/问题修复/其他变更 ↔ New Features/Improvements/Bug Fixes/Chores」，
  顺序固定、只写有内容的分组（无「无/None」占位）；v0.2.1/v0.3.5/v0.3.6 已按四组重新归类。
- **新增发布 skill**：`.agents/skills/dsh-release/SKILL.md`（共享 agent 约定目录，
  项目根 rank 200；`.dsh/skills` 为 DSH 专属、rank 100——按用户偏好采用 `.agents`）——
  完整发布流程与 DSH release 模板（四组 + 省略规则）、`--notes-file` 防转义坑、npm 顺序
  发布与 tarball 重装坑。
  **两阶段流程（2026-09-02 定稿，二次修订）**：阶段 A = 改代码 → test/build →
  **直接本地提交（不推送）** → 本地 pack 安装（不 bump 版本，沿用当前版本 tgz，
  先 remove 再 add）→ 交给用户重启 dsh web 验证；用户没发话绝不推送/发布。
  阶段 B = 用户明确说「发布」时：bump 三包版本 → test/build/verify → 版本提交 +
  **推送全部本地提交** → npm 顺序发布 → tag + DSH 格式 Release → HANDOFF 发布记录。

---

# HANDOFF — billing 插件 0.3.5（行尾静态「¥金额」· 2026-08-29 已实施 + 本地安装）

## 方案（用户审核通过的最终版，已按此实施）

- **背景**：DSH 0.1.2-alpha.2 把本轮 token 用量（🗄用量 / ⏱耗时 pills）重排到分支按钮之后
  （`MessageIconActions` 的 `usageAction` prop，硬编码非 slot）；插件的「本轮花费」目前注册在
  `conversation.chat.assistant-actions`（渲染在 copy ↔ branch 之间），靠 CSS `order:-1` 显示在 copy 前。
- **目标**：改成**行尾静态文本** `¥金额`——位于 **时钟之后（整行最后一格）**；不可点击、
  不弹卡片、无图标、无「花费」文字；字体样式**逐项复刻 DSH 时钟文本**（`.timeEnd`）。
- **已确认决策**（与用户逐轮敲定，勿再更改）：
  1. **不改 DSH 源码**（用户明确选纯 CSS 路线；DSH 侧不动 = 无重建 DSH 需求）。
  2. 位置实现只用一条 CSS：`.cost { order: 1 }`（视觉排到所有 order-0 兄弟之后 = 时钟后 / 行末）。
     **不需要 `:global` 规则**。
  3. 「未缓存输入 / 缓存读取 / 输出」**分项计价卡**方案废弃；host（llm-billing）
     **零改动**——只需总额，`DeepSeekTurnSpend` 保持 `{ total }`。
  4. 不做「点击展开卡片」：不新增 `@deepseek-ai/dsh-client-ui-primitives` peer 依赖。
  5. 零花费 / 抓取失败仍隐藏；`cachedTurnCost`（session+message 键控）保留。

## 实施记录（2026-08-29 · 已实施并本地安装）

- 按清单 1–7 全部落地：`TurnCostAction.tsx` → 单个
  `<span data-turn-cost>¥{formatSpend(total)}</span>`（`formatSpend` 与 `cachedTurnCost`
  保留，zero/fail 仍隐藏，`t` 不再使用）；`TurnCostAction.module.css` → 只留 `.timeEnd`
  四属性 + `order:1`（删除 `order:-1`、`margin-left:6px`、图标/分隔线/卡片皮肤）；
  `locales.ts` 删 `turnCost.label`（zh/en，`BillingKey` 自动收缩）；`index.ts` 仅更新注释
  （注册 slot、wiring 不变）。
- 测试：TurnCostAction 用例改为断言——渲染后为单个 `SPAN` + `data-turn-cost`、无 svg、
  无「本轮花费」文字、`¥0.31` 文本、fetch 缓存命中；新增 4 位小数去尾零用例（`¥8.5`
  而非 `¥8.5000`）；zero/fail 隐藏断言改用 `/^¥/` 无渲染。**全套 125 用例全绿**；
  build / verify 全绿。
- 版本：三包统一 **0.3.5**（bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.5`），
  lockfile 随 `pnpm install` 重生成；AGENTS.md 版本号同步 0.3.5。
- 文档：README EN/ZH 本轮行为描述更新（行尾静态金额、时钟之后、复刻 `.timeEnd`、无图标
  无标签、与时钟同受行级悬停显隐）；`README.i18n.yaml` blob hash 已重算
  （README.md `3f7f9c4…` / README.zh.md `96f2085…`）。**截图未更新**（用户确认暂不更新，
  `preview-turn-cost.png` 仍为旧样式，README 标注「0.3.5 改版前」；发布后用户提供了行尾
  新样式的实际截图，README 已同步更新为新图并去掉「改版前」标注）。
- **本地安装已完成**：`npm pack` 三包 0.3.5 → `%DSH_HOME%\local-tarballs\rayadesu-dsh-*-0.3.5.tgz`，
  经 `dsh plugin --profile web add <三个 tgz>` 装入 web profile（package.json 现为 `file:` 引用
  0.3.5）；安装后的 `lib/client.js` 已确认含 `order:1` 的 `.cost` 规则与 `data-turn-cost`，
  且无「本轮花费」文字残留。
- **间距修正（方案 A，用户审核后实施）**：`.cost` 增加 `margin-left: 8px`——金额↔时钟可见
  间距从 8px 提为 16px，与 ⏱耗时→时钟（pill 右内边距 8px + 行 gap 8px = 16px）一致；
  8px 是 DSH pill `padding: 6px 8px` 的镜像，注释已写明由来。重装坑：pnpm 对同名同版本
  tarball 视为未变（`dsh plugin add` 提示 Already up to date），**必须先 `dsh plugin --profile
  web remove @rayadesu/dsh-client-ui-billing` 再 add** 才能刷新安装产物；build/test(125)/verify 全绿。
- **用户待办**：**重启 `dsh web`**（当前进程仍加载旧插件）并硬刷新，然后验证——金额位于
  时钟之后的行末、13px secondary / tertiary / nowrap 与时钟一致、无图标 / 无「花费」字样、
  点击无反应（非按钮）、零花费与 Remote 失败时整格消失、窄视口长金额不破行。

## 关键验证（实施时核对过，供以后参考）

- `MessageIconActions` 渲染序（`ui-chat/src/client/chat/MessageIconActions.tsx`）：
  copy → {extraActions}（assistant-actions 槽，插件在此）→ branch → {usageAction}（🗄⏱ 硬编码）→ clock；
  容器 `display:flex; gap:8px`，插件外全部兄弟默认 `order:0`（已验证 ui-message-feedback 与
  TurnUsagePanel 的 CSS 均无 order）。
- **list slot 条目渲染无 DOM 包裹**：`ui-renderer/src/client/scoped-slots.tsx` 的
  SlotErrorBoundary / StrictSessionEntry 直接渲染 children——插件的 `span` 就是 `.actions`
  的 flex 子项，`order:1` 直接生效，不需要 `:global` 或结构选择器。
- `.timeEnd` 逐字复刻：`font-size: var(--dsh-content-font-size-secondary, 13px)`、
  `line-height: calc(24px + var(--dsh-content-font-delta, 0px))`、
  `color: var(--dsw-alias-label-tertiary)`、`white-space: nowrap`；行内 `gap:8px` 已把金额
  与时钟间距拉开，无需额外 margin；行 `margin-left:-6px` 只影响行首。
- DOM 与视觉分离机理：`order` 只改渲染位置不改 DOM 树；目标为**纯文本不可聚焦 span**，
  Tab 焦点流 = copy → 分支 → 🗄 → ⏱ → 时钟（与视觉顺序一致），仅屏幕阅读器朗读次序中
  金额出现在「复制」之后（已与用户确认接受）。
- hover 显隐：`[data-actions-reveal]` 行级 opacity 规则，金额与时钟同进退，无需单独处理。
- host 零改动成立的前提：DeepSeek API 没有独立缓存写入桶（`cacheWriteTokens` 是给
  Anthropic 类 provider 预留的可选字段），费用天然只有三桶，行和 = 总额恒等。

## 发布记录（2026-08-29 · 0.3.5）

- **已发布完成**：顺序 llm-billing → ui-billing → dsh-billing 均发布成功（token 内联传参，
  未写入任何文件；prepublishOnly 自动运行并通过），registry `dist-tags.latest` 均为 0.3.5。
- 已推送 origin/main（e393833 功能 + d3390ff 间距修正）与 tag v0.3.5；GitHub Release
  **v0.3.5** 已创建（中文发布说明，https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.5）。
- 本机 web profile 仍为 local-tarballs 的 `file:` 引用 0.3.5（视觉效果已验）；如需换 npm
  版本：`dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  后重启 `dsh web`（pnpm 11 发布龄门槛注意 README 的 `minimumReleaseAge: 0` / 显式钉版本）。

---

# HANDOFF — billing 插件 0.3.4（发布 · 2026-08-29）

## 发布记录（2026-08-29 · 0.3.4）

- **已发布完成**：顺序 llm-billing → ui-billing → dsh-billing 均 PUT 成功，registry
  `dist-tags.latest` 均为 0.3.4（0.3.3 的本地 tarball 安装验证通过后发布）。
- 版本号 0.3.3 → 0.3.4（三包统一，bundle peerDeps 与 ui-billing peer/dev 同步 `^0.3.4`），
  lockfile 随 `pnpm install` 重生成；README 无版本引用，i18n hash 未变。
- 发布方式：`npm publish --//registry.npmjs.org/:_authToken=<TOKEN>`（用户提供 token，
  仅内联传参，未写入任何文件），prepublishOnly（verify-packages.mjs）自动运行并通过。
- 本机 web profile 仍为 local-tarballs 的 `file:` 引用（0.3.3）；如需换回 npm 版本：
  `dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  后重启 `dsh web`。

# HANDOFF — billing 插件 0.3.3（分叉会话不重复计费 · 2026-08-29）

## 本轮改动（0.3.3 · 分叉计费修复）

- **问题**：从会话 A「分叉会话」得到 B，B 的日志以 A 的已完成前缀**逐字节副本**开头
  （相同消息 id / 时间戳 / usage）。旧插件把每个带 usage 的 `assistant/message` 按所在日志计价，
  继承前缀在每个副本会话里再计一次——B 的会话花费包含继承历史，今日花费=父+子重复。
  「本轮花费」不受影响（turn 括号内计价且不参与汇总）。
- **修复**：所有计费路径只对会话的**自有事件**计费，边界 = 持久化 `SessionHeader.seedLength`
  （`seq < seedLength` 视为来源会话已计费，跳过；普通会话/冷恢复无 seedLength → 0 全量计费）：
  - `billing.ts`：新增 `forkBoundaryOf(header)`（`seedLength ?? 0`）；`computeSessionSpend` /
    `priceEvents` 增加可选 `startSeq`。
  - `index.ts`：`fetchSessionSpend` 只计自有事件；增量缓存改按**自有事件条数**
    （tail = `events.slice(seedLength + cached.count)`，边界不可变）。
  - `today-spend.ts`：事件路径 `collect` 按会话跳过继承前缀；投影路径对 `seedLength>0` 的会话
    **绕过 eager cell**，用 `ownBillingState`（单元 fold 语义 + 增量缓存）折自有事件；冷会话
    跳过投影缓存阶梯（缓存行覆盖了继承前缀），按 `inspect().meta` 边界本地折叠；
    `scanSessions` 排行同样处理。
  - `projection.ts`：新增 `foldOwnBilling`（带边界的 detached 折叠）。
  - **为什么用 `header.seedLength` 而非日志里的 `session/end-seed`**：fork 与**冷恢复**都会追加
    end-seed（恢复标记还会持久化），一个日志可含多个标记且无法区分；孙代 fork 的日志还夹着中间代
    标记；`seedLength` 是 fork 时写入、恢复时从**持久化 header** 还原的原始边界，唯一可靠。
- **测试**：+14 用例（billing / projection / today-spend 事件+投影×live+冷×汇总+排行 / apply 层
  会话花费与增量尾随）；全套 **124 用例全绿**；`build` / `verify` 全绿。
- **文档**：llm-billing README 双语补「Forked sessions / 分叉会话」；ui-billing README 双语徽标
  说明补分叉语义；两份 `README.i18n.yaml` blob hash 已重算。
- **版本**：三包统一 **0.3.3**（bundle peerDeps `^0.3.3`）。注意：**0.3.2 已于 2026-08-28 16:02
  发布**（徽标详情样式调整，不含本修复，`tag v0.3.2`），故修复顺延为 0.3.3。

## 状态（2026-08-29）

- **已提交并推送**：`81d9ffa`（rebase 于远端 `4a1760c` 之上；远端 4 条提交——v0.3.2 发布与截图
  文档——**全部保留**，冲突仅版本号与 ui-billing README / lockfile，逐一合并后 lockfile 重新生成）。
- **未上传 npm**（按用户要求）。将来发布须带 bypass-2FA token，顺序 llm-billing → ui-billing →
  dsh-billing（坑见下文）；0.3.2 已在 registry，0.3.3 发布不会冲突。
- **本地测试安装已完成**：`%DSH_HOME%\local-tarballs\` 下三个 0.3.3 tarball（`npm pack` 产物），
  经 `dsh plugin --profile web add <三个 tgz>` 装入 `web` profile（package.json 现为 `file:` 引用
  0.3.3；安装后的 lib 已确认含 `forkBoundaryOf` / `ownBillingState` / `foldOwnBilling`）。
- **用户待办**：**重启 `dsh web`**（当前进程仍加载旧插件），然后验证——分叉新会话刚生成时
  本会话花费应显示 ¥0；聊几句后只算分叉后新交流；今日共花费不再含继承前缀。
  dsh CLI 在 harness 仓库：`node <harness>\apps\cli\lib\bin.js …` 或 `pnpm --dir <harness> dsh`。

---

## 历史：0.3.0（2026-08-28 发布 · 文档与发布）

## 本轮改动（0.3.0 · 文档与发布）

- README 预览换成两张真实截图：`preview-overview.png`（全景：头部徽标 + 详情面板 +
  今日会话花费排行 + 操作行里的本轮花费）与 `preview-turn-cost.png`（本轮花费行特写），
  删除旧的 `billing-preview.png`；根 bundle `files` 补两张图（npm 页面 README 图片不 404）。
- 三包版本 0.2.4 → 0.3.0；**清掉误入根 package.json 的 `file:` 自引用依赖**
  （错误 workdir 的 `pnpm add` 残留，指到 %TEMP% 打包产物），lockfile 随之重生成。
- 说明：0.2.4 的功能代码（本轮花费 + 今日会话花费排行）此前后台已发布但未补 tag/release，
  本轮以 0.3.0 统一发布；安装示例、AGENTS.md、PLAN.md 版本号同步更新。

## 发布记录（2026-08-28 · 0.3.0）

- **已发布完成**：顺序 llm-billing → ui-billing → dsh-billing 均 PUT 成功，registry
  `dist-tags.latest` 均为 0.3.0。prepublishOnly（verify-packages.mjs）随发布自动运行并通过。
- 发布方式：`~/.npmrc` 恢复 `${NPM_TOKEN}` 环境展开（token 不落盘、不进仓库也不进命令历史），
  `export NPM_TOKEN` 后逐个目录 `npm publish`；与 README 约定一致（0.2.3 用显式
  `--//registry.npmjs.org/:_authToken=` 传参，同样未写入任何文件）。
- 提交并推送 origin（中文提交信息），GitHub Release **v0.3.0** 已创建（含 tag v0.3.0），
  正文为中文发布说明，风格对齐 v0.2.3。
- profile 已从 npm 0.3.0 重装（替换 %TEMP% 临时 tarball 的 `file:` 依赖）——
  **重启 `dsh web` 并硬刷新**后生效。

---

## 历史：0.2.3（2026-08-28 发布 · 全量优化，按用户审核通过的方案执行）

**性能（热路径）**
- `withConcurrency` 索引化：`queue.shift()` O(n²) → 共享索引 O(n)。
- `SpendAccumulator`（Map 键控折叠原语）：`priceEvents` / `computeTodaySpend` / `scanEvents`
  单遍路径统一折叠实现，`addEventContribution` / `mergeTodaySpend` 收敛到同一 `mergeModelRows`；
  20 万事件折叠不再每事件拷贝数组，GC 压力大减。公开 API 签名与语义不变。
- `beijingParts` 单点时区换算：`isPeak` / `beijingDayKey` / `priceEvent` 共用一次 `Date`
  分配（原每个计价事件 3 次），时区换算逻辑不再三处分散。
- `scanEvents` 单遍"收集即计价"：去掉中间事件数组与第二次 dayKey 过滤/计价；上限截断语义、
  告警、revision 水位推进逻辑不变。
- `scanProjections` 服务解析外提：`projections()` / `projectionCache()` 每扫描解析一次。
- **会话花费增量缓存**（第二组增强）：`fetchSessionSpend` 按 `(sessionId, 事件数)` 键控——
  日志未变命中缓存（同一引用），增长只计新增尾部并合并；与投影单元相同的只追加假设，
  表变更不追溯重计价（同投影路径既有说明）；Map 上限 1024 防无界增长。

**结构 / 健壮性**
- ui-billing `injected` face 一次性构建（函数身份稳定，避免 slot 渲染器重复调用 inject 时
  触发 badge 挂载 effect 重拉）+ `unwrap` 帮助函数收敛三处重复解包。
- `BalanceBadge` 提取 `fetchLine` 帮助函数，消除两处重复微任务链（约 60 行）。
- 根 bundle `files` 补 `README.i18n.yaml`。

**测试与验证**
- 新增 8 用例（折叠等价性 2、mergeTodaySpend 纯性 1、单遍路径等价 1、并发上限 1、增量缓存 3）；
  全套 **91 用例全绿**；build / typecheck / verify 全绿。
- 文档：README.md / README.zh.md 数据更新机制补充增量计价说明，README.i18n.yaml blob hash
  已更新，AGENTS.md 版本号更新为 0.2.3。

### 发布记录（2026-08-28 · 0.2.3）
- **已发布完成**：三个包 0.2.3 均 PUT 成功，registry `dist-tags.latest` 均为 0.2.3
  （@rayadesu/dsh-llm-billing → @rayadesu/dsh-client-ui-billing → @rayadesu/dsh-billing）。
  prepublishOnly（verify-packages.mjs）随发布自动运行并通过。
- 发布方式：npm publish **显式传参** `--//registry.npmjs.org/:_authToken=<TOKEN>`（pnpm publish
  404、NODE_AUTH_TOKEN 不生效的坑照旧）。
- **新增两个坑（本次踩到）**：
  1. `npm publish packages/llm-billing`（带路径参数）会被 npm 的 spec 解析当成 GitHub 仓库简写，
     触发 `git ls-remote ssh://git@github.com/packages/llm-billing.git` 并报 "unknown git error"
     （本机无法连 GitHub:22）。**必须 `cd` 进包目录再 `npm publish`**（根 bundle 在仓库根发布）。
  2. `npm login` 会话 token 不具备发布权限：账户开启 2FA 时 registry 返回
     E403 "Two-factor authentication or granular access token with bypass 2fa enabled is required"。
     **需要 bypass-2FA 的 Granular Access Token（或旧版 Automation token）**，本次由用户提供。
- token 由用户提供，仅用于发布命令，未写入仓库任何文件。

---

## 历史：0.2.2（2026-08-28）

## 目标与进度
- 目标：修复 @rayadesu/dsh-llm-billing 的 TYPERT 清单包名归属错误，恢复独立构建，发布 0.2.2。
- 当前进度：**全部完成**——6 个测试套件全绿（83 用例）；build / typecheck / verify 全绿；三个包
  **0.2.2 已发布到 npm**（@rayadesu/dsh-billing、@rayadesu/dsh-llm-billing、@rayadesu/dsh-client-ui-billing，
  均 PUT 200）；本轮改动已提交 `2ad83ce`。剩余唯一可选步骤：把 0.2.2 装进 DSH profile 验证（用户明确暂不执行）。

## 历史发布记录（0.2.2 · 2026-08-28）
- 发布方式：npm publish（**显式传参** `--//registry.npmjs.org/:_authToken=<TOKEN>`）。
  注意：pnpm publish 会 404（token 读取方式问题），NODE_AUTH_TOKEN 环境变量对 npm publish 也不生效；
  必须用命令行显式传 `--//registry.npmjs.org/:_authToken=`。prepublishOnly（verify-packages.mjs）随发布自动运行并通过。
- token 由用户提供，仅用于发布命令，未写入仓库任何文件。
- registry 验证：三个包最新版本均为 0.2.2。

## 0.2.2 改动（提交 2ad83ce，相对 c7d68cb）
1. **vitest.config.ts 修复**：上一轮提交的配置里正则被写坏（反斜杠丢失、正则拆行）导致 vitest 无法加载；已按 harness 原版（vitest.shared.ts）重写 standardDecoratorPlugin。
2. **typert-protocol 移出 pnpm workspace**：内嵌包只有声明（`export declare`），没有运行时实现，且 `linkWorkspacePackages` 会让它遮蔽 npm 包；现在 `packages:` 只含 llm-billing / ui-billing，`@deepseek-ai/dsh-typert-protocol` 从 npm 解析（lib 带真实 remoteMethods 实现）。typert 生成器不受影响（它按 tsconfig references 注册包，不依赖 pnpm workspace 成员身份）。
3. **ui-billing 客户端测试基础设施**（npm 0.1.1-rc.2 client 栈发布缺陷的完整应对）：
   - `packages/ui-billing/tests/fixtures/renderer-src/client/`：从 harness `dsh-v0.1.1-rc.2` 标签取回 renderer 未发布的 3 个源文件（bind.ts / scoped-slots.tsx / session-provider.tsx），vitest alias 把 `@deepseek-ai/dsh-client-ui-renderer/src/client` 指到本地副本（node_modules 下的 .ts 会被 Node 原生加载器拒绝剥离类型）。
   - `packages/ui-billing/tests/module-loader.setup.ts`：jsdom ModuleLoader 垫片——执行 DSH client bundle 的 factory，导出记录到 `window.__DSH_BUNDLE_EXPORTS__`；`require` 锚定 packages/ui-billing/node_modules；`dsh-client-ui-primitives` 用两个惰性组件桩（其 lib 导入 .module.css，原生 require 会崩）。
   - vitest `server.deps.inline`（正则，字符串模式在 Windows 上因 path.join 反斜杠不匹配）：inline test-runtime（否则其裸导入走原生 Node）与 dsh-client-ui-primitives（CSS 导入）。
   - browser-plugin.client.spec.ts：SlotRegistry 从 **dsh-client-runtime** bundle 导出取（renderer bundle 只有 renderer 面）；locale 插件从 dsh-client-locale bundle 取。
   - ui-billing devDeps 增加：`@deepseek-ai/dsh-client-runtime`（spec 直接导入其 /client）、`use-sync-external-store`（fixture bind.ts 的导入）。
4. **renderer 补丁已移除**：上一轮用 pnpm patch 补 bind.ts 的方案被 fixtures+alias 完全取代（补丁本身无法解决类型剥离拒绝，且 store 重取有坑）；`patches/` 目录与 `pnpm-workspace.yaml` 的 patchedDependencies 已删除，lockfile 已重生成。

## 关键文件清单
- 新增：packages/ui-billing/tests/module-loader.setup.ts、packages/ui-billing/tests/fixtures/renderer-src/client/{bind.ts,scoped-slots.tsx,session-provider.tsx}
- 修改：vitest.config.ts、pnpm-workspace.yaml、packages/ui-billing/package.json、packages/ui-billing/tests/browser-plugin.client.spec.ts、pnpm-lock.yaml、AGENTS.md、HANDOFF.md
- 删除：patches/（renderer 补丁）

## 剩余步骤（用户自行执行，可选）
1. 升级 profile 并验证：`dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`，再 `pnpm dsh web` 验证余额徽标（本机 dsh CLI 在 harness 仓库：`pnpm --dir <harness> dsh`）。

## 注意事项
- 本机 deepseek-harness 源码为 0.1.2-alpha.1（超前于 npm 的 0.1.1-rc.2），插件按 npm 发布线 ^0.1.1-rc.2 构建；运行时 peers 由 dsh 安装回退解析。
- pnpm 11 默认开启 optimistic-repeat-install，`pnpm install --force` 会被短路为 "Already up to date"；需要强制重装时用 `pnpm install --force --optimistic-repeat-install=false`。
- 恢复工作前先 git status 核对，避免与后续改动混淆。
