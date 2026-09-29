---
name: dsh-release
description: 按 DeepSeek Harness 官方 GitHub Release 格式发布 @rayadesu 计费插件的 npm 包与 GitHub Release；默认改完代码**先不提交**、构建后用官方本地目录方式（三个目录一次给全）装进 profile 交用户重启验证，用户明确说「发布」后才把工作区改动按类型分别提交、推送、发 npm 与 release；阶段 A 的校验按改动档位最小化（省 token）
whenToUse: 修改 DeepSeek-Harness-chat-billing 后需要本地安装验证、或用户要求发布新版本时
user-invocable: true
---

# DSH 格式发布流程（DeepSeek-Harness-chat-billing）

三包统一版本（`@rayadesu/dsh-billing` 根 bundle + `@rayadesu/dsh-llm-billing` + `@rayadesu/dsh-client-ui-billing`）+ npm 顺序发布 + GitHub Release 按 DSH 官方格式。

## 目录

- [两阶段铁律](#两阶段铁律)
- [成本纪律（省 token，硬约束）](#成本纪律省-token硬约束)
- [阶段 A — 改动 + 本地目录安装](#阶段-a--改动--本地目录安装默认执行不提交)
- [阶段 B — 发布（用户说「发布」时）](#阶段-b--发布用户说发布时)
- [改图标硬规则](#改图标硬规则)
- [约定速查](#约定速查)

## 两阶段铁律

| 阶段 | 触发 | 核心动作 | 提交 / 推送 / 发布 |
| --- | --- | --- | --- |
| A | 改完代码（默认） | 按档校验 → **本地目录安装** → 交用户重启验证 | 全不做 |
| B | 用户明确说「发布」 | bump → 三连校验 → 按类型提交 → npm → tag+release | 全做 |

- **阶段 A 全程不 `git add` / `commit` / `stash` / `reset`**，绝不推送、打 tag、发 npm/GitHub（除非用户明确要求整理提交历史）。用户反复提改动（截图反馈、样式微调、来回撤回）都累积在同一份未提交工作区里，阶段 B 一次归拢成清晰提交——中间试错天然不留痕。

## 成本纪律（省 token，硬约束）

**一轮 token ≈ 请求数 × 当时上下文。** 一次模型请求 = 重放整段上下文；请求数 ≈ 这一轮里「带工具调用的助手消息」条数（同一条消息里发多个工具调用只算一轮）。实测 99%+ 的 token 是输入重放（多按 cache-read 计价），输出通常只占 0.1%——**降成本降的是「请求数 × 上下文」，不是压缩回复长度**（本仓库实测：511K 上下文的会话一轮 52 次请求 ≈ 25.9M token，输出只占 0.09%；同样的活在空会话里只需 0.3–1M）。

### 每轮请求预算

| 档位 | 预算（≈ 工具往返轮数） | 典型构成 |
| --- | --- | --- |
| 轻量 | **≤ 8** | 定位 1–2 + 改动 1–2 + 受影响用例 1 + 安装 1 + 文档 1–2 |
| 常规 | **≤ 12** | 轻量 + 官方规则核实 1–2 + 二次用例 1 |
| 完整 | **≤ 20** | 含 `test`/`build`/`verify` 三连与提交分组 |

超预算就**停下合并步骤**：能一条命令跑完的不拆三条；互不依赖的读 / 查 / 改塞进同一条消息一次发完。

### 改动定档

判断依据是**产物会不会变**：只改注释或文档不必重装；行为或类型变了才要 build + 重装。**全套 `test`/`build`/`verify` 一轮只跑一次**（收尾交用户前，或阶段 B），别每改一处跑一遍。

| 档位 | 典型改动 | 必跑校验 | 安装 |
| --- | --- | --- | --- |
| 轻量 | 文案、locale 键、CSS、注释、单点样式 | 只跑受影响 spec（`pnpm exec vitest run <spec>`） | link 直通工作区，build 后重启即生效；改到逻辑才重装 |
| 常规 | 单包源码逻辑 | 该包 spec + `pnpm run build:host` / `build:client` | 重跑本地目录安装 |
| 完整 | 跨包语义、宿主计价 / 投影、依赖或版本 | `pnpm run test` → `pnpm run build` → `pnpm run verify` | 同上 |

- **构建顺序硬约束**：`ui-billing` 的 client 面依赖 host 面 tsdown 生成的 `lib/typert.remote-client.d.ts`。动了 Remote 类型或 typert 产物**必须先 `pnpm run build:host`**；干净 checkout 也必须 host → client（`pnpm run build` 已按此封装，CI 同）。

### 操作纪律

- **工具输出只留尾巴**（输出会永久留在上下文、之后每轮重放）：

  ```sh
  pnpm run test 2>&1 | Select-String -Pattern "Tests |Test Files|FAIL"
  pnpm run build 2>&1 | Select-String -Pattern "Build complete|error"
  git diff -U0 <file>          # 先 git diff --stat 定规模，看差异用 0 行上下文
  ```
- 宽 grep 配 `include`/路径收窄 + `Select-Object -First N`；大文件按 `offset`/`limit` 精读。**巨型单行文件**（README 面板段落是 8–10K 字符一行，`offset`/`limit` 切不开）用一条 `node -e` 脚本定点替换（只回 `ok`/`BAD`），别整段 read——便宜一个数量级。先 grep 拿行号 → read 只取 20–40 行；不为「确认一下」重复取数。
- 同一文件多处改动合并成少数几次 `edit`，锚点取**最短唯一串**，别把整段文本抄进 `old_string`/`new_string`。
- **会话卫生**：与本会话已完成工作无关的微调（尤其隔了几轮），建议用户新开会话再做——同样的活便宜 20–50 倍；用户选择继续就按轻量档，并在回复末尾说明「本轮按轻量档」。
- **会话成本诊断**：`node .agents/skills/dsh-release/session-cost.mjs [sessionId]`（按轮列出请求数/token，定位把成本顶上去的轮次；id 缺省取 `$DSH_SESSION_ID`）。

## 阶段 A — 改动 + 本地目录安装（默认执行，不提交）

1. **改代码**（`packages/*/src`、`tests/`），按上表定档决定跑什么。
2. **按档校验**：轻量/常规先跑受影响 spec；**交用户前必跑一次全套 `pnpm run test`（须全绿）**。新增/调整行为必须补用例。
3. **构建 + 安装**：`lib/` 是 gitignore 的构建产物而 link 直通工作区，所以**改完先 build**（按档 `pnpm run build` / `build:host` / `build:client`），再用**官方本地目录方式**装进 profile：

   ```sh
   node <DSH>/apps/cli/lib/bin.js plugin --profile web add <REPO> <REPO>\packages\llm-billing <REPO>\packages\ui-billing
   ```

   `<DSH>` = DSH checkout（本机 `C:/Users/admin/Desktop/me/code/deepseek-harness`；PATH 上有 `dsh` 时直接 `dsh plugin --profile web add …` 同效），`<REPO>` = 本仓库根绝对路径（即 `@rayadesu/dsh-billing`）。

   - **三个目录必须一次给全。** 本地目录装出来是 `link:` 依赖，**pnpm 不装所链包的依赖**：只给根目录时两个组件包根本不落 `node_modules`，Web 启动报 `dsh: warning: 2 entries did not activate llm-billing … failed to import`（2026-09-29 实测）。组件包的运行时依赖（`@deepseek-ai/schemastery`、`zod`）与全部 peer 都由 profile 根已有安装提供，link 即可。
   - 命令可重复跑：同名依赖被**覆盖替换**（上一轮的 `file:`/`link:` 条目一并改写），不叠加；profile 的 `cordis.patch.yml` 不被它改动（插件行由 bundle 自带的 `dsh.bundle.patch` 挂载）。
   - **装后核对**（一条命令，期望三条 `link:` 指向本仓库 + marker >0）：

     ```pwsh
     $p="$env:USERPROFILE\.dsh\profiles\web"
     (Get-Content "$p\package.json" -Raw|ConvertFrom-Json).dependencies.PSObject.Properties|? Name -like '*rayadesu*'
     (Select-String "$p\node_modules\@rayadesu\dsh-client-ui-billing\lib\client.js" -Pattern '<改动marker>' -SimpleMatch|Measure-Object).Count
     ```

   - 旧 tarball 流程（`scripts/local-install.mjs`：pack + remove/add、`--check` 抽查）**不再使用**，脚本留在仓库备查；随之作废的还有一整套 file: 专属坑——按路径缓存的 integrity、overrides 钉版、tarball 换名、字节比对、`--pack-destination` 盘符、`add` 尾部报错不写回 package.json、EBUSY 兜底——遇到一律按本地目录方式重装解决。
4. **交给用户**：「重启 `dsh web` 并硬刷新验证」，列出本轮应验证的行为点（改了什么、该看到什么）+ 按哪档做的校验。
   - **改静态元数据（icon/locale）必须整页刷新**：宿主每次 `pluginManager/listBundles` RPC 按需读盘（link 直通工作区，值已是新值），但插件页卡片列表缓存在前端 store（`ensure()` 只在 `status==='idle'` 时加载），**切到插件页签不会重新拉取**，用户常回「怎么没变」；仍旧就再重启一次 `dsh web`。地面真相：浏览器直接打开 `$DSH_HOME/profiles/web/node_modules/@rayadesu/<pkg>/icon.svg`。
5. **文档与 hash**：受影响包 README 双语（EN/ZH）+ `README.i18n.yaml` blob hash（`git hash-object`）+ `AGENTS.md`。同批微调攒到定稿一次补，**交用户前必须补齐**。
6. **提交留给阶段 B**：只 `git status --short` + `git diff --stat` 看一眼清单，**不要 commit**。
7. **等待用户说「发布」**（或提出新改动）。

### 本机注意（Windows，2026-09-29 实测）

- **safe-delete 守卫**按用户回合计删除次数（阈值 50，状态在 `%TEMP%\codebuddy-safe-delete-bulk\<hash>\state.json`），超限后该回合任何删除都抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，次回合自动重置——**能 `mv` 就别 `rm`**（连 `git fetch` 的后台 auto-gc 也会被它搞坏）。
- `pnpm install` 启动时无条件在项目根建 `_tmp_<pid>_<hash>` 再删，必撞守卫：加 `--store-dir <绝对路径且以 v11 结尾>`（如 `C:/Users/<你>/AppData/Local/pnpm/store/v11`）走提前返回分支。
- `pnpm run build`/`test` 的依赖预检（`runDepsStatusCheck`）会自动补跑 `pnpm install`，同样撞守卫：改跑底层二进制 `./node_modules/.bin/tsc -b tsconfig.host.json` → `./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host` → `node scripts/typert-compat.mjs`（client 面换 `tsconfig.client.json` / `DSH_BUILD_FACE=client`）；测试 `./node_modules/.bin/vitest run`；校验 `node scripts/verify-packages.mjs`。
- 本机 pnpm **isolated 模式链接落不了地**（`.pnpm` 装得完整、消费者侧只剩空目录还报 Done）：干净装用 `pnpm install --node-linker=hoisted`；装后用 `fs.symlinkSync(绝对目标, 链接, 'junction')` 手补包级链接（**相对路径会被 Node 归一化到 cwd**），并按 `vitest.config.ts` 的 react 系硬别名补齐 `packages/ui-billing/node_modules`，否则 3 个 client spec 收集阶段报 `Failed to resolve import "react/jsx-dev-runtime"`。
- `node_modules/@rayadesu` 下的 `*_tmp_*`、`.prev-*` 是 pnpm/历史残留，**无害**；要清理用 `mv`（`rm` 撞守卫）。
- 全套跑完的合格线：**288/288 全绿 + `verify` OK**。日志里 `React.jsx: type is invalid` 与 `Failed to load source map for …dsh-client-ui-primitives` 是既有噪声。

## 阶段 B — 发布（用户说「发布」时）

1. **版本对齐**：三包 `package.json` bump 到下一版本（根 bundle 的 `^0.3.x` 组件依赖区间、ui-billing peer/dev 的 `^0.3.x` 同步）；`AGENTS.md` 版本行；`pnpm install` 刷 `pnpm-lock.yaml`。这份改动**先留工作区**，作为最后的 `release:` 提交。
2. `pnpm run test` → `pnpm run build` → `pnpm run verify`（发布前校验，失败禁止发布）。**这是唯一必须跑全套的位置**，阶段 A 不要提前反复跑。
3. **按类型分别提交**（不要 `git add -A` 一把梭）：
   - `git status --short` + `git diff` 按**意图**分组，逐组 `git add <paths>` → `git commit`。
   - 类型惯例：`feat:` / `fix:` / `perf:` / `refactor:` / `style:`（纯视觉与文案排版）/ `docs:`（README、`README.i18n.yaml`、`AGENTS.md`）/ `chore:`（构建脚本、依赖、CI）。**用例跟着它覆盖的代码走**；同文件混意图用 `git add -p` 分块，分不动就按主要意图归类，别为凑类型硬拆。
   - 提交信息中文、沿用仓库既有风格（可带范围前缀如 `fix(billing):`），正文按「问题 → 根因 → 改动」写清根因/取舍。
   - **顺序**：代码类（feat/fix/perf/refactor/style）→ `docs:` → `release: vX.Y.Z`（版本对齐单独成条，作为发布标记）。用户反复试错时只写**最终形态**（阶段 A 没提交，中间过程本来就不在历史里）。
4. **推送全部**：`git push origin main`。若还有旧流程留下的未推送本地提交，一并推送；需重整先 `git reset --soft origin/main` 退回工作区再按第 3 步分组。
5. **npm 发布（顺序固定：llm-billing → ui-billing → dsh-billing，根 bundle 最后，因为它声明对前两者的依赖）**：

   ```sh
   cd packages/llm-billing && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../ui-billing       && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../../              && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   ```

   - token 由用户提供，**仅内联传参，绝不写入文件/仓库**；必须 `cd` 进包目录（带路径参数的 `npm publish packages/xx` 会被当成 GitHub 仓库简写）。
   - **`E409 Cannot publish over previously staged version "<ver>"` 不是失败**：三包都会先报，版本随后**延迟 20–30 秒落库**（v0.3.16 实测）。不要改版本重发、不要重复 publish；等约 30 秒 `npm view <pkg> dist-tags.latest` 复核，再 `npm pack <pkg>@<ver>` 抽一处 marker 确认内容带本轮改动。
   - `prepublishOnly`（verify-packages.mjs）自动运行，失败即中止；`dsh-client-ui-billing` 偶发 "being processed"，等约 3 分钟复核。
6. **tag + GitHub Release（DSH 官方格式）**：

   ```sh
   git tag v<ver> && git push origin v<ver>
   gh release create v<ver> --title "v<ver>" --notes-file <正文文件>
   ```

   标题 = 裸版本号 `v<ver>`。**正文先写成文件再 `--notes-file`**——`--notes` 内联在 PowerShell 里会吃掉反引号，且 `` `e ``/`` `t ``/`` `f `` 会被解释成 ESC/Tab/分页控制字符（曾出乱码事故）。

   ### 模板（Chinese + English 双语，逐字套用）

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

   ### 格式规则（对照 deepseek-ai/deepseek-harness 全部 8 个官方版本逐一核对）

   - 语言切换行 `[中文](#cn-v<ver>) | [English](#en-v<ver>)`；分组固定四类、顺序固定：中文「新增功能 / 体验优化 / 问题修复 / 其他变更」，英文「New Features / Improvements / Bug Fixes / Chores」镜像对应。
   - **只写有内容的分组——空组整个省略**，不写「无 / None」占位（官方 rc.1 只有一组；alpha.3 没有「新增功能」直接省略）。
   - 中文段第一个 h3 带 `id="cn-v<ver>"`、英文段 `id="en-v<ver>"`，其余裸标签；h3 一律 HTML 标签（不是 `###`）。
   - 条目 `* ` 开头，中文以 ` @作者` 结尾、英文以 ` by @作者` 结尾（本仓库作者 = @rayadesune；早期初始提交 = @WilliamLIiii）；中英段之间、changelog 之前用 `---`。
   - `Full Changelog` 用上一个 tag 的 compare 链接；**首个版本没有上一个 tag，用 `https://github.com/<owner>/<repo>/commits/v<ver>`**；合并发布时把跳过的版本（如 0.3.3/0.3.4 随 0.3.5）内容并进本次对应分组。
   - 正文里的用户可见行为逐条对照 `git log v<prev>..v<ver}`，别漏（尤其阶段 A 累积的多轮改动）。
7. **收尾核对**：`git status` 干净、origin/main 与 tag 均已推送；三包 `dist-tags.latest` = 新版本；`gh release list` 标题为裸版本号；`gh release view v<ver>` 抽查正文无乱码（反引号、全角字符）。
8. **切回 npm 源**（用户想保留本地验证的 `link:` 引用时就不动 profile；要切回时给一条命令）：

   ```sh
   dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
   ```

   **三名必须齐给**：残留的本地 `link:` 条目若不被覆盖，会盖过 bundle 从 registry 解析的组件包，静默用回工作区版本。

## 改图标硬规则

- **透明底**：别把 `#151517` 之类底色 `<rect>` 烤进 SVG——深色模式看不出来，切浅色就是一块黑方；条目那 62px 圆角方块（深色 `#151517` + `#3b3b3c` 边框 / 浅色 `#ffffff` + `#e0e0e0` 边框）由插件页自己画。
- **尺寸按官方条目实测量，别凭感觉**：官方字形只有 21–26px（`icon` 是 46px `<img>` 但自带留白）；量 bbox 时 **x 窗口避开条目右侧的彩色「实验性」徽章**，否则 bbox 撑到 46px、做出来大 1.6 倍（踩过两次）。
- **别盲写**：先用脚本量参考图的几何比例与取色（笔画宽÷图形宽、分叉/横杠相对位置、渐变色标），按比例生成 3–4 个候选、渲成一张对比 PNG 用 Read 看图挑版；用户常追加硬约束（尺寸不要改 / 不要某元素 / 配色沿用），定稿前先确认这些边界。
- **手绘带笔锋的图形别用等宽描边复刻**：单三次曲线族钉死尖端/腰线宽后无自由度，残差 2–3% 会从「细针」变「胖臂罗盘」（IoU 0.42）。改用实测带状路径：射线采样每 2.5° 的 [内沿, 外沿]、3 点滑动平均去噪、串成闭合环（外沿 0°→90° 再内沿 90°→0°，不需 evenodd），`transform="rotate(90/180/270 cx cy)"` 复制四份（**禁 `<use href>`**——图标自包含约束）。判定用 **IoU + 每径向环带的墨量**，只看包络对线宽不敏感，会滑向「细线粗路径」的退化解。
- **「显小」量墨量不量 bbox**：空心图形的视觉分量在墨量（官方条目 bbox 21–28px、描边中位数 5–7px，实心型到 23px；我们 25×25px 空心环描边 1.31px 就显小）。笔画提亮 1.5–1.8× 时**向内外各扩一半保持外沿**（`r = D/2 - stroke/2`），但别给自带粗细变化的图形提亮；多环图形加粗上限由环间距锁死，想更粗必须同时放大 D 或去掉内环；**同一套比例不能搬到更小档位**——14px 下双环是 0.63/0.32/0.18px 全亚像素，降级成单环 + 实心星（一条三次曲线一个尖即可，比实测折线干净）。
- **判用户截像是哪一版别靠肉眼**：裁出方块，`resvg-js` 渲染候选 + `pngjs` 算平均像素差（包在 `~/.workbuddy-ai/binaries/node/workspace`），差值明显小者即当前生效版本。

## 约定速查

- **版本号**：三包 + 根 bundle 统一（`AGENTS.md` 版本行、根 `package.json`、两子包 `version` 与 `^0.3.x` peer 同步）。
- **npm 发布顺序**：`llm-billing` → `ui-billing` → `dsh-billing`。
- **构建顺序**：`pnpm run build:host` → `build:client`（动了 typert 产物必须先 host）。
- **E409 不是失败**：等 20–30 秒延迟落库，复核 `dist-tags`。
- **本地安装（阶段 A）**：build → 官方本地目录一条命令（**三个目录给全**）→ 核对三条 `link:` + marker → 用户重启 `dsh web` 硬刷新；改静态元数据还须整页刷新。
