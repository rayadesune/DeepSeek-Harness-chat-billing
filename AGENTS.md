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
- **不在本仓库构建**：tsconfig 依赖 deepseek-harness monorepo 布局
  （`tsconfig.base*.json`、vendor/ 引用），构建需在任意 deepseek-harness checkout 环境中
  进行（把两个包放入 `packages/llm/llm-billing` 与 `packages/client/ui-billing` 位置后
  构建），再把生成的 `lib/` 同步回本仓库对应包目录；`lib/` 已 gitignore，不进仓库。
- **依赖以发布形态声明**：`@deepseek-ai/dsh-*` 依赖写 `^0.1.0-rc.8`（npm `next` tag 上的
  发布形态，对应官方 monorepo 里的 `workspace:^`）；本插件的三个包发布到 npm 的
  `@rayadesu` scope，直接 `dsh plugin add @rayadesu/...` 安装。
- **密钥不进仓库**：`DEEPSEEK_API_KEY` 等一律由用户环境或凭据 seam 提供，仓库不含真实值。
- **README 双语**：每个 README 遵循 DSH 结构 `README.md`(EN) + `README.zh.md`(ZH) +
  `README.i18n.yaml`（记录两文件 git blob hash，改动后需更新）。
- **版本对齐**：根 bundle 与两个包统一版本号（当前 0.1.0-rc.10），`pnpm-lock.yaml` 随依赖变更更新。
- **文本规范**：LF 换行、文件末尾一个换行（`.editorconfig`/`.gitattributes` 已声明）。

## 常用命令

```sh
pnpm install   # 安装本仓库依赖（dsh-* 从 registry 解析）
dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing  # 安装进 DSH
```

改动后至少校验 JSON/YAML 可解析，并更新受影响包的 README（双语都要）。
