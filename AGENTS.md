# AGENTS.md

DeepSeek-Harness-chat-billing 是 DeepSeek Harness 的计费插件仓库：在 Web 会话头部显示
DeepSeek 账户余额、本轮对话花费与今日花费。本仓库是插件的**唯一分发来源**——
deepseek-harness 官方仓库（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）
不含计费插件；插件曾短暂集成于本用户的 fork，现已回退到官方提交版本（`141eb6fef8`），
本仓库不再依赖任何 fork。

## 仓库布局

```
packages/llm-billing/    宿主插件 @rayadesu/dsh-llm-billing（/user/balance 传输、峰谷计价、billing Remote）
packages/ui-billing/     浏览器插件 @rayadesu/dsh-client-ui-billing（会话头部徽标与详情面板）
packages/typert-protocol/ 内嵌 Typert 协议声明（@deepseek-ai/dsh-typert-protocol@0.1.6-alpha.1 的 lib/types），构建期供 typert 生成器识别装饰器；刻意不在 pnpm workspace 内，让 @deepseek-ai/dsh-typert-protocol 从 npm 解析（内嵌副本只有声明，无运行时实现）。它没有自己的 node_modules——其中的 cordis 必须与 workspace 根解析到同一个副本，否则 `TypertRemoteService` 的 `Context` 会与插件源码的 `Context` 变成两个类型。
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
- **依赖以发布形态声明**：`@deepseek-ai/dsh-*` 依赖写 `^0.1.6-alpha.1`（对应官方 monorepo 当前发布基线，monorepo 内为 
  `workspace:^`）；本插件的三个包发布到 npm 的
  `@rayadesu` scope，直接 `dsh plugin add @rayadesu/...` 安装。
- **补客户端包漏声明的运行时依赖**：`dsh-client-store`（`zustand`/`immer`）与
  `dsh-client-ui-primitives`（markdown 视图栈：`mdast-util-*`、`micromark-*`、`shiki`、
  `katex`、`diff`、`anser`、`clsx`）把它们只声明为上游 devDependencies，产物却直接 import；
  发布 bundle 运行时由 dsh 安装提供，独立 workspace 的测试要自己解析，故在 `ui-billing`
  的 devDependencies 里按上游同版本范围补齐。dsh 依赖线升级后若测试报 `Cannot find package`，
  照此补即可。
- **typert codec 跨基线桥接（`scripts/typert-compat.mjs`）**：npm 上最新的
  `@deepseek-ai/dsh-typert-generator@0.1.6-alpha.1` 把 strict codec 生成为
  `{ mode, typeSymbol, schema }`，而 dsh checkout（HEAD，含 `perf(typert): materialize
  generated schemas on first use`）改成 `{ mode, typeSymbol, create() }`，其 `dsh-typert-loader`
  见不到 `create` 就拒绝注册（`... parameter codec has no create() factory`），宿主行随之
  启动失败、Web 启动页报 `1 entry did not activate`。两个读取方都不拒绝自己不读的字段，
  所以产物**两个字段都带**即可同时满足 checkout 与 npm alpha 线。该步骤挂在 `build:host`
  末尾（tsdown 之后），幂等；`verify` 检查 strict codec 数 == `create: () =>` 数。
  **改完与 typert 产物相关的代码务必走 `pnpm run build:host`，不要只跑 tsdown。**
- **workspace 关掉 pnpm 发布龄门槛**：`pnpm-workspace.yaml` 显式 `minimumReleaseAge: 0`。
  pnpm ≥11 默认 1 天门槛会把刚发布的 alpha 包挡在 lockfile 校验外，而校验阶段不认
  `minimumReleaseAgeExclude`（那是解析期自动追加的），本仓库又要紧跟 DSH alpha 基线。
- **密钥不进仓库**：`DEEPSEEK_API_KEY` 等一律由用户环境或凭据 seam 提供，仓库不含真实值。
- **README 双语**：每个 README 遵循 DSH 结构 `README.md`(EN) + `README.zh.md`(ZH) +
  `README.i18n.yaml`（记录两文件 git blob hash，改动后需更新）。
- **版本对齐**：根 bundle 与两个包统一版本号（当前 0.3.14），`pnpm-lock.yaml` 随依赖变更更新。
- **提交与发布流程**：见 `.agents/skills/dsh-release/SKILL.md` —— 阶段 A（改代码 → 按档位校验/打包 →
  本地 pack 安装 → 交用户验证）**不提交**，改动留在工作区；用户说「发布」进入阶段 B 才 bump 版本、
  **按类型分别提交**、推送、发 npm 与 GitHub Release。
- **成本纪律（省 token）**：一轮的开销 ≈ 请求数 × 当时上下文，所以按改动定档做事——文案/样式/注释这类
  微调只跑受影响用例、只重打并重装改动的那个包；工具输出只留尾巴（`Select-Object -Last/First N`、
  `git diff -U0`）；全套 `test`/`build`/`verify` 一轮只跑一次；同一批微调的文档与 hash 攒到定稿后一次补。
  细则见 `.agents/skills/dsh-release/SKILL.md` 的「成本纪律」。
- **文本规范**：LF 换行、文件末尾一个换行（`.editorconfig`/`.gitattributes` 已声明）。

## 常用命令

```sh
pnpm install   # 安装本仓库依赖（dsh-* 从 registry 解析）
pnpm run build # host + client 两个编译面（tsc + tsdown + typert 产物）
pnpm run test  # vitest
pnpm run verify # 发布前校验
dsh plugin --profile web add @rayadesu/dsh-billing @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing  # 安装进 DSH
```

**从零构建顺序是硬约束**：`ui-billing` 的浏览器半面（`tsconfig.client.json`）导入
`@rayadesu/dsh-llm-billing/remote`，其类型声明是 host 面 tsdown 生成的
`lib/typert.remote-client.d.ts`（gitignore，不入库）。所以干净 checkout 必须先跑
`pnpm run build:host`（tsc + tsdown 生成 typert 产物）再跑
`pnpm run typecheck` / `pnpm run build:client`；`pnpm run build` 本身已按
host → client 顺序封装，CI 亦按此顺序执行。

改动后至少校验 JSON/YAML 可解析，并更新受影响包的 README（双语都要）。
