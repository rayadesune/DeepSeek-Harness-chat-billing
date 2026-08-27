# HANDOFF — billing 插件 0.2.2 发布（暂停于 2026-08-28）

## 目标与进度
- 目标：修复 @rayadesu/dsh-llm-billing 的 TYPERT 清单包名归属错误，恢复独立构建，发布 0.2.2。
- 当前进度：源码改动全部完成；pnpm install / build / typecheck / verify 全绿；测试 37 个用例通过，3 个套件因上游 npm 发布缺陷待收尾；发布尚未执行（npm 登录未验证通过）。
- 本仓库当前所有改动均未提交 git；lib/ 是 gitignore 的构建产物。

## 已完成（源码仓库内）
- lib/ 两个包共 17 个文件的旧包名已批量改为 @rayadesu/dsh-llm-billing（typert.host.js 的 package/id/typeSymbol、remote-client、types、client.js 内嵌清单）。
- 三个包版本统一 0.2.2（根 bundle + 两个插件），peer 范围同步。
- 独立 workspace 构建：tsconfig.base*.json、tsconfig.host.json、tsconfig.client.json、tsdown.config.ts、vitest.config.ts、packages/tsdown.client.ts（clientBundle 辅助）、scripts/verify-packages.mjs（发布前校验 + prepublishOnly）。
- 依赖线统一为 npm 实际发布线 ^0.1.1-rc.2（next tag）；ui-billing 已从已删除的 dsh-client-runtime 适配到 cordis Context / dsh-session/types / dsh-client-ui-renderer / dsh-api-remotes。
- packages/typert-protocol：内嵌 @deepseek-ai/dsh-typert-protocol@0.1.1-rc.2 声明（生成器只认工作区内已注册协议包里的 Remote/TypertRemoteService）。
- README（双语）/ AGENTS/README.i18n.yaml 已同步更新。

## 实际验证过的命令与结果
1. pnpm install：成功（4 个 workspace 包，dsh 依赖 0.1.1-rc.2）。
2. pnpm run build：成功。typert 产物从源码重新生成：getTodaySpend 带 force?: boolean，sourceLocation 为 packages/llm-billing/src/* 真实路径；client.js 159.6 kB 重建。
3. pnpm run typecheck：通过。
4. pnpm run verify：通过（llm-billing host 清单归属正确）。
5. pnpm run test：37 个用例通过，3 个套件失败，原因与已做修复：
   - decorator 转换报错 → vitest.config.ts 已加 standardDecoratorPlugin（与 harness 同款）。
   - browser-plugin.client.spec.ts 缺 jsdom 声明 → 已加 // @vitest-environment jsdom。
   - @deepseek-ai/dsh-client-test-runtime@0.1.1-rc.2 从 npm 引入 @deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts，但 npm 上的 renderer 发布包不含 src（上游发布缺陷）→ 已用 pnpm patch 为 renderer 补上 bind.ts（patches/ 已生成，pnpm-lock.yaml 已记录 patchedDependencies），但补丁是否真正生效尚未最终验证。

## 剩余步骤（按序）
1. cd /Users/raya/Developer/DeepSeek-Harness-chat-billing && pnpm install（应用 renderer 补丁）&& pnpm run test，确认 6 个套件全绿。
2. 若 test-runtime 仍解析到未打补丁的 renderer：pnpm install --force 或清理 node_modules/.pnpm 后重装；仍不行则接受上游缺陷，把 packages/ui-billing/tests 从默认 test include 中排除（不推荐）。
3. （可选）git 提交本轮源码改动。
4. 发布（npm 登录态待处理）：
   - 之前 NODE_AUTH_TOKEN=... npm whoami 仍报 ENEEDAUTH；下一步尝试 npm whoami --//registry.npmjs.org/:_authToken=<TOKEN>（token 由用户提供，勿写入仓库）。
   - pnpm --filter @rayadesu/dsh-llm-billing publish --access public --no-git-checks
   - pnpm --filter @rayadesu/dsh-client-ui-billing publish --access public --no-git-checks
   - pnpm publish --access public --no-git-checks（根 bundle @rayadesu/dsh-billing，插件先于 bundle）。
   - 若触发 2FA OTP，需要用户提供验证码。
5. 升级 profile：dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing，再 pnpm dsh web 验证。

## 关键文件清单
- 新增：tsconfig.base.json / tsconfig.base.client.json / tsconfig.host.json / tsconfig.client.json / tsdown.config.ts / vitest.config.ts / packages/tsdown.client.ts / packages/typert-protocol/ / scripts/verify-packages.mjs / patches/
- 修改：package.json（根+两插件）、两个包 tsconfig.json、ui-billing src/client/index.ts + BalanceBadge.tsx + tests/browser-plugin.client.spec.ts、README.md/zh、AGENTS.md、README.i18n.yaml、pnpm-workspace.yaml、pnpm-lock.yaml

## 注意事项
- 本机 deepseek-harness 源码为 0.1.2-alpha.1（超前于 npm 的 0.1.1-rc.2），插件按 npm 发布线 ^0.1.1-rc.2 构建；运行时 peers 由 dsh 安装回退解析。
- 恢复工作前先 git status 核对，避免与后续改动混淆。
