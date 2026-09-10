---
name: dsh-release
description: 按 DeepSeek Harness 官方 GitHub Release 格式发布 @rayadesu 计费插件的 npm 包与 GitHub Release；默认改完代码**先不提交**、直接本地 pack 安装交给用户重启验证，用户明确说「发布」后才把工作区改动按类型分别提交、推送、发 npm 与 release
whenToUse: 修改 DeepSeek-Harness-chat-billing 后需要本地安装验证、或用户要求发布新版本时
user-invocable: true
---

# DSH 格式发布流程（DeepSeek-Harness-chat-billing）

本仓库发布 = 三包统一版本（`@rayadesu/dsh-billing` 根 bundle + `@rayadesu/dsh-llm-billing` + `@rayadesu/dsh-client-ui-billing`）+ npm 顺序发布 + GitHub Release 按 DSH 官方格式。

**两阶段铁律：**

- **阶段 A（默认执行）**：改代码 → 校验 → 本地 pack 安装 → 交给用户重启验证。**全程不提交**（改动留在工作区），也绝不推送、绝不打 tag、绝不发布 npm/GitHub。
- **阶段 B（只有用户明确说「发布」才进入）**：bump 版本 → 校验 → **把工作区改动按类型分别提交** → 推送 → npm 顺序发布 → tag + GitHub Release → HANDOFF 发布记录。

阶段 A 期间用户常反复提改动（截图反馈、样式微调、来回撤回重做）；这些都累积在同一份**未提交**的工作区改动里，等阶段 B 一次性按类型归拢成清晰提交，中间试错天然不留痕。**阶段 A 不要 `git add` / `git commit` / `git stash` / `git reset`**，除非用户明确要求整理提交历史。

## 阶段 A — 改动 + 本地 pack 安装（默认执行，不提交）

1. **改代码**（`packages/*/src`、`tests/`）。按仓库约定同步文档：受影响包 README 双语（EN/ZH 都要）与 `README.i18n.yaml` blob hash（`git hash-object` 重算）、`AGENTS.md`、`HANDOFF.md`（本轮问题/根因/改动记录）。
2. **提交留给阶段 B**：改完只看一眼清单（`git status --short`，必要时 `git diff --stat`）以便阶段 B 归拢，**不要 commit**。
3. `pnpm run test` —— 全套用例必须全绿；新增/调整行为必须补用例。
4. `pnpm run build` —— host + client 两个编译面，`lib/` 是 pack 的产物，必须重新构建。
5. **本地 pack（不 bump 版本号，沿用当前版本）**：

   ```sh
   # 三个包分别 npm pack；同名文件直接覆盖
   npm pack --pack-destination "$env:DSH_HOME\local-tarballs"   # 在 packages/llm-billing、packages/ui-billing、仓库根各跑一次
   ```

6. **装入 web profile（pnpm 11 陷阱：同名同版本 tarball 视为未变，必须先 remove 再 add）**：

   ```sh
   node <harness>\apps\cli\lib\bin.js plugin --profile web remove @rayadesu/dsh-billing @rayadesu/dsh-client-ui-billing @rayadesu/dsh-llm-billing
   node <harness>\apps\cli\lib\bin.js plugin --profile web add "$env:DSH_HOME\local-tarballs\rayadesu-dsh-billing-<ver>.tgz" "$env:DSH_HOME\local-tarballs\rayadesu-dsh-client-ui-billing-<ver>.tgz" "$env:DSH_HOME\local-tarballs\rayadesu-dsh-llm-billing-<ver>.tgz"
   ```

7. **交给用户**：提示「请重启 `dsh web` 并硬刷新验证」，列出本轮应验证的行为点（改了什么、该看到什么）。
8. **等待用户说出「发布」**（或提出新改动）。用户没发话，到此为止；工作区改动继续累积，下一轮在它之上继续改。

## 阶段 B — 用户说「发布」时（完整发布）

1. **版本对齐**：三包 `package.json` bump 到下一版本号（根 bundle peerDeps 与 ui-billing peer/dev 的 `^0.3.x` 同步改）；`AGENTS.md` 版本行同步；`pnpm install` 刷新 `pnpm-lock.yaml`。这份改动**先留在工作区**，第 3 步作为最后的 `release:` 提交。
2. `pnpm run test` → `pnpm run build` → `pnpm run verify`（发布前校验，失败禁止发布）。
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
