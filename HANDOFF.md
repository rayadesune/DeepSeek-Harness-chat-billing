# HANDOFF — billing 插件 0.2.2（测试全绿，发布待执行 · 2026-08-28 续）

## 目标与进度
- 目标：修复 @rayadesu/dsh-llm-billing 的 TYPERT 清单包名归属错误，恢复独立构建，发布 0.2.2。
- 当前进度：**6 个测试套件全绿（83 个用例）**；build / typecheck / verify 全绿；源码改动未提交 git（上一轮已提交 0ed0a37，本轮改动待提交）；发布尚未执行（npm 登录态未验证）。

## 本轮完成（相对 0ed0a37 的新改动）
1. **vitest.config.ts 修复**：上一轮提交的配置里正则被写坏（反斜杠丢失、正则拆行）导致 vitest 无法加载；已按 harness 原版（vitest.shared.ts）重写 standardDecoratorPlugin。
2. **typert-protocol 移出 pnpm workspace**：内嵌包只有声明（`export declare`），没有运行时实现，且 `linkWorkspacePackages` 会让它遮蔽 npm 包；现在 `packages:` 只含 llm-billing / ui-billing，`@deepseek-ai/dsh-typert-protocol` 从 npm 解析（lib 带真实 remoteMethods 实现）。typert 生成器不受影响（它按 tsconfig references 注册包，不依赖 pnpm workspace 成员身份）。
3. **ui-billing 客户端测试基础设施**（npm 0.1.1-rc.2 client 栈发布缺陷的完整应对）：
   - `packages/ui-billing/tests/fixtures/renderer-src/client/`：从 harness `dsh-v0.1.1-rc.2` 标签取回 renderer 未发布的 3 个源文件（bind.ts / scoped-slots.tsx / session-provider.tsx），vitest alias 把 `@deepseek-ai/dsh-client-ui-renderer/src/client` 指到本地副本（node_modules 下的 .ts 会被 Node 原生加载器拒绝剥离类型）。
   - `packages/ui-billing/tests/module-loader.setup.ts`：jsdom ModuleLoader 垫片——执行 DSH client bundle 的 factory，导出记录到 `window.__DSH_BUNDLE_EXPORTS__`；`require` 锚定 packages/ui-billing/node_modules；`dsh-client-ui-primitives` 用两个惰性组件桩（其 lib 导入 .module.css，原生 require 会崩）。
   - vitest `server.deps.inline`（正则，字符串模式在 Windows 上因 path.join 反斜杠不匹配）：inline test-runtime（否则其裸导入走原生 Node）与 ui-billing-primitives（CSS 导入）。
   - browser-plugin.client.spec.ts：SlotRegistry 从 **dsh-client-runtime** bundle 导出取（renderer bundle 只有 renderer 面）；locale 插件从 dsh-client-locale bundle 取。
   - ui-billing devDeps 增加：`@deepseek-ai/dsh-client-runtime`（spec 直接导入其 /client）、`use-sync-external-store`（fixture bind.ts 的导入）。
4. **renderer 补丁已移除**：上一轮用 pnpm patch 补 bind.ts 的方案被 fixtures+alias 完全取代（补丁本身无法解决类型剥离拒绝，且 store 重取有坑）；`patches/` 目录与 `pnpm-workspace.yaml` 的 patchedDependencies 已删除，lockfile 已重生成。

## 关键文件清单（本轮）
- 新增：packages/ui-billing/tests/module-loader.setup.ts、packages/ui-billing/tests/fixtures/renderer-src/client/{bind.ts,scoped-slots.tsx,session-provider.tsx}
- 修改：vitest.config.ts、pnpm-workspace.yaml、packages/ui-billing/package.json、packages/ui-billing/tests/browser-plugin.client.spec.ts、pnpm-lock.yaml
- 删除：patches/（renderer 补丁）

## 实际验证过的命令与结果
1. pnpm install：成功（3 个 workspace 包；typert-protocol 除外；dsh 依赖 0.1.1-rc.2）。
2. pnpm run test：**6 套件 / 83 用例全绿**（billing 15、projection 7、today-spend 15、balance 17、browser-plugin 9、balance-badge 20）。唯一杂音：vite 对 primitives 缺失 index.js.map 的 sourcemap 警告（无害）。
3. pnpm run build / typecheck / verify：全绿（typert host 清单归属正确）。

## 剩余步骤（按序）
1. git 提交本轮改动（建议信息：test: 修复 ui-billing 客户端测试栈并恢复 6 套件全绿）。
2. 发布（npm 登录态待处理）：
   - 先验证 `npm whoami`（或 `npm whoami --//registry.npmjs.org/:_authToken=<TOKEN>`，token 由用户提供，勿写入仓库）。
   - pnpm --filter @rayadesu/dsh-llm-billing publish --access public --no-git-checks
   - pnpm --filter @rayadesu/dsh-client-ui-billing publish --access public --no-git-checks
   - pnpm publish --access public --no-git-checks（根 bundle @rayadesu/dsh-billing，插件先于 bundle）。
   - 若触发 2FA OTP，需要用户提供验证码。
3. 升级 profile：dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing，再 pnpm dsh web 验证余额徽章。

## 注意事项
- 本机 deepseek-harness 源码为 0.1.2-alpha.1（超前于 npm 的 0.1.1-rc.2），插件按 npm 发布线 ^0.1.1-rc.2 构建；运行时 peers 由 dsh 安装回退解析。
- pnpm 11 默认开启 optimistic-repeat-install，`pnpm install --force` 会被短路为 "Already up to date"；需要强制重装时用 `pnpm install --force --optimistic-repeat-install=false`。
- 恢复工作前先 git status 核对，避免与后续改动混淆。
