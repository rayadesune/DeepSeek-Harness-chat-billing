---
name: dsh-release
description: 按 DeepSeek Harness 官方 GitHub Release 格式发布 @rayadesu 计费插件的 npm 包与 GitHub Release（版本对齐、构建验证、发布顺序、双语 release 模板）
whenToUse: 需要为 DeepSeek-Harness-chat-billing 发布新版本、打 tag、创建 GitHub Release 或发布 npm 包时
user-invocable: true
---

# DSH 格式发布流程（DeepSeek-Harness-chat-billing）

本仓库发布 = 三包统一版本（`@rayadesu/dsh-billing` 根 bundle + `@rayadesu/dsh-llm-billing` + `@rayadesu/dsh-client-ui-billing`）+ npm 顺序发布 + GitHub Release 按 DSH 官方格式。发布时严格按以下顺序执行，不要跳步。

## 1. 版本对齐

- 把根 `package.json`、`packages/llm-billing/package.json`、`packages/ui-billing/package.json` 的 `version` 从旧版本改为新版本（根 bundle 的 peerDeps 与 ui-billing 的 peer/devDeps 中的 `^0.3.x` 引用同步改）。
- `AGENTS.md` 的「版本对齐」行同步当前版本号。
- 若改动影响 npm 依赖：`pnpm install` 刷新 `pnpm-lock.yaml`。

## 2. 构建与验证

```sh
pnpm run test    # 全套用例必须全绿
pnpm run build   # host + client 两个编译面
pnpm run verify  # 发布前校验（typert 清单包名归属，失败禁止发布）
```

## 3. 本地打包安装（可选，用户要求在本地验证时）

```sh
# 三个包分别 npm pack 到 %DSH_HOME%\local-tarballs\，文件名形如 rayadesu-dsh-llm-billing-<ver>.tgz
npm pack --pack-destination "$env:DSH_HOME\local-tarballs"   # 在各自包目录与仓库根各跑一次
# 装入 web profile（pnpm 11 对同名同版本 tarball 视为未变：换版本重装须先 remove）
node <harness>\apps\cli\lib\bin.js plugin --profile web remove @rayadesu/dsh-billing @rayadesu/dsh-client-ui-billing @rayadesu/dsh-llm-billing
node <harness>\apps\cli\lib\bin.js plugin --profile web add <三个 0.3.x tgz 的完整路径>
# 用户重启 dsh web 并硬刷新后生效
```

## 4. Git 提交与 tag

- 中文提交信息（`fix:` / `feat:` / `docs:` / `chore:` …），推送 `origin/main`。
- `git tag v<ver> && git push origin v<ver>`。
- 按仓库惯例在 `HANDOFF.md` 顶部追加本轮记录（问题/根因/改动/发布记录）。

## 5. npm 发布（顺序固定：llm-billing → ui-billing → dsh-billing）

```sh
cd packages/llm-billing && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
cd ../ui-billing       && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
cd ../../              && npm publish --//registry.npmjs.org/:_authToken=$TOKEN
```

- token 由用户提供，**仅内联传参，绝不写入文件/仓库**。
- 必须 `cd` 进包目录再 publish（带路径参数的 `npm publish packages/xx` 会被当成 GitHub 仓库简写）。
- `prepublishOnly`（verify-packages.mjs）自动运行，失败即中止。
- 发布后核对：`npm view <pkg> dist-tags.latest` 三个包都等于新版本。

## 6. GitHub Release（DSH 官方格式）

标题 = 裸版本号 `v<ver>`（与历史版本一致，不带描述后缀）。正文**必须写成文件再用 `gh release edit --notes-file` 应用**——`--notes` 内联在 PowerShell 里会把反引号吃掉，且 `` `e ``/`` `t ``/`` `f `` 会被解释成 ESC/Tab/换页控制字符（曾经的乱码事故）。

### 模板（Chinese + English 双语，逐字套用）

```markdown
[中文](#cn-v<ver>) | [English](#en-v<ver>)

<h3 id="cn-v<ver>">新增功能</h3>

* <要点> @rayadesune

<h3>体验优化</h3>

* <要点> @rayadesune

<h3>其他变更</h3>

* <要点> @rayadesune

---

<h3 id="en-v<ver>">New Features</h3>

* <point> by @rayadesune

<h3>Improvements</h3>

* <point> by @rayadesune

<h3>Chores</h3>

* <point> by @rayadesune

---

Full Changelog: https://github.com/rayadesune/DeepSeek-Harness-chat-billing/compare/v<prev>...v<ver>
```

### 格式规则（对照 deepseek-ai/deepseek-harness 的 release）

- 语言切换行：`[中文](#cn-v<ver>) | [English](#en-v<ver>)`。
- 中文段 h3 带 `id="cn-v<ver>"`；英文段 `id="en-v<ver>"`；h3 用 HTML 标签（不是 `###`）。
- 分组固定三个：中文「新增功能 / 体验优化 / 其他变更」，英文「New Features / Improvements / Chores」；无内容写「无」/“None”。
- 条目 `* ` 开头；中文条目以 ` @作者` 结尾，英文以 ` by @作者` 结尾。作者是 GitHub 账号（本仓库历史作者 = @rayadesune，早期初始提交 = @WilliamLIiii）。
- 中文段与英文段之间、英文段与 changelog 之间用 `---` 分隔。
- `Full Changelog` 用上一个 tag 到本 tag 的 compare 链接；**首个版本没有上一个 tag，用 `https://github.com/<owner>/<repo>/commits/v<ver>`**。
- 合并发布（跳过的版本如 0.3.3/0.3.4 随 0.3.5 一起发）时，把缺失版本的内容并进本次的对应分组。

```sh
gh release edit v<ver> --title "v<ver>" --notes-file <正文文件>
gh release list --limit 8   # 核对标题格式与 Latest 标记
```

## 7. 收尾检查

- `git status` 干净；origin/main 与 tag 均已推送。
- 三个 npm 包 dist-tags.latest = 新版本。
- release 标题裸版本号、正文双语无乱码（抽查 `gh release view v<ver>` 的 `\`` 与全角字符）。
