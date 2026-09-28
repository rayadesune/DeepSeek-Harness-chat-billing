# HANDOFF — 适配官方新安装方式：Web「添加插件」单包名安装（2026-09-24 · 已发布 v0.3.17）

* **发布记录（2026-09-24 · v0.3.17）**：按类型提交 `f706111`（fix(bundle) 组件包改
  dependencies + 安装契约用例）→ `30489c1`（docs 安装文档改 Web 插件页优先）→ `6283728`
  （release: v0.3.17，三包版本对齐 0.3.17），全部已推送 main；本次发布同时覆盖 v0.3.16 之后
  累积的 10 个提交（`d417eef`..`cabb8a4`：切会话分组读取、未计价模型口径、余额重试、
  插件管理元数据、计价引擎拆分等）。tag `v0.3.17` 已推送；GitHub Release：
  <https://github.com/rayadesune/DeepSeek-Harness-chat-billing/releases/tag/v0.3.17>；
  npm 按 llm-billing → ui-billing → dsh-billing 顺序一次发布成功（无 E409），三包
  `dist-tags.latest` 均为 `0.3.17`。发布前全套校验：test 282/282（10 files，含新增安装契约
  用例 3 条）→ build（typert-compat OK）→ verify（client 面 0.3.17 版本戳）全绿。

* 本轮性质：**适配官方新增的安装方式**，不改运行时代码。上游 deepseek-harness 插件页的
  「添加插件」对话框接受**单个 spec**（包名 / GitHub 仓库地址 / 本地目录路径 + 安装源选择）：
  Host 先 `pluginManager.inspect` 要求该包声明 `dsh.bundle.patch`，再 `pnpm add <spec>` 只装这一个包。

* **根因**：本仓库根 bundle 一直把两个插件包声明为 `peerDependencies`，而 DSH profile 模板是
  `nodeLinker: hoisted` + `autoInstallPeers: false`（官方 `app-boot/src/profile.ts`）——peer 根本不会
  被装进 profile，所以旧结构下**单包名安装只装得到 bundle、装不到两个组件行**（行名解析不到）。
  旧文档靠「三个包名一条命令」绕开这一点，对话框一次只能输一个 spec，绕不开。官方多行组合包
  （如 `voice-input-bundle`）的模式是：**组件包声明为普通 `dependencies`**，hoisted 的 profile
  `node_modules` 把传递依赖平铺到根，行名即可解析（`resolveBundleDir` 从 profile 锚点能找到）。

* **改动（全部留在工作区，阶段 A 不提交）**：
  1. 根 `package.json`：`peerDependencies` → `dependencies`（两个包与 `^0.3.16` 区间不变）。
     lockfile 无需变化：本 workspace `autoInstallPeers: true`，两包本来就在根 importer 的
     dependencies 里，`pnpm install` Already up to date、diff 为空。
  2. `cordis.patch.yml`：头部注释改写为新安装说明（单包名 / 对话框 / CLI），命令改单包名。
  3. `AGENTS.md`：bundle 集成段与常用命令改为单包名，写明 dependencies/hoisted/autoInstallPeers
     依据，并补 Web 官方安装路径（侧栏 插件 → 添加插件，包名 / Git 地址 / 本地路径，安装源可选大陆镜像）。
  4. `README.md` / `README.zh.md`：安装章节重写——首选「Web 插件页（官方）」三步（含 GitHub 地址
     `https://github.com/rayadesune/DeepSeek-Harness-chat-billing`、本地目录路径、安装源选择）；
     CLI 改单包名（全局与源码构建两种）；发布龄门槛段保留三钉示例并注明**三个包名都要钉**
     （两个插件包随 bundle 传递安装，不钉会被门槛挡在旧版）；常用命令 add/remove 改单包名，并加
     旧版三包安装的清理脚注（pnpm 只能 remove `package.json` 里列出的依赖，remove 不存在的包名会
     报 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`，实测）；`README.i18n.yaml` 两个 blob hash 已重记。
  5. `.agents/skills/dsh-release/SKILL.md`：阶段 B 版本对齐措辞「根 bundle peerDeps」→
     「根 bundle 的两个插件包依赖区间」（根已无 peerDeps）。

* **校验（一轮跑全）**：`package.json` JSON 解析 ✓；`cordis.patch.yml` / `pnpm-workspace.yaml` /
  `README.i18n.yaml` 经 profile 内 `yaml` 解析 ✓；`pnpm install` Already up to date ✓；
  `pnpm run test` **279/279 全绿（9 files）** ✓；`node scripts/local-install.mjs billing`
  （face none、无需 build）pack → remove → add 全 ok，新 bundle 已装入 web profile ✓。

* **待用户验证（重启 `dsh web` + 硬刷新后）**：①插件页 bundle 卡片正常、两个组件行照常运行；
  ②（可选，完整验证单包名装全）`dsh plugin --profile web remove @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  之后在「添加插件」只输入本地 tarball（`%DSH_HOME%\local-tarballs\rayadesu-dsh-billing-0.3.16.tgz`）
  或仓库目录 → 安装 → 立即启用 → 两个组件行应随 bundle 一起装好并运行（npm 上 0.3.16 的两个插件包
  与本地一致，本轮未动它们）。

* 状态：7 个文件改动未提交（阶段 A）；`.tmp-recover-handoff.mjs`、`.workbuddy/`、`.workbuddy-ai/`
  为既有未跟踪项，非本轮产物。

---

# HANDOFF — 阶段 A 落地验证：locale/icon 元数据 + 切会话卡顿 B/A 方案 + 两处缺口修复（2026-09-24 · 未提交）

* 本轮性质：**验证 + 补两处小修**，不新增方案。验证对象是工作区里已落地的两批改动
  （①locale/icon 声明方案；②「切会话右上角久刷 / 今日Token滞后 / 卡死切模型」的 B/A 方案），
  外加按用户报告补的 skill 文档一句。

* **一、locale/icon 声明（引用会话方案）——落地核对全部通过**：
  1. 6 个 locale JSON（3 包 × en/zh）形状 `{meta:{title,description}}` 非空、文件名合法，`JSON.parse` 9/9（含 3 个 package.json）全过。
  2. 3 个 `icon.svg`：642–648 B（远小于 256 KiB）、48 viewBox、**自包含**（正则初筛的 `https?://` 是 `xmlns` 命名空间误报，
     `href`/`xlink`/外链复筛零命中）、无 DeepSeek 官方 logo。
  3. 三包 package.json：`icon` 字段 ✓；llm/ui `exports` 补 `./locale/*.json` ✓；**根包新增 exports = 上轮确认的三键白名单**
     （`./package.json` / `./locale/*.json` / `./cordis.patch.yml`）✓；三包 `files` 均带 `locale/*.json` + `icon.svg` ✓。
  4. **exports 解析冒烟**（各包目录内自引用 `import.meta.resolve`）：三包 `locale/en|zh.json`、`package.json` 全部解析 OK；
     白名单外 `README.md` 正确报 `ERR_PACKAGE_PATH_NOT_EXPORTED` —— gate 真实生效且恰好覆盖 `readPluginMeta` 所需读取面。
  5. 三对 README 双语已改，`README.i18n.yaml` 6 个哈希与 `git hash-object` 实际值逐一相符。

* **二、切会话卡顿 B/A 方案（本会话上文）——落地核对全部通过**：
  - **B-1 SWR**（`cache.ts`）：非 force + 同日有过期旧值 → 立即返旧值 + 后台扫（rejection 吞掉）；跨日不服务旧值；force 跳过 stale 直接 join/run ✓。
  - **B-3**：`cachedAt` 改为扫描**完成**时刻（`run()` 的 then 回填），修掉「扫得慢即过期→连扫」 ✓。
  - **B-2 让出**：`yieldToEventLoop()`（setImmediate）+ `SCAN_YIELD_SESSIONS=8`，`today-spend.ts` 四处折叠/采纳循环均接入 ✓。
  - **A 解绑**（`useBillingData.ts`）：拆会话级/账号级两组 effect + `sessionBusy`/`accountBusy` 双旗标，
    切会话只跑会话级；`refreshing = sessionBusy || accountBusy` ✓。

* **三、验证中发现的两处偏差 → 已修（用户侧修复，本轮复查确认）**：
  1. **turn-settle 未走 force**（(b) 决策缺口）→ 现为 `getTodaySpend(true)` / `getTodaySessionsSpend(true)`
     （`useBillingData.ts:318/320`，行内注释写明取舍：turn 刚定价自身 revision，force 只重读变化日志，revision 门控下代价可控）。
     「一轮结束拿到准数」恢复成立；force 的阻塞不驱动转圈（turn-settle 不 set busy），B-2 让出后也不卡 GUI。
  2. **面板打开护栏未做** → 现为面板 effect 同时拉 `getTodaySpend()` + `getTodaySessionsSpend()`
     （`useBillingData.ts:243/244`，deps 已补 `getTodaySpend`）。「跑完最后一轮后闲置、面板今日行停在旧值」的场景被覆盖。

* **四、校验（一轮跑全）**：`pnpm run build` EXIT 0（host+client+typert-compat OK）→ `pnpm run test`
  **277/277 全绿**（9 files；修复后受影响的 `balance-badge.client.spec.tsx` 单独复跑 **66/66**，较此前 64 多 2 条为本轮行为补的用例）
  → `pnpm run verify` OK。警告均为既有噪声（React jsx / source-map / MODULE_TYPELESS）。

* **五、skill 文档补丁**：`.agents/skills/dsh-release/SKILL.md` 阶段 A 第 3 步 EBUSY 手动路径段补入——
  **`npm pack --pack-destination` 必须给 Windows 风格路径（`C:/...`），MSYS 风格 `/c/...` 会让 npm 直接报错**；
  PowerShell 用 `$env:DSH_HOME\local-tarballs` 展开即合法。

* **已知残留（均窄、不阻塞，沿用既有记录）**：
  - force 可能 join 一个早于本轮 turn 结束启动的在途扫描，极端时序返回轮前数据，下一轮 settle 自然纠正（B-1「已知边角」）。
  - 面板打开用普通读（SWR）：恰逢扫描进行中开面板那一帧可能旧；彻底封死可将 `useBillingData.ts:243` 也改 `true`
    （面板读不驱动转圈，阻塞无感）——可选打磨，与决策文档记录的护栏措辞一致，不判为缺口。

* **待用户验证（重启 `dsh web` + 硬刷新后）**：①插件管理页卡片/两组件行显示中英文标题、描述、图标，中英切换生效；
  ②连续快速切会话右上角不长转、今日 Token 即时显示；③冷扫期间切模型/新增会话即时响应；
  ④跑完一轮后今日行立即更新（turn-settle force）、闲置开面板也是新值（面板护栏）。

* 状态：全部改动仍在工作区**未提交**（阶段 A）；另有 `.workbuddy/`、`.workbuddy-ai/` 两个未跟踪目录非本方案产物，阶段 B 归拢时注意勿混入。

* 待用户验证（重启 `dsh web` 后）：①正常对话的行尾花费与今日花费恢复；②换成未收录模型时应出现「未计价用量：<model>」行，而不是一个 ¥0；③面板文案能区分「没用量」和「有量但没费率」两种空态。
