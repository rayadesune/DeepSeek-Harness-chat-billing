# HANDOFF — billing 插件 0.2.3 已发布（全量优化 · 2026-08-28）

## 本轮改动（0.2.3 · 全量优化，按用户审核通过的方案执行）

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

## 发布记录（2026-08-28 · 0.2.3）
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
