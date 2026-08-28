# @rayadesu/dsh-client-ui-billing

[English](README.md) | 中文

Web 额度特性的归属方：向 `conversation.session.header.utilities` 贡献一个条目，自己挂载 `billing` Remote，通过 `billing/getBalance`、`billing/getSessionSpend`、`billing/getTodaySpend`、`billing/getTodaySessionsSpend` 与 `billing/getTurnSpend` 读取 DeepSeek 账户余额、本会话的计费花费、今日所有会话的计费花费、今日按会话的排行与单个回合的花费，并在右上角渲染成一个标签框。该能力的宿主侧在 [`dsh-llm-billing`](../llm-billing/README.md)，它拥有 `/user/balance` 传输、峰谷计价表与 `billing` Remote 命名空间；本包挂载那个 Remote 并渲染它返回的内容。

触发器显示两行——剩余额度与本轮对话的计费花费（「本轮对话花费 ¥X」）——首个请求在途时不渲染任何东西。点击后展开一个标签框：剩余金额、本会话的计费花费（本会话花费，按官方峰/谷单价逐条消息计价——高峰窗口仅周一至周五适用，周末按低谷价——右侧并列今日所有会话的合计「今日共花费」）、每个模型一行的花费及其缓存命中/未命中输入/输出分项（「缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z」）、手动刷新按钮与花费说明。剩余金额行（`API 剩余金额`）字号大于下方花费行。模型行下方是**今日会话花费排行**（`今日会话花费`）：按今日花费从高到低排列的会话列表，每行以右对齐的名次列开头，后接与花费分项相同的小圆点分隔符（「·」，字号、色调与间距一致），再是会话的持久标题（重命名自动同步），最后是金额——标题在名次列后缩进对齐；最多渲染 `SESSION_RANKING_LIMIT`（10）行，其余以「…还有 N 个会话」提示。刷新时旧值不消失，刷新失败保留上一次有效值。没有可计价消耗的会话或日子显示「暂无消耗记录」而不是编造数字。失败——未配置 API key、凭据被拒绝、传输错误——渲染弱化的「额度不可用」，其提示携带 Remote 自己的错误信息。

本包还贡献**本轮花费条目**（`billing-turn-cost`，order 20）到 ui-chat 的 `conversation.chat.assistant-actions` list slot——与 `ui-message-feedback` 同一条操作条，多条目共存；条目经 CSS `order: -1` 排到操作行**最前**（复制按钮之前）。对每条已完成回合的收尾助手消息，条目通过 `billing/getTurnSpend` 读取花费（按会话 + 消息 memo，回合落定后不再变化），渲染「本轮花费 ¥X」——「本轮花费」用卡片标题色、金额用卡片摘要色，**始终显示**（悬停规则只作用于时钟文本）。回合没有 DeepSeek 用量（花费为 0）或加载失败时不渲染，Remote 故障不会污染操作行。

角标是账户级的，尽管插槽是会话作用域：顶栏工具行不过是外壳提供的那个始终可见的标题栏席位，余额并不随会话变化——但花费行会，因为它通过 `billing/getSessionSpend` 按当前会话自己的 token 用量计价、通过 `billing/getTodaySpend` 按所有会话的用量计价。文案走本包自己的 `billing` locale 命名空间；样式只用 token。

## 数据更新机制

花费跟随会话、额度保持手动快照：

- **花费随回合结束自动更新（去抖）** —— 组件通过框架 `useSession` 座位订阅当前会话的「运行中」标志。每当一轮 prompt 回合结束（标志翻回空闲），就只重算**本会话的花费**（`billing/getSessionSpend`）、**今日共花费**（`billing/getTodaySpend`）与**排行**（`billing/getTodaySessionsSpend`，纯本地计价、不发网络请求），连续对话时花费行实时跟随。重算有 2 秒去抖，回合突发（agent 连续多轮）只计价一次；宿主侧缓存（见 `dsh-llm-billing`）随后在一分钟内服务首次未命中。
- **额度保持手动** —— 账户余额在挂载、切换会话、点刷新按钮时拉取（`billing/getBalance`）。**没有轮询、不会自动重拉**：余额行只在这几个时机变化。
- **刷新保留旧值** —— 刷新在途时旧值留在屏幕上，刷新失败保留上一次有效值，不清空。刷新按钮调用 `billing/getTodaySpend(true)` 与 `billing/getTodaySessionsSpend(true)`，绕过宿主侧缓存；回合结束触发的重算与挂载/切换会话的读取走缓存路径。

## 模型体验

无，因为本包为人类渲染账户级的 provider 事实，不触及 prompt、消息、schema、流或工具结果。模型对 provider 额度的视角仍在 [`dsh-llm`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm) 在请求失败时抛出的 `QUOTA` / `INVALID_CREDENTIAL` 错误码里。

#### KV Cache effect

无；本包从不组装或发送 provider 请求，它唯一的 RPC 是一次带凭据的账户读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **只取首条余额线** —— 余额读取主要（`balance_infos[0]`）币种行；其它币种行不显示。
- **排行上限 10** —— 面板最多显示 `SESSION_RANKING_LIMIT` 个会话，其余以「…还有 N 个会话」提示。
- **本轮花费需要已定稿的收尾消息** —— 中断的回合没有操作行，不显示本轮花费。
- **额度不自动跟随** —— 余额保持手动快照（无轮询）：其他客户端产生的消耗不会让界面数值自动变化，需手动刷新或刷新浏览器。
