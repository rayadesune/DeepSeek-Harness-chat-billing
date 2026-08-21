# AGENTS.md

DeepSeek-Harness-chat-billing 是 DeepSeek Harness 的计费插件仓库：在 Web 会话头部显示
DeepSeek 账户余额、本轮对话花费与今日共花费。本仓库是源码镜像/分发页，插件主场在
deepseek-harness fork 的 `packages/llm/llm-billing` 与 `packages/client/ui-billing`
（作为 workspace 成员随 monorepo 构建、由 `@deepseek-ai/dsh-web-app` bundle 挂载）。

## 仓库布局

```
packages/llm-billing/    宿主插件 @deepseek-ai/dsh-llm-billing（/user/balance 传输、峰谷计价、billing Remote）
packages/ui-billing/     浏览器插件 @deepseek-ai/dsh-client-ui-billing（会话头部徽标与详情面板）
cordis.patch.yml         DSH profile bundle 补丁层：挂载 llm-billing + ui-billing 两个插件行
```

## DSH 集成方式

- **fork 内置（开发推荐）**：插件在 deepseek-harness fork 中是 workspace 成员，
  由 `@deepseek-ai/dsh-web-app` bundle 挂载。**使用 fork 时不要再把本仓库 bundle 装进
  同一 profile**，否则 `llm-billing` / `ui-billing` 插件行会重复注册。
- **bundle（独立安装推荐）**：根 `package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml`
  挂载两个插件行。安装：`dsh plugin --profile web add <本仓库路径>`（需先在 fork checkout
  构建好 `lib/`，并在此仓库执行过 `pnpm install`，见 README）。
- **手动**：把 `cordis.patch.yml` 的 insert 合并进 `$DSH_HOME/profiles/<name>/cordis.patch.yml`。

## 约定

- **源文件以上游为准**：`packages/*/src` 与 `tests/` 镜像 deepseek-harness fork 的
  `packages/llm/llm-billing` 与 `packages/client/ui-billing`；改动在 fork 里做，再同步回来。
- **不在本仓库构建**：tsconfig 依赖 monorepo 布局（`tsconfig.base*.json`、vendor/），
  构建在 fork checkout 里进行；`lib/` 是构建产物，已 gitignore，不进仓库。
- **依赖以发布形态声明**：`@deepseek-ai/dsh-*` 依赖写 `^0.1.0-rc.8`（npm `next` tag 上的
  发布形态，对应 fork 里的 `workspace:^`）；本插件的两个包未发布到 npm，只能本地路径安装。
- **密钥不进仓库**：`DEEPSEEK_API_KEY` 等一律由用户环境或凭据 seam 提供，仓库不含真实值。
- **README 双语**：每个 README 遵循 DSH 结构 `README.md`(EN) + `README.zh.md`(ZH) +
  `README.i18n.yaml`（记录两文件 git blob hash，改动后需更新）。
- **版本对齐**：根 bundle 与两个包统一版本号（当前 0.1.0-rc.8），`pnpm-lock.yaml` 随依赖变更更新。
- **文本规范**：LF 换行、文件末尾一个换行（`.editorconfig`/`.gitattributes` 已声明）。

## 常用命令

```sh
pnpm install                              # 安装本仓库依赖（dsh-* 从 registry 解析）
dsh plugin --profile web add <本仓库路径>  # 以 bundle 安装进 DSH profile
```

改动后至少校验 JSON/YAML 可解析，并更新受影响包的 README（双语都要）。
