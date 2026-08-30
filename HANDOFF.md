# HANDOFF — billing 插件 0.3.5（行尾静态「¥金额」· 2026-08-29 方案已定，待实施）

## 需求（用户审核通过的最终版）

- **背景**：DSH 0.1.2-alpha.2 把本轮 token 用量（🗄用量 / ⏱耗时 pills）重排到分支按钮之后
  （`MessageIconActions` 的 `usageAction` prop，硬编码非 slot）；插件的「本轮花费」目前注册在
  `conversation.chat.assistant-actions`（渲染在 copy ↔ branch 之间），靠 CSS `order:-1` 显示在 copy 前。
- **目标**：改成**行尾静态文本** `¥金额`——位于 **时钟之后（整行最后一格）**；不可点击、
  不弹卡片、无图标、无「花费」文字；字体样式**逐项复刻 DSH 时钟文本**（`.timeEnd`）。
- **已确认决策**（与用户逐轮敲定，勿再更改）：
  1. **不改 DSH 源码**（用户不懂 DSH 源码、明确选纯 CSS 路线；DSH 侧不动 = 无重建 DSH 需求）。
  2. 位置实现只用一条 CSS：`.cost { order: 1 }`（视觉排到所有 order-0 兄弟之后 = 时钟后 / 行末）。
     **不需要 `:global` 规则**（上一版给时钟 `order:2` 的结构选择器已废弃——目标改为"时钟之后"
     后，纯 order 排序即自然命中，且 `:last-child` 脆弱性消除）。
  3. 「未缓存输入 / 缓存读取 / 输出」**分项计价卡**方案废弃；host（llm-billing）
     **零改动**——只需总额，`DeepSeekTurnSpend` 保持 `{ total }`。
  4. 不做「点击展开卡片」：不新增 `@deepseek-ai/dsh-client-ui-primitives` peer 依赖。
  5. 零花费 / 抓取失败仍隐藏；`cachedTurnCost`（session+message 键控）保留。

## 实现清单（待执行，均为插件仓库内）

1. `packages/ui-billing/src/client/TurnCostAction.tsx`：重写为单个
   `<span data-turn-cost>¥{formatSpend(total)}</span>` —— 删掉按钮语义 / aria / 锚定 / portal；
   保留 `formatSpend`（¥ + 4 位小数去尾零：`¥0.0123` / `¥8.5`）与缓存逻辑。
2. `packages/ui-billing/src/client/TurnCostAction.module.css`：重写为 `.timeEnd` 复刻 +
   `order: 1`：`font-size: var(--dsh-content-font-size-secondary, 13px)`、
   `line-height: calc(24px + var(--dsh-content-font-delta, 0px))`、
   `color: var(--dsw-alias-label-tertiary)`、`white-space: nowrap`；删除旧的 `order:-1`、
   `margin-left: 6px`、图标 / 分隔线 / 卡片皮肤；沿用「zero 不发标」约定
   （组件内部 `cost === null || cost.total <= 0` 返回 null，CSS 无需 display 分支）。
3. `packages/ui-billing/src/client/locales.ts`：删除不再使用的 `turnCost.label`（zh/en 同步删，
   `BillingKey` 自动收缩）。
4. `packages/ui-billing/src/client/index.ts`：注册仍走 `conversation.chat.assistant-actions`
   （同 slot 名，wiring 不变），只更新注释说明「视觉靠 order:1 排到行末、DOM 仍在 copy↔branch 之间」。
5. 测试：新增/更新 TurnCostAction 断言——渲染 `¥金额`、`data-turn-cost`、零花费隐藏、
   失败隐藏；`DeepSeekTurnSpend` fixture 形状不变（host 零改动）。
6. 版本 0.3.4 → **0.3.5**：根 `package.json` + `packages/llm-billing/package.json` +
   `packages/ui-billing/package.json`（bundle peerDeps `^0.3.5`、ui-billing peer/dev 同步）。
7. 文档：AGENTS.md 版本号同步 0.3.5；README（EN/ZH）按 AGENTS.md 更新本轮行为描述，
   `README.i18n.yaml` blob hash 重算。
8. `pnpm run build` + `pnpm run test` + `pnpm run verify` 全绿后，
   npm 顺序发布 llm-billing → ui-billing → dsh-billing（沿用 0.3.4 的 bypass-2FA token 流程；
   若用户只要求本地，则 `npm pack` 三包 → `dsh plugin --profile web add <三个 tgz>`）。

## 技术背景（执行者必读）

- `MessageIconActions` 渲染序（`packages/.../ui-chat/src/client/chat/MessageIconActions.tsx`）：
  `copy → {extraActions}（assistant-actions 槽，插件在此）→ branch → {usageAction}（🗄⏱ 硬编码）→ clock`；
  容器 `display:flex; gap:8px`，除插件外全部兄弟默认 `order:0`（已验证 ui-message-feedback 与
  TurnUsagePanel 的 CSS 均无 order）。
- **DOM 与视觉分离的机理**：`order` 只改渲染位置不改 DOM 树；Tab/读屏跟随 DOM。
  本方案因目标元素是**纯文本 span（不可聚焦）**，Tab 焦点流 = copy → 分支 → 🗄 → ⏱ → 时钟
  （与视觉顺序一致），无焦点缺陷；仅屏幕阅读器朗读次序中金额出现在「复制」之后，影响可忽略
  （已与用户确认接受）。
- DSH 用量卡三行口径（已查证）：未缓存输入 = `uncachedInputTokens`（不含写入；DeepSeek API
  根本没有独立缓存写入桶，`cacheWriteTokens` 是给 Anthropic 类 provider 预留的可选字段，
  DeepSeek 适配器 `mapUsage` 从不填它）→ 所以费用天然只有三桶，行和 = 总额恒等，无需分项。
- 主题变量：`.timeEnd` 用的都是 `--dsh-*` / `--dsw-*` 变量，逐字复刻即可，勿写死值；
  行内 `gap: 8px` 已把金额与时钟间距拉开，无需额外 margin；行整体 `margin-left:-6px` 偏移
  只影响行首，与行尾文本无关。
- hover 显隐：`[data-actions-reveal='hover'] .actions` 行级 opacity 规则，金额与时钟同进退，
  无需单独处理。

## 验证清单

1. 视觉：金额位于时钟之后、行末；13px secondary / tertiary / nowrap 与时钟文本一致；
   无图标、无「花费」字样；hover/focus-within 展示行为与时钟相同。
2. 行为：点击无反应（非按钮）；零花费与 Remote 失败时整格消失；
   长金额（如 ¥123.4567）在窄视口不破坏行布局（nowrap + 行末弹性，必要时随行裁切）。
3. 全套单测 / build / verify 全绿；`dsh web` 刷新或重装 profile 后生效。

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

- **已提交并推送**：`b64aa8c`（rebase 于远端 `8e00a08` 之上；远端 4 条提交——v0.3.2 发布与截图
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
  均 PUT 200）；本轮改动已提交 `58be982`。剩余唯一可选步骤：把 0.2.2 装进 DSH profile 验证（用户明确暂不执行）。

## 历史发布记录（0.2.2 · 2026-08-28）
- 发布方式：npm publish（**显式传参** `--//registry.npmjs.org/:_authToken=<TOKEN>`）。
  注意：pnpm publish 会 404（token 读取方式问题），NODE_AUTH_TOKEN 环境变量对 npm publish 也不生效；
  必须用命令行显式传 `--//registry.npmjs.org/:_authToken=`。prepublishOnly（verify-packages.mjs）随发布自动运行并通过。
- token 由用户提供，仅用于发布命令，未写入仓库任何文件。
- registry 验证：三个包最新版本均为 0.2.2。

## 0.2.2 改动（提交 58be982，相对 0ed0a37）
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
