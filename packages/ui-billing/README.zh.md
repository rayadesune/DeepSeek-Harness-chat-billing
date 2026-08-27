# @rayadesu/dsh-client-ui-billing

[English](README.md) | 中文

Web 额度特性的归属方：向 `conversation.session.header.utilities` 贡献一个条目，自己挂载 `billing` Remote，通过 `billing/getBalance`、`billing/getSessionSpend` 与 `billing/getTodaySpend` 读取 DeepSeek 账户余额、本会话的计费花费与今日所有会话的计费花费，并在右上角渲染成一个标签框。该能力的宿主侧在 [`dsh-llm-billing`](../llm-billing/README.md)，它拥有 `/user/balance` 传输、峰谷计价表与 `billing` Remote 命名空间；本包挂载那个 Remote 并渲染它返回的内容。

触发器显示两行——剩余额度与本轮对话的计费花费（「本轮对话花费 ¥X」）——首个请求在途时不渲染任何东西。点击后展开一个标签框：剩余金额、本会话的计费花费（本会话花费，按官方峰/谷单价逐条消息计价——高峰窗口仅周一至周五适用，周末按低谷价——右侧并列今日所有会话的合计「今日共花费」）、每个模型一行的花费及其缓存命中/未命中输入/输出分项（「缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z」）、手动刷新按钮与花费说明。刷新时旧值不消失，刷新失败保留上一次有效值。没有可计价消耗的会话或日子显示「暂无消耗记录」而不是编造数字。失败——未配置 API key、凭据被拒绝、传输错误——渲染弱化的「额度不可用」，其提示携带 Remote 自己的错误信息。

角标是账户级的，尽管插槽是会话作用域：顶栏工具行不过是外壳提供的那个始终可见的标题栏席位，余额并不随会话变化——但花费行会，因为它通过 `billing/getSessionSpend` 按当前会话自己的 token 用量计价、通过 `billing/getTodaySpend` 按所有会话的用量计价。文案走本包自己的 `billing` locale 命名空间；样式只用 token。

## 数据更新机制

花费跟随会话、额度保持手动快照：

- **花费随新消息自动更新（去抖）** —— 组件通过框架 `useSession` 座位订阅当前会话的消息数。每到达一条新消息，就只重算**本会话的花费**（`billing/getSessionSpend`）与**今日共花费**（`billing/getTodaySpend`，纯本地计价、不发网络请求），连续对话时花费行实时跟随。重算有 2 秒去抖，消息突发（流式 agent 回合）只计价一次；宿主侧缓存（见 `dsh-llm-billing`）随后在一分钟内服务首次未命中。
- **额度保持手动** —— 账户余额在挂载、切换会话、点刷新按钮时拉取（`billing/getBalance`）。**没有轮询、不会自动重拉**：余额行只在这几个时机变化。
- **刷新保留旧值** —— 刷新在途时旧值留在屏幕上，刷新失败保留上一次有效值，不清空。刷新按钮调用 `billing/getTodaySpend(true)`，绕过宿主侧缓存；消息触发的重算与挂载/切换会话的读取走缓存路径。

## 模型体验

无，因为本包为人类渲染账户级的 provider 事实，不触及 prompt、消息、schema、流或工具结果。模型对 provider 额度的视角仍在 [`dsh-llm`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/llm/llm) 在请求失败时抛出的 `QUOTA` / `INVALID_CREDENTIAL` 错误码里。

#### KV Cache effect

无；本包从不组装或发送 provider 请求，它唯一的 RPC 是一次带凭据的账户读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **只取首条余额线** —— 余额读取主要（`balance_infos[0]`）币种行；其它币种行不显示。
- **额度不自动跟随** —— 余额保持手动快照（无轮询）：其他客户端产生的消耗不会让界面数值自动变化，需手动刷新或刷新浏览器。
