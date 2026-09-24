---
name: dsh-release
description: 按 DeepSeek Harness 官方 GitHub Release 格式发布 @rayadesu 计费插件的 npm 包与 GitHub Release；默认改完代码**先不提交**、直接本地 pack 安装交给用户重启验证，用户明确说「发布」后才把工作区改动按类型分别提交、推送、发 npm 与 release；阶段 A 的校验与打包按改动档位最小化（省 token）
whenToUse: 修改 DeepSeek-Harness-chat-billing 后需要本地安装验证、或用户要求发布新版本时
user-invocable: true
---

# DSH 格式发布流程（DeepSeek-Harness-chat-billing）

三包统一版本（`@rayadesu/dsh-billing` 根 bundle + `@rayadesu/dsh-llm-billing` + `@rayadesu/dsh-client-ui-billing`）+ npm 顺序发布 + GitHub Release 按 DSH 官方格式。

## 目录

- [两阶段铁律](#两阶段铁律)
- [成本纪律（省 token，硬约束）](#成本纪律省-token硬约束)
  - [附：会话成本诊断脚本](#附会话成本诊断脚本)
- [阶段 A — 改动 + 本地 pack 安装](#阶段-a--改动--本地-pack-安装默认执行不提交)
- [阶段 B — 发布（用户说「发布」时）](#阶段-b--发布用户说发布时)
- [约定速查](#约定速查)

## 两阶段铁律

- **阶段 A（默认执行）**：改代码 → 校验 → 本地 pack 安装 → 交给用户重启验证。**全程不提交**（改动留在工作区），也绝不推送、绝不打 tag、绝不发布 npm/GitHub。
- **阶段 B（只有用户明确说「发布」才进入）**：bump 版本 → 校验 → **把工作区改动按类型分别提交** → 推送 → npm 顺序发布 → tag + GitHub Release → HANDOFF 发布记录。

阶段 A 期间用户常反复提改动（截图反馈、样式微调、来回撤回重做）；这些都累积在同一份**未提交**的工作区改动里，等阶段 B 一次性按类型归拢成清晰提交，中间试错天然不留痕。**阶段 A 不要 `git add` / `git commit` / `git stash` / `git reset`**，除非用户明确要求整理提交历史。

两阶段对照：

| 阶段 | 触发 | 核心动作 | 提交 / 推送 / 发布 |
| --- | --- | --- | --- |
| A | 改完代码（默认） | 按档校验 → 本地 pack 安装 → 交用户验证 | 全不做 |
| B | 用户明确说「发布」 | bump → 三连校验 → 按类型提交 → npm → tag+release | 全做 |

## 成本纪律（省 token，硬约束）

**一轮的 token ≈ 该轮的模型请求数 × 当时的上下文大小。** 每次工具调用都是一次「把整段对话重发给模型」的请求，所以长会话里的微小改动也可能极贵。实测（本仓库一次只改 2 个字符串的徽标文案）：会话上下文已 511K，该轮 52 次请求 ≈ **25.9M token**，其中输出只占 22K（0.09%），其余全是输入重放；同样的改动在空会话里只需 0.3–1M。

省钱只靠三件事：**少发请求、别把大输出灌进上下文、别重复跑/重复打包。**

### 0. 每轮的请求预算（先定预算，再动手）

**一次模型请求 = 重放整段上下文**；请求数 ≈ 这一轮里「带工具调用的助手消息」条数（同一条消息里发多个工具调用只算一轮），所以**预算按请求数算**：

| 档位 | 每轮请求预算（≈ 工具往返轮数） | 典型构成 |
| --- | --- | --- |
| 轻量 | **≤ 8** | 定位 1–2 + 改动 1–2 + 受影响用例 1 + 安装 1 + 文档 1–2 |
| 常规 | **≤ 12** | 轻量 + 官方规则核实 1–2 + 二次用例 1 |
| 完整 | **≤ 20** | 含 `test`/`build`/`verify` 三连与提交分组 |

超预算就**停下合并步骤**：能一条命令跑完的不要拆成三条，互不依赖的读 / 查 / 改**塞进同一条消息**一次发完，别一轮一个。

### 1. 改动定档（先判断，再动手）

**判断依据是「打包产物会不会变」**：只改注释或文档不必重新打包安装；行为或类型变了才需要。**全套 `test`/`build`/`verify` 一轮只跑一次**（收尾交给用户前，或阶段 B），不要每改一处就跑一遍。

| 档位 | 典型改动 | 必跑校验 | 打包 / 安装 |
| --- | --- | --- | --- |
| 轻量 | 文案、locale 键、CSS、注释、单点样式 | 只跑受影响的 spec（`pnpm exec vitest run <spec>`） | 只重打**改动的那一个包**，只 remove/add 那一个 |
| 常规 | 单包源码逻辑 | 该包 spec + `pnpm run build:host` / `pnpm run build:client` | 同上 |
| 完整 | 跨包语义、宿主计价 / 投影单元、依赖或版本 | `pnpm run test` → `pnpm run build` → `pnpm run verify` | 三包全重打重装 |

> **构建顺序硬约束**：`ui-billing` 的 client 面依赖 host 面 tsdown 生成的 `lib/typert.remote-client.d.ts`。动了 Remote 类型或 typert 产物**必须先 `pnpm run build:host`**；干净 checkout 也必须 host → client 顺序（见 AGENTS.md）。

### 2. 工具输出只留尾巴

这些输出会**永久留在上下文里**，之后每一次请求都要重放一遍：

```sh
pnpm run test 2>&1 | Select-String -Pattern "Tests |Test Files|FAIL"   # 或 pnpm run test -- --reporter=dot
pnpm run build 2>&1 | Select-String -Pattern "Build complete|error"
git diff --stat          # 先看规模，再决定要不要看全文
git diff -U0 <file>      # 要看差异时用 0 行上下文
```

宽 grep 必须配 `include` / 路径收窄 + `Select-Object -First N`；整份大文件不要全文 `read`，按 `offset`/`limit` 精读。

- **巨型单行文件不要 `read`**：README 的面板段落是 8–10K 字符的**一行**，`offset`/`limit` 也切不开它。这类文件的锚点替换改用一条 `node -e` 脚本做（只回 `ok` / `BAD` 一行）——比把整段抄进上下文便宜一个数量级。
- **先定位再精读**：`grep` 拿行号 → `read` 只取那 20–40 行；不要「读整个文件只为找一处」。
- **不要为「确认一下」重复取数**：手上的输出先用完（失败信息里已经写明炸的是哪条断言，就别再跑一遍全屏 dump）。

### 3. 编辑与打包最小化

- 同一文件的多处改动合并成**少数几次** `edit`，锚点取**最短唯一串**——不要把整段 README 抄进 `old_string`/`new_string`（两份文本都会进上下文）。
- **一次 pack 到位**：注释、排序、措辞这类不影响产物的调整都在 pack 之前做完；pack 之后若只改了注释，**不要**为了「tarball 与源码逐字节一致」再打一次包、再装一次。
- **一条命令收尾**（构建 → 打包 → 装 profile → 抽查产物），不要拆成 4–6 次工具调用：

  ```sh
  node scripts/local-install.mjs ui-billing --face client --check <改动字符串>
  node scripts/local-install.mjs ui-billing llm-billing --face both --check <字符串>
  ```

  脚本只回 4–6 行（每步一行 + 抽查计数），**失败才**附上那一步的尾巴；`--face host|both|client` 选编译面，`--dry-run` 只看计划，`--no-build` 跳过构建。它内部就是「重装只针对改动包：`remove <pkg>` + `add <tgz>` 单个包」（pnpm 11 的同名同版本陷阱只影响被替换的那个包），并把 `remove` 失败降级成跳过（包本来就不在 profile 里也照样装得上）。

  **脚本兜底**：`local-install.mjs` 走 `spawnSync(cmd.exe)` 偶尔会 `EBUSY`（v0.3.15 本轮实测），整条任务直接 fail。此时退路是**手动分步** pack + add（见阶段 A 第 3 步注）——不要反复重跑脚本，直接走手动路径即可。

### 4. 会话卫生

- 与本会话已完成工作**无关的微调**（尤其中间隔了几轮），主动建议用户新开会话再做：同样的活便宜 20–50 倍。用户选择继续时，按轻量档执行，并在回复末尾说明「本轮按轻量档：只跑受影响用例、只重装改动包」。
- 不要为「确认一下」重复读取或重复运行；先看手上已有的输出，再决定是否重跑。

### 附：会话成本诊断脚本

会话日志是**多帧 zstd**（每帧一段 JSONL），Node 的 `zstdDecompressSync` 只解第一帧，所以要按帧魔数扫描 + 按事件 `seq` 去重。把下面脚本存成临时 `.mjs` 跑一次，即可得到「每轮请求数 / 上下文大小 / token 总量」，用来定位是哪一轮、哪类操作把成本顶上去的（`$DSH_SESSION_ID` 是当前会话 id，桶目录名 = 工作目录转义后的名字）：

```js
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
const p = `${process.env.DSH_HOME}/sessions/<bucket>/<sessionId>/session.v3.jsonl.zstd`
const buf = readFileSync(p)
const offs = []
for (let i = 0; i + 4 <= buf.length; i++) if (buf.compare(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), 0, 4, i, i + 4) === 0) offs.push(i)
const events = new Map()
for (const start of offs) {
  let text; try { text = zstdDecompressSync(buf.subarray(start)).toString('utf8') } catch { continue }
  const parsed = []; let ok = true
  for (const line of text.split('\n').filter(Boolean)) { try { parsed.push(JSON.parse(line)) } catch { ok = false; break } }
  if (!ok) continue
  for (const event of parsed) if (typeof event.seq === 'number' && !events.has(event.seq)) events.set(event.seq, event)
}
const byTurn = new Map()
for (const event of [...events.values()].sort((a, b) => a.seq - b.seq)) {
  const usage = event.type === 'assistant/message' ? event.data?.usage : undefined
  if (!usage) continue
  const row = byTurn.get(event.data.turn) ?? { requests: 0, tokens: 0 }
  row.requests += 1
  row.tokens += (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
  byTurn.set(event.data.turn, row)
}
for (const [turn, row] of byTurn) console.log(`turn ${turn}: ${row.requests} reqs, ${(row.tokens / 1e6).toFixed(2)}M tok`)
```

经验值（本仓库实测）：token 的 99%+ 是**输入重放**（其中绝大多数按最便宜的 cache-read 计价），输出通常只占 0.1%；所以降成本要降「请求数 × 上下文」，不是压缩回复长度。

## 阶段 A — 改动 + 本地 pack 安装（默认执行，不提交）

1. **改代码**（`packages/*/src`、`tests/`）。先按上面的「成本纪律」定档，再决定跑什么、打什么包。
2. **按档位校验**：轻量/常规档先跑**受影响的 spec**；收尾交给用户前跑一次 `pnpm run test` 全套（必须全绿）。新增/调整行为必须补用例。
3. **构建 + 打包 + 装 profile：一条命令**（`lib/` 是 pack 的产物，改动生效必须重新构建）。`scripts/local-install.mjs` 内部按顺序做完四件事：`pnpm run build:<face>` → `npm pack` 到 `$DSH_HOME\local-tarballs`（**不 bump 版本号**）→ `dsh plugin --profile web remove/add` **只处理改动的那一个包** → 在**装好的** `lib/` 里数 `--check` 字符串。

   ```sh
   node scripts/local-install.mjs ui-billing --face client --check label.todayTokens.hit
   node scripts/local-install.mjs ui-billing llm-billing --face both --check <字符串>
   ```

   编译面：改 client 面 `--face client`、改宿主面 `--face host`、跨包或拿不准 `--face both`（**动了 Remote 类型或 typert 产物先 host**，见上文构建顺序硬约束）。三包都改才并列三个包名。**长命令放后台**（`run_in_background`）再用 `job_output` 收一次；抽查计数为 0 就是改动没进产物，脚本会直接报 FAIL。

   **脚本 EBUSY 兜底（手动路径）**：若 `local-install.mjs` 失败，按下面分步做（已验证可用）——先 `npm pack --pack-destination $DSH_HOME/local-tarballs` 进每个改动包目录，再 `dsh plugin --profile web remove <pkg>`（失败可忽略）+ `add <tgz>`。注意 `add` 长命令可能留一个 `.lock` 残锁导致后续写 `package.json` 报占用，遇 `package.json.lock` 存在直接 `rm -f` 再重试即可。

4. **文档与 hash**：受影响包 README 双语（EN/ZH）+ `README.i18n.yaml` blob hash（`git hash-object`）、`AGENTS.md`、`HANDOFF.md`（本轮问题/根因/改动记录）。同一批微调可以**攒到行为定稿后一次补**（不要每改一个字符串就改一轮文档 + hash），但**交给用户验证之前必须补齐**。
5. **提交留给阶段 B**：改完只看一眼清单（`git status --short`，必要时 `git diff --stat`）以便阶段 B 归拢，**不要 commit**。
6. **交给用户**：提示「请重启 `dsh web` 并硬刷新验证」，列出本轮应验证的行为点（改了什么、该看到什么），并说明本轮按哪一档做的校验/安装。
7. **等待用户说出「发布」**（或提出新改动）。用户没发话，到此为止；工作区改动继续累积，下一轮在它之上继续改。

## 阶段 B — 发布（用户说「发布」时）

1. **版本对齐**：三包 `package.json` bump 到下一版本号（根 bundle peerDeps 与 ui-billing peer/dev 的 `^0.3.x` 同步改）；`AGENTS.md` 版本行同步；`pnpm install` 刷新 `pnpm-lock.yaml`。这份改动**先留在工作区**，第 3 步作为最后的 `release:` 提交。
2. `pnpm run test` → `pnpm run build` → `pnpm run verify`（发布前校验，失败禁止发布）。这是本流程里**唯一必须跑全套**的位置，阶段 A 不要提前反复跑。
3. **按类型分别提交工作区改动**（本阶段核心，**不要 `git add -A` 一把梭**）：
   - 先 `git status --short` + `git diff`（必要时 `git diff <file>`）把改动按**意图**分组，再逐组 `git add <paths>` → `git commit`。
   - 类型惯例：`feat:`（新能力）/ `fix:`（修缺陷）/ `perf:` / `refactor:` / `style:`（纯视觉与文案排版）/ `docs:`（只动 README、`README.i18n.yaml`、`AGENTS.md`、`HANDOFF.md`）/ `chore:`（构建脚本、依赖、CI）。
   - **用例跟着它覆盖的代码走**：`fix:`/`feat:` 提交里带上对应 tests 与必要的行内注释；只有确实"只改了测试"才单独 `test:`。
   - **同一个文件混了多种意图**时用 `git add -p` 分块暂存；实在分不动就按主要意图归类，不要为凑类型硬拆，也不要把无关改动塞进同一提交。
   - 提交信息用中文、沿用仓库既有风格（可带范围前缀，如 `fix(billing):`、`feat(ui):`），正文写清**根因/取舍**（HANDOFF 里那套「问题 → 根因 → 改动」的精简版）。
   - **提交顺序**：先代码类（`feat` / `fix` / `perf` / `refactor` / `style`）→ 再 `docs:` → 最后 `release: vX.Y.Z`（版本对齐单独成条，作为发布标记）。
   - 用户反复试错时，只把**最终形态**写进对应类型的提交（阶段 A 没提交，中间过程本来就不在历史里）。
4. **推送全部**：`git push origin main`。
   - 若此前仍有旧流程留下的未推送本地提交（它们本就是干净的提交），一并推送即可；确实需要重整时先 `git reset --soft origin/main` 把改动退回工作区，再按第 3 步重新分组提交。
5. **npm 发布（顺序固定：llm-billing → ui-billing → dsh-billing）**：

   ```sh
   cd packages/llm-billing && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../ui-billing       && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   cd ../../              && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
   ```

   - token 由用户提供，**仅内联传参，绝不写入文件/仓库**。
   - 必须 `cd` 进包目录再 publish（带路径参数的 `npm publish packages/xx` 会被当成 GitHub 仓库简写）。
   - **`E409 Cannot publish over previously staged version "<ver>"` 不算失败**：三个包都会先报
     这条，版本随后**延迟 20–30 秒落库**（v0.3.16 实测如此）。此时不要改版本号重发、也不要
     重复 publish；等约 30 秒后用 `npm view <pkg>@<ver> version` / `dist-tags.latest` 复核，
     再用 `npm pack <pkg>@<ver>` 解包数一处 marker 确认内容真的带了本轮改动。
   - `prepublishOnly`（verify-packages.mjs）自动运行，失败即中止。
   - 核对：`npm view <pkg> dist-tags.latest` 三个包都等于新版本；`dsh-client-ui-billing` 偶发 "being processed"（首查仍是旧版本），等约 3 分钟再复核。
6. **tag + GitHub Release（DSH 官方格式）**：

   ```sh
   git tag v<ver> && git push origin v<ver>
   gh release create v<ver> --title "v<ver>" --notes-file <正文文件>
   ```

   标题 = 裸版本号 `v<ver>`。正文务必先写成文件再 `--notes-file`——`--notes` 内联在 PowerShell 里会把反引号吃掉，且 `` `e ``/`` `t ``/`` `f `` 会被解释成 ESC/Tab/换页控制字符（曾经的乱码事故）。

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

   ### 格式规则（对照 deepseek-ai/deepseek-harness 的 release，逐一核对过全部 8 个官方版本）

   - 语言切换行：`[中文](#cn-v<ver>) | [English](#en-v<ver>)`。
   - **分组固定四类**，顺序固定：中文「新增功能 / 体验优化 / 问题修复 / 其他变更」，英文「New Features / Improvements / Bug Fixes / Chores」镜像对应。
   - **只写有内容的分组——某组没有条目就整个省略，不要写「无 / None」占位**（官方 rc.1 只有「新增功能」一组；alpha.3 没有「新增功能」直接省略）。
   - 中文段第一个 h3 带 `id="cn-v<ver>"`；英文段第一个 `id="en-v<ver>"`；其余 h3 为裸标签；h3 一律用 HTML 标签（不是 `###`）。
   - 条目 `* ` 开头；中文以 ` @作者` 结尾，英文以 ` by @作者` 结尾（本仓库作者 = @rayadesune；早期初始提交 = @WilliamLIiii）。
   - 中文段与英文段之间、英文段与 changelog 之间用 `---` 分隔。
   - `Full Changelog` 用上一个 tag 的 compare 链接；**首个版本没有上一个 tag，用 `https://github.com/<owner>/<repo>/commits/v<ver>`**。
   - 合并发布（跳过的版本如 0.3.3/0.3.4 随 0.3.5 一起发）时，把缺失版本的内容并进本次的对应分组。
   - 正文里的用户可见行为逐条对照 `git log v<prev>..v<ver>` 与 HANDOFF 本轮记录，别漏（尤其阶段 A 累积的多轮改动）。

7. **HANDOFF 发布记录**：在 HANDOFF.md 顶部轮次追加「发布记录（日期 · vX.Y.Z）」——提交号（本轮的按类型提交 + `release:` 提交）、tag、release 链接、npm 三包 dist-tags——再追加一个 `docs:` 中文提交并推送。
8. **收尾核对**：`git status` 干净、origin/main 与 tag 均已推送；三个 npm 包 dist-tags.latest = 新版本；`gh release list` 标题为裸版本号；`gh release view v<ver>` 抽查正文无乱码（反引号、全角字符）。
9. 若用户此前要求保留本地验证的 `file:` 引用，则不动 profile；需要切回 npm 源时给用户一条命令：

   ```sh
   dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
   ```

## 约定速查

- **版本号**：三包 + 根 bundle 统一（`AGENTS.md` 版本行、根 `package.json`、两个子包 `package.json` 的 `version` 与 peerDeps 同步）。
- **npm 发布顺序**：`llm-billing` → `ui-billing` → `dsh-billing`（根 bundle 最后，因为它声明对前两者的依赖）。
- **构建顺序**：`pnpm run build:host` → `pnpm run build:client`（host 产物是 client 类型声明的来源；动了 typert 产物必须先 host）。
- **E409 不是失败**：三个包都会先报，等 20–30 秒延迟落库，复核 `dist-tags` 即可。
- **本地安装**：优先 `scripts/local-install.mjs`（一条命令），偶发 `EBUSY` 时退手动 pack + add（见阶段 A 第 3 步注）。
