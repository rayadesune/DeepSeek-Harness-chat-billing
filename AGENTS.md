# AGENTS.md

DeepSeek-Harness-chat-billing 是 DeepSeek Harness 的计费插件仓库：在 Web 会话头部显示
DeepSeek 账户余额、本轮对话花费与今日共花费。本仓库是插件的**唯一分发来源**——
deepseek-harness 官方仓库（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）
不含计费插件；插件曾短暂集成于本用户的 fork，现已回退到官方提交版本（`141eb6fef8`），
本仓库不再依赖任何 fork。

## 仓库布局

```
packages/llm-billing/    宿主插件 @rayadesu/dsh-llm-billing（/user/balance 传输、峰谷计价、billing Remote）
packages/ui-billing/     浏览器插件 @rayadesu/dsh-client-ui-billing（会话头部徽标与详情面板）
packages/typert-protocol/ 内嵌 Typert 协议声明（@deepseek-ai/dsh-typert-protocol@0.1.1-rc.2 的 lib/types），构建期供 typert 生成器识别装饰器；刻意不在 pnpm workspace 内，让 @deepseek-ai/dsh-typert-protocol 从 npm 解析（内嵌副本只有声明，无运行时实现）
cordis.patch.yml         DSH profile bundle 补丁层：挂载 llm-billing + ui-billing 两个插件行
```

## DSH 集成方式

- **bundle（推荐）**：根 `package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml`
  挂载两个插件行。三个包已发布到 npm（`@rayadesu` scope），pnpm 不会把 bundle 的
  本地依赖装进 profile，所以一条命令同时安装 bundle 与两个包（让行名能从 profile 的
  node_modules 解析）：

  ```sh
  dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing
  ```
- **手动**：把 `cordis.patch.yml` 的 insert 合并进 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，
  并用 `dsh plugin --profile <name> add @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  安装两个包（行名解析同上）。

## 约定

- **源文件以本仓库为准**：`packages/*/src` 与 `tests/` 没有上游 fork，改动直接在本仓库进行。
- **本仓库独立构建**：本仓库是独立 pnpm workspace，tsconfig 只依赖仓库根的
  `tsconfig.base*.json`，`@deepseek-ai/*` peer 包从 npm 解析。`pnpm run build`
  依次跑 host/client 两个编译面：`tsc -b` 产出 `lib/types`，tsdown 产出
  `lib/index.js`/`lib/invariant.js`，typert 生成器按 package.json 的 name 重新生成
  `lib/typert.host.js` 与 `lib/typert.remote-client.*`，client 面重建 `lib/client.js`。
  `lib/` 仍是 gitignore 的构建产物，不进仓库。
- **发布前校验**：`pnpm run verify`（每个包 `prepublishOnly` 自动运行）检查
  `lib/typert.host.js` 的 `TYPERT.package` 必须等于导出它的包名，且 lib 中不得残留
  其他包名的清单；失败即禁止发布。
- **依赖以发布形态声明**：`@deepseek-ai/dsh-*` 依赖写 `^0.1.1-rc.2`（对应官方 monorepo 当前发布基线，monorepo 内为 
  `workspace:^`）；本插件的三个包发布到 npm 的
  `@rayadesu` scope，直接 `dsh plugin add @rayadesu/...` 安装。
- **密钥不进仓库**：`DEEPSEEK_API_KEY` 等一律由用户环境或凭据 seam 提供，仓库不含真实值。
- **README 双语**：每个 README 遵循 DSH 结构 `README.md`(EN) + `README.zh.md`(ZH) +
  `README.i18n.yaml`（记录两文件 git blob hash，改动后需更新）。
- **版本对齐**：根 bundle 与两个包统一版本号（当前 0.2.3），`pnpm-lock.yaml` 随依赖变更更新。
- **文本规范**：LF 换行、文件末尾一个换行（`.editorconfig`/`.gitattributes` 已声明）。

## 常用命令

```sh
pnpm install   # 安装本仓库依赖（dsh-* 从 registry 解析）
pnpm run build # host + client 两个编译面（tsc + tsdown + typert 产物）
pnpm run test  # vitest
pnpm run verify # 发布前校验
dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing  # 安装进 DSH
```

改动后至少校验 JSON/YAML 可解析，并更新受影响包的 README（双语都要）。
