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
packages/typert-protocol/ 内嵌 Typert 协议声明（@deepseek-ai/dsh-typert-protocol@0.2.0-rc.1 的 lib/types），构建期供 typert 生成器识别装饰器；刻意不在 pnpm workspace 内，让 @deepseek-ai/dsh-typert-protocol 从 npm 解析（内嵌副本只有声明，无运行时实现）。它没有自己的 node_modules——其中的 cordis 必须与 workspace 根解析到同一个副本，否则 `TypertRemoteService` 的 `Context` 会与插件源码的 `Context` 变成两个类型。
cordis.patch.yml         DSH profile bundle 补丁层：挂载 llm-billing + ui-billing 两个插件行
```

## DSH 集成方式

- **bundle（推荐）**：根 `package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml`
  挂载两个插件行。三个包已发布到 npm（`@rayadesu` scope）。bundle 把两个插件包声明为
  普通 `dependencies`（官方组合包同款；profile 初始化为 `nodeLinker: hoisted` +
  `autoInstallPeers: false`——peer 不会进 profile，组件包必须是 dependencies 才会随
  bundle 装入并 hoist 到 profile 根、让行名从 node_modules 解析），所以单个包名即可装全：

  ```sh
  dsh plugin --profile web add @rayadesu/dsh-billing
  ```

  Web 官方安装方式用同一个包名：侧栏 插件 → 添加插件 → 输入 `@rayadesu/dsh-billing`
  （安装源可选默认源或中国大陆镜像源）。**对外只承诺这一种**：对话框虽然也收 GitHub 地址、
  本地目录与 `.tgz` 路径，但多包下前两者装不全，见「约定」里的实测说明。
- **手动**：把 `cordis.patch.yml` 的 insert 合并进 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，
  并用 `dsh plugin --profile <name> add @rayadesu/dsh-llm-billing @rayadesu/dsh-client-ui-billing`
  安装两个包（行名解析同上）。

## 约定

- **源文件以本仓库为准**：`packages/*/src` 与 `tests/` 没有上游 fork，改动直接在本仓库进行。
- **本仓库独立构建**：本仓库是独立 pnpm workspace，tsconfig 只依赖仓库根的
  `tsconfig.base*.json`，`@deepseek-ai/*` peer 包从 npm 解析。`pnpm run build`
  依次跑 host/client 两个编译面：`tsc -b` 产出 `lib/types`，tsdown 产出
  `lib/index.js`/`lib/invariant.js`，typert 生成器按 package.json 的 name 重新生成
  `lib/typert.host.js` 与 `lib/typert.remote-client.*`，client 面重建 `lib/client.js`，
  末尾 `scripts/normalize-lib-paths.mjs` 把 client bundle 里 `\0dsh-css:` 区域注释的
  绝对路径削成文件名（见下条）。
- **分发只有 npm；下面几条只解释 dev 验证为什么用 tarball（2026-09-29 实测）**：DSH 的执行模型是
  `pnpm add <spec>` 之后按 `cordis.patch.yml` 里的**行名**去 profile 的 `node_modules`
  解析包。pnpm 对 **`link:`（本地目录）与 git/GitHub 依赖不装其嵌套依赖**（最小复现：
  一个只有 `is-odd` 一个注册表依赖的 bundle，链进消费方后 `is-odd` 同样没被装），
  于是 bundle 声明的两个组件包永远不会落进 profile：
  - **npm**：`pnpm add @rayadesu/dsh-billing` → 解出 tarball，pnpm 当**真实安装**处理，
    组件包随依赖解析一起装 → ✅ 可用；
  - **tarball**：`pnpm add <pkg.tgz>`（绝对路径）→ 同样是真实安装，解包后照常解析
    `dependencies` → ✅ 可用，**但三个 tarball 必须一次 `add`**：根 bundle 的组件依赖是
    registry 区间，单独重装根包会从 npm 取组件包，工作区代码静默不进 profile。
    这是**阶段 A 的 dev 验证方式**（`node scripts/local-install.mjs all --check <marker>`），
    不作为对外分发方式；
  - **本地目录**：`pnpm add <绝对路径>` → `link:`，只有根软链进 `node_modules` → ❌；
  - **GitHub**：`pnpm add git+…` → 实测同样只得到根包，组件包缺失 → ❌。
  两种失败形态一致：启动报 `2 entries did not activate llm-billing … failed to import`。
  本地目录仍可用 CLI 的**三目录一次给全**绕开（`dsh plugin --profile <name> add <仓库根>
  <packages/llm-billing> <packages/ui-billing>`），但 GUI 只收一个 spec，做不到；
  GitHub 目前无解（官方文档建议 git 安装靠 `prepare` 构建，但 pnpm 11.7.0 实测不执行
  git 依赖的 `prepare`，故产物必须入库）。**要这些来源都通必须改 DSH**：让 bundle 能声明
  「我由哪些包组成，一起装」，或安装后按 patch 的 `name` 逐个解析依赖包。
- **`lib/` 构建产物进仓库**：三个包的 `lib/` 由 `.gitignore` 白名单放行、随源码一起提交。
  原因是 **git-Hosted 安装没有构建步骤**——pnpm 对 git-hosted 依赖**不执行 `prepare`**
  （2026-09-29 实测：连显式在 `prepare` 里跑 pnpm install 也不触发），产物必须已经在
  仓库里；本地目录安装（`link:`）也直通工作区的 `lib/`。代价是每轮改完源码**必须重跑
  `pnpm run build` 并提交重新生成的 `lib/`**，否则拿到的是旧产物。
  `build`/`verify` 末尾的 `scripts/normalize-lib-paths.mjs` 幂等，把构建机绝对路径
  从产物里去掉，否则每台机器构建出的字节都不同。
- **发布前校验**：`pnpm run verify`（每个包 `prepublishOnly` 自动运行）先归一化产物路径，
  再检查 `lib/typert.host.js` 的 `TYPERT.package` 必须等于导出它的包名，且 lib 中不得残留
  其他包名的清单；失败即禁止发布。
- **依赖以发布形态声明**：`@deepseek-ai/dsh-*` 依赖写 `^0.2.0-rc.1`（对应官方 monorepo 当前发布基线，monorepo 内为 
  `workspace:^`）；本插件的三个包发布到 npm 的
  `@rayadesu` scope，直接 `dsh plugin add @rayadesu/...` 安装。
- **补客户端包漏声明的运行时依赖**：`dsh-client-store`（`zustand`/`immer`）与
  `dsh-client-ui-primitives`（markdown 视图栈：`mdast-util-*`、`micromark-*`、`shiki`、
  `katex`、`diff`、`anser`、`clsx`、`simple-icons`）、`dsh-client-web`
  （`dsh-client-ui-dockkit`）把它们只声明为上游 devDependencies（或干脆不声明），产物却直接
  import；发布 bundle 运行时由 dsh 安装提供，独立 workspace 的测试要自己解析，故在
  `ui-billing` 的 devDependencies 里按上游同版本范围补齐。dsh 依赖线升级后若测试报
  `Cannot find package`，照此补即可。
- **typert codec 的 create 工厂（`scripts/typert-compat.mjs`）**：DSH 的 `dsh-typert-loader`
  要求每个 strict codec 带 `create` 工厂，见不到就拒绝注册
  （`... parameter codec has no create() factory`），宿主行随之启动失败、Web 启动页报
  `1 entry did not activate`。自 0.1.7-alpha.2 起 generator 原生产出 `create: schema`，
  构建产物直接可用；`scripts/typert-compat.mjs` 降级为安全网（幂等，遇无 create 的 codec
  或未知形状即非零退出，防 generator 回退）。该步骤挂在 `build:host` 末尾（tsdown 之后）；
  `verify` 按 codec 块检查每个块都带 `create`（逐行计数会误伤清单里 `TYPERT.schemas`
  的 `create` 条目）。
  **改完与 typert 产物相关的代码务必走 `pnpm run build:host`，不要只跑 tsdown。**
- **workspace 关掉 pnpm 发布龄门槛**：`pnpm-workspace.yaml` 显式 `minimumReleaseAge: 0`。
  pnpm ≥11 默认 1 天门槛会把刚发布的 alpha 包挡在 lockfile 校验外，而校验阶段不认
  `minimumReleaseAgeExclude`（那是解析期自动追加的），本仓库又要紧跟 DSH alpha 基线。
- **DSH 依赖线升级 checklist**：`@deepseek-ai/dsh-*` 全线对齐同一基线（`llm-billing` 的 peer+dev、`ui-billing`
  的 peer+dev、根的 devDependencies 三处一起改）。升级按序做：① 改三处版本号 → ② `pnpm install` 刷
  lockfile（本仓库已关发布龄门槛）→ ③ `pnpm run build`（顺带确认 typert generator 仍产出 `create` 工厂，
  没产出时 `scripts/typert-compat.mjs` 会非零退出）→ ④ `pnpm run test`；⑤ 若测试报 `Cannot find package`，
  按上一条「补漏声明依赖」补进 `ui-billing` 的 devDependencies。
- **密钥不进仓库**：`DEEPSEEK_API_KEY` 等一律由用户环境或凭据 seam 提供，仓库不含真实值。
- **README 双语**：每个 README 遵循 DSH 结构 `README.md`(EN) + `README.zh.md`(ZH) +
  `README.i18n.yaml`（记录两文件 git blob hash，改动后需更新）。
- **版本对齐**：根 bundle 与两个包统一版本号（当前 0.3.18），`pnpm-lock.yaml` 随依赖变更更新。
- **提交与发布流程**：见 `.agents/skills/dsh-release/SKILL.md` —— 阶段 A（改代码 → 按档位校验 →
  `node scripts/local-install.mjs all --check <marker>` 装进 profile → 交用户验证）**不提交**，
  改动留在工作区；用户说「发布」进入阶段 B 才 bump 版本、**按类型分别提交**、推送、发 npm 与
  GitHub Release。
- **浮动说明卡一律用 `HoverCard`，不要用 `Tooltip`**：两者形态不同 —— `Tooltip` 是「单行短标签」容器
  （`padding: 3px 7px` 的 26px 条带、`pointer-events: none`、`label` 只收 `string`），官方自己那颗信息按钮
  装的是 ~50 字 / 2–3 行；把 4 行说明硬塞进去会渲染成一整块贴边白字方块，版本号跟正文同权重，且球泡用的是
  13px 纯白 `--dsw-static-neutral-bluish-00`，比面板里任何一行都重。**超过两行的说明就是 `HoverCard` 的活**：
  `content` 收 JSX（可做 secondary/tertiary 分层）、指针能停留可选中（长文本才读得了）、并且**自带 portal**。
  选 `inline` 变体（`display: inline`，进得了行盒；支持 focus-visible 打开 + Esc 关闭；placement 会夹进视口）——
  `compact` 把卡片放在锚点**右侧**，贴右上角的按钮必然溢出屏幕，且它的定位分支根本没有水平边界检查；
  `preview` 需要 `widthAnchorRef` 提供的宽度锚，得让纯展示组件持 ref。
- **面板的 CSS 变量到不了 portaled 卡片**：`.panel` 上定义的 `--billing-type-*` 自定义属性进
  `document.body` 上的悬浮层就失效了，卡片要用到同款层级必须把值重抄一遍并在注释里写清两边要手动对齐。
- **成本纪律（省 token）**：一轮的开销 ≈ 请求数 × 当时上下文，所以按改动定档做事——文案/样式/注释这类
  微调只跑受影响用例、只重打并重装改动的那个包；工具输出只留尾巴（`Select-Object -Last/First N`、
  `git diff -U0`）；全套 `test`/`build`/`verify` 一轮只跑一次；同一批微调的文档与 hash 攒到定稿后一次补。
  细则见 `.agents/skills/dsh-release/SKILL.md` 的「成本纪律」。
- **文本规范**：LF 换行、文件末尾一个换行（`.editorconfig`/`.gitattributes` 已声明）。

## 常用命令

```sh
pnpm install   # 安装本仓库依赖（dsh-* 从 registry 解析）
pnpm run build # host + client 两个编译面（tsc + tsdown + typert 产物 + 路径归一化；产物 lib/ 随后提交）
pnpm run test  # vitest
pnpm run verify # 发布前校验
node scripts/local-install.mjs all --check <marker>  # 阶段 A：build + 三包 pack + 三包一次 add + 核对
dsh plugin --profile web add @rayadesu/dsh-billing  # 从 npm 装进 DSH（bundle 依赖带齐两个插件包）
```

**从零构建顺序是硬约束**：`ui-billing` 的浏览器半面（`tsconfig.client.json`）导入
`@rayadesu/dsh-llm-billing/remote`，其类型声明是 host 面 tsdown 生成的
`lib/typert.remote-client.d.ts`（构建产物，已随 `lib/` 入库，但干净 checkout 仍要按序重建）。所以干净 checkout 必须先跑
`pnpm run build:host`（tsc + tsdown 生成 typert 产物）再跑
`pnpm run typecheck` / `pnpm run build:client`；`pnpm run build` 本身已按
host → client 顺序封装，CI 亦按此顺序执行。

改动后至少校验 JSON/YAML 可解析，并更新受影响包的 README（双语都要）。
