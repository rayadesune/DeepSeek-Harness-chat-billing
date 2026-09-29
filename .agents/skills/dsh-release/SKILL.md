---
name: dsh-release
description: 按 DeepSeek Harness 官方 GitHub Release 格式发布 @rayadesu 计费插件的 npm 包与 GitHub Release；默认改完代码**先不提交**、构建后用本地 tarball（`scripts/local-install.mjs all`，三包一次 add）装进 profile 交用户重启验证，用户明确说「发布」后才把工作区改动按类型分别提交、推送、发 npm 与 release；阶段 A 的校验按改动档位最小化（省 token）
---

# DSH 格式发布流程（DeepSeek-Harness-chat-billing）

三包统一版本（`@rayadesu/dsh-billing` 根 bundle + `@rayadesu/dsh-llm-billing` + `@rayadesu/dsh-client-ui-billing`）。**分发只有 npm 一条路**：github 仓库地址与本地目录在多包下装不全（见 AGENTS.md「多包分发只有 npm 与 tarball」），tarball 仅用于阶段 A 的本地验证。

## 两阶段铁律

| 阶段 | 触发 | 核心动作 | 提交 / 推送 / 发布 |
| --- | --- | --- | --- |
| A | 改完代码（默认） | 按档校验 → **本地 tarball 安装** → 交用户重启验证 | 全不做 |
| B | 用户明确说「发布」 | bump → 三连校验 → 按类型提交 → npm → tag+release | 全做 |

- **阶段 A 全程不 `git add` / `commit` / `stash` / `reset`**，绝不推送、打 tag、发 npm/GitHub。用户反复提改动都累积在同一份未提交工作区里，阶段 B 一次归拢成清晰提交。

## 成本纪律（省 token，硬约束）

**一轮 token ≈ 请求数 × 当时上下文。** 请求数 ≈ 这一轮里「带工具调用的助手消息」条数（同一条里发多个工具调用只算一轮）；实测 99%+ 是输入重放，输出只占 0.1%——要降的是「请求数 × 上下文」，不是回复长度。

| 档位 | 预算（≈ 工具往返轮数） | 典型构成 |
| --- | --- | --- |
| 轻量 | **≤ 8** | 定位 1–2 + 改动 1–2 + 受影响用例 1 + 安装 1 + 文档 1–2 |
| 常规 | **≤ 12** | 轻量 + 官方规则核实 1–2 + 二次用例 1 |
| 完整 | **≤ 20** | 含 `test`/`build`/`verify` 三连与提交分组 |

超预算就**停下合并步骤**：能一条命令跑完的不拆三条；互不依赖的读/查/改塞进同一条消息一次发完。

### 改动定档

判断依据是**产物会不会变**：只改注释或文档不必重装；行为或类型变了才 build + 重装。**全套 `test`/`build`/`verify` 一轮只跑一次**（收尾交用户前，或阶段 B）。

| 档位 | 典型改动 | 必跑校验 | 安装 |
| --- | --- | --- | --- |
| 轻量 | 文案、locale 键、CSS、注释、单点样式 | 只跑受影响 spec（`pnpm exec vitest run <spec>`） | `local-install.mjs all`（`all` 已含 build） |
| 常规 | 单包源码逻辑 | 该包 spec + `local-install.mjs all` | 同上 |
| 完整 | 跨包语义、宿主计价/投影、依赖或版本 | `pnpm run test` → `build` → `verify` | 同上 |

- **构建顺序硬约束**：`ui-billing` 的 client 面依赖 host 面 tsdown 生成的 `lib/typert.remote-client.d.ts`。动了 Remote 类型或 typert 产物**必须先 `build:host`**；干净 checkout 也必须 host → client（`pnpm run build` 已封装，CI 同）。

### 操作纪律

- **工具输出只留尾巴**（会永久留在上下文并逐轮重放）：

  ```sh
  pnpm run test 2>&1 | Select-String -Pattern "Tests |Test Files|FAIL"
  git diff -U0 <file>          # 先 git diff --stat 定规模，看差异用 0 行上下文
  ```
- 宽 grep 配 `include`/路径收窄 + `Select-Object -First N`；大文件按 `offset`/`limit` 精读。**巨型单行文件**（README 面板段落 8–10K 字符一行，切不开）用一条 `node -e` 定点替换（只回 `ok`/`BAD`），别整段 read。先 grep 拿行号 → read 只取 20–40 行；不为「确认一下」重复取数。
- 同一文件多处改动合并成少数几次 `edit`，锚点取**最短唯一串**。
- **会话卫生**：与本会话已完成工作无关的微调建议用户新开会话（便宜 20–50 倍）；用户选择继续就按轻量档。
- **会话成本诊断**：`node .agents/skills/dsh-release/session-cost.mjs [sessionId]`（按轮列出请求数/token；id 缺省取 `$DSH_SESSION_ID`）。

## 阶段 A — 改动 + 本地 tarball 安装（默认执行，不提交）

1. **改代码**（`packages/*/src`、`tests/`），按上表定档决定跑什么。
2. **按档校验**：轻量/常规先跑受影响 spec；**交用户前必跑一次全套 `pnpm run test`（须全绿）**。新增/调整行为必须补用例。
3. **构建 + 安装**一条命令：

   ```sh
   node scripts/local-install.mjs all --check <改动marker>
   ```

   它按序做：`pnpm run build`（`all` 默认 both 面）→ 三包 `npm pack` 到 `$DSH_HOME/local-tarballs` → **三包一次 `add`** → 逐包统计 marker 并判定。成功只印 6 行，失败印该步尾巴。`--harness <dir>` 覆盖 DSH CLI 位置（默认 `$DSH_HARNESS_DIR`、同级 checkout、PATH 上的 `dsh`）。

   - **为什么是 tarball 而不是本地目录**：`pnpm add <目录>` 出来是 `link:`，而 pnpm **不装被链接包的依赖** —— 只给根目录时两个组件包根本不落 `node_modules`，启动报 `2 entries did not activate llm-billing … failed to import`。tarball 是**真实安装**，pnpm 解包后照常解析 `dependencies`，所以三包都到位；解包出来的是**构建产物**，marker 检查读的就是 profile 里那份真代码。
   - **三个 tarball 必须一次 `add`**：根 bundle 的组件依赖是 registry 区间（`^0.3.x`），单独重装根包会从 npm 解析组件包，工作区代码静默不进 profile。
   - 命令可重复跑，不叠加；profile 的 `cordis.patch.yml` 不被改动（插件行由 bundle 自带的 `dsh.bundle.patch` 挂载）。
   - **装后核对**（脚本已打印）：三条依赖指向 `file:...local-tarballs\*.tgz`，`node_modules\@rayadesu\<pkg>` 是**真实目录**（不是 link），marker 至少一处 >0。地面真相：`$DSH_HOME/profiles/web/node_modules/@rayadesu/dsh-client-ui-billing/lib/client.js`。
   - **桌面版（`desktop` profile）要加 `--unpack`**：该 profile 由 Electron 独占，CLI 直接拒（`profile "desktop" is managed exclusively by the Electron application`）。`--unpack` 不走 pnpm，而是把同一批 tarball 解到 `<profile>/node_modules/<name>`，manifest 不动——所以**桌面版的插件页下一次安装会把这些文件换回 registry 版本**，它只当本机验证用：

     ```sh
     node scripts/local-install.mjs all --profile desktop --unpack --check <marker>
     ```
4. **交给用户**：「重启 `dsh web` 并硬刷新验证」，列出本轮应验证的行为点 + 按哪档做的校验。
   - **改静态元数据（icon/locale）必须整页刷新**：插件页卡片列表缓存在前端 store（`ensure()` 只在 `status==='idle'` 时加载），**切到插件页签不会重新拉取**，用户常回「怎么没变」；仍旧就再重启一次。
5. **文档与 hash**：受影响包 README 双语（EN/ZH）+ `README.i18n.yaml` blob hash（`git hash-object`）+ `AGENTS.md`。同批微调攒到定稿一次补，**交用户前必须补齐**。
6. **提交留给阶段 B**：只 `git status --short` + `git diff --stat` 看一眼清单，**不要 commit**；等用户说「发布」或提新改动。

### 本机注意（2026-09-30 实测）

- **`pnpm install` 要显式关发布龄门槛**：`--config.minimumReleaseAge=0`（本仓库 `pnpm-workspace.yaml` 已设；profile 里的 `pnpm-workspace.yaml` 不认这条）。否则刚发布的版本解析不到，会静默回落到旧版。
- 日志里 `React.jsx: type is invalid` 与 `Failed to load source map for …dsh-client-ui-primitives` 是既有噪声；合格线是 **`Tests` 全绿 + `verify` OK**（用例总数随轮次增长，别写死数字）。
- 桌面版 profile 由 Electron **独占**，CLI 写不了（`profile "desktop" is managed exclusively by the Electron application`）——装它用上面第 3 步的 `--unpack`；日常验证仍优先 `dsh web`。

## 阶段 B — 发布（用户说「发布」时）

1. **版本对齐**：三包 `package.json` bump 到下一版本（根 bundle 的 `^0.3.x` 组件依赖区间、ui-billing peer/dev 的 `^0.3.x` 同步）；`AGENTS.md` 版本行；`pnpm install` 刷 `pnpm-lock.yaml`。这份改动**先留工作区**，作为最后的 `release:` 提交。
2. `pnpm run test` → `pnpm run build` → `pnpm run verify`（失败禁止发布）。**这是唯一必须跑全套的位置**。
3. **按类型分别提交**（不要 `git add -A` 一把梭）：
   - `git status --short` + `git diff` 按**意图**分组，逐组 `git add <paths>` → `git commit`。
   - 类型惯例：`feat:` / `fix:` / `perf:` / `refactor:` / `style:`（纯视觉与文案排版）/ `docs:`（README、`README.i18n.yaml`、`AGENTS.md`）/ `chore:`（构建脚本、依赖、CI）。**用例跟着它覆盖的代码走**；同文件混意图用 `git add -p`，分不动就按主要意图归类。
   - **`lib/` 构建产物随源码一起提交**（它已入库）：改完源码必须重跑 `pnpm run build` 并提交重新生成的 `lib/`，否则 git 安装/发布拿到的是旧产物。
   - 提交信息中文、沿用仓库既有风格（可带范围前缀如 `fix(billing):`），正文按「问题 → 根因 → 改动」写清根因/取舍。
   - **顺序**：代码类 → `docs:` → `release: vX.Y.Z`（版本对齐单独成条）。用户反复试错时只写**最终形态**（阶段 A 没提交，中间过程本来就不在历史里）。
4. **推送**：`git push origin main`。若还有旧流程留下的未推送本地提交，一并推送；需重整先 `git reset --soft origin/main` 退回工作区再按第 3 步分组。
5. **npm 发布**（顺序固定：`llm-billing` → `ui-billing` → `dsh-billing`，根 bundle 最后，因为它声明对前两者的依赖）：

   ```sh
   cd packages/llm-billing && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../ui-billing       && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../../              && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   ```

   - token 由用户提供，**仅内联传参，绝不写入文件/仓库**；必须 `cd` 进包目录（带路径参数的 `npm publish packages/xx` 会被当成 GitHub 仓库简写）。
   - **`E409 Cannot publish over previously staged version "<ver>"` 不是失败**：三包都会先报，版本随后**延迟 20–30 秒落库**（v0.3.16 实测）。不要改版本重发；等约 30 秒 `npm view <pkg> dist-tags.latest` 复核，再 `npm pack <pkg>@<ver>` 抽一处 marker 确认内容带本轮改动。
   - `prepublishOnly`（verify-packages.mjs）自动运行，失败即中止；`dsh-client-ui-billing` 偶发 "being processed"，等约 3 分钟复核。
6. **tag + GitHub Release**：

   ```sh
   git tag v<ver> && git push origin v<ver>
   gh release create v<ver> --title "v<ver>" --notes-file <正文文件>
   ```

   标题 = 裸版本号 `v<ver>`。**正文先写成文件再 `--notes-file`**——`--notes` 内联在 PowerShell 里会吃掉反引号，且 `` `e ``/`` `t ``/`` `f `` 会被解释成 ESC/Tab/分页控制字符（曾出乱码事故）。

   ```markdown
   [中文](#cn-v<ver>) | [English](#en-v<ver>)

   <h3 id="cn-v<ver>">新增功能</h3>

   * <要点> @rayadesune

   <h3>体验优化</h3>

   * <要点> @rayadesune

   <h3>问题修复</h3>

   * <要点> @rayadesune

   <h3>其他变更</h3>

   * <要点> @rayadesune

   ---

   <h3 id="en-v<ver>">New Features</h3>

   * <point> by @rayadesune

   <h3>Improvements</h3>

   * <point> by @rayadesune

   <h3>Bug Fixes</h3>

   * <point> by @rayadesune

   <h3>Chores</h3>

   * <point> by @rayadesune

   ---

   Full Changelog: https://github.com/rayadesune/DeepSeek-Harness-chat-billing/compare/v<prev>...v<ver>
   ```

   **格式规则**（对照 deepseek-ai/deepseek-harness 全部 8 个官方版本逐一核对）：

   - 语言切换行 `[中文](#cn-v<ver>) | [English](#en-v<ver>)`；分组固定四类、顺序固定：中文「新增功能 / 体验优化 / 问题修复 / 其他变更」↔ 英文「New Features / Improvements / Bug Fixes / Chores」。
   - **只写有内容的分组——空组整个省略**，不写「无 / None」占位。
   - 中文段第一个 h3 带 `id="cn-v<ver>"`、英文段 `id="en-v<ver>"`，其余裸标签；h3 一律 HTML 标签（不是 `###`）。
   - 条目 `* ` 开头，中文 ` @作者` 结尾、英文 ` by @作者` 结尾（本仓库作者 = @rayadesune；早期初始提交 = @WilliamLIiii）；中英段之间、changelog 之前用 `---`。
   - `Full Changelog` 用上一个 tag 的 compare 链接；**首个版本没有上一个 tag，用 `https://github.com/<owner>/<repo>/commits/v<ver>`**；合并发布时把跳过的版本内容并进本次对应分组。
   - 正文逐条对照 `git log v<prev>..v<ver>`，别漏（尤其阶段 A 累积的多轮改动）。
7. **收尾核对**：`git status` 干净、origin/main 与 tag 均已推送；三包 `dist-tags.latest` = 新版本；`gh release list` 标题为裸版本号；`gh release view v<ver>` 抽查正文无乱码。
8. **切回 npm 源**（要切回时给一条命令；用户想保留本地验证的 tarball 引用就不动 profile）：

   ```sh
   dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
   ```

   **三名必须齐给**：残留的 `file:...local-tarballs\*.tgz` 条目若不被覆盖，会盖过 bundle 从 registry 解析的组件包，静默用回本地 tarball 里那版代码。

## 改图标硬规则

- **透明底**：别把 `#151517` 之类底色 `<rect>` 烤进 SVG——深色模式看不出来，切浅色就是一块黑方；条目那 62px 圆角方块由插件页自己画。
- **尺寸按官方条目实测量，别凭感觉**：官方字形只有 21–26px；量 bbox 时 **x 窗口避开条目右侧的彩色「实验性」徽章**，否则 bbox 撑到 46px、做出来大 1.6 倍（踩过两次）。
- **别盲写**：先用脚本量参考图的几何比例与取色，按比例生成 3–4 个候选、渲成一张对比 PNG 用 Read 看图挑版；用户常追加硬约束（尺寸不要改 / 不要某元素 / 配色沿用），定稿前先确认这些边界。
- **手绘带笔锋的图形别用等宽描边复刻**：单三次曲线族钉死尖端/腰线宽后无自由度，残差 2–3% 会从「细针」变「胖臂罗盘」（IoU 0.42）。改用实测带状路径：射线采样每 2.5° 的 [内沿, 外沿]、3 点滑动平均去噪、串成闭合环，`transform="rotate(90/180/270 cx cy)"` 复制四份（**禁 `<use href>`**——图标自包含约束）。判定用 **IoU + 每径向环带的墨量**，只看包络对线宽不敏感，会滑向「细线粗路径」的退化解。
- **「显小」量墨量不量 bbox**：空心图形的视觉分量在墨量（官方条目 bbox 21–28px、描边中位数 5–7px）。笔画提亮 1.5–1.8× 时**向内外各扩一半保持外沿**（`r = D/2 - stroke/2`）；多环图形加粗上限由环间距锁死；**同一套比例不能搬到更小档位**——14px 下双环全亚像素，降级成单环 + 实心星。
- **判用户截像是哪一版别靠肉眼**：裁出方块，`resvg-js` 渲染候选 + `pngjs` 算平均像素差，差值明显小者即当前生效版本。

## 约定速查

- **版本号**：三包 + 根 bundle 统一（`AGENTS.md` 版本行、根 `package.json`、两子包 `version` 与 `^0.3.x` peer 同步）。
- **npm 发布顺序**：`llm-billing` → `ui-billing` → `dsh-billing`。
- **构建顺序**：`build:host` → `build:client`（动了 typert 产物必须先 host）。
- **E409 不是失败**：等 20–30 秒延迟落库，复核 `dist-tags`。
- **分发只有 npm**：github / 本地目录在多包下装不全，不作为安装方式对外承诺。
- **本地安装（阶段 A）**：`node scripts/local-install.mjs all --check <marker>`（build → 三包 pack → 三包一次 add → 核对 marker）→ 用户重启 `dsh web` 硬刷新；改静态元数据还须整页刷新。
