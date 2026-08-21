# @rayadesu/dsh-llm-billing

[English](README.md) | 中文

独立的宿主插件，把 DeepSeek 账户余额与会话花费变成 `billing` Remote。它拥有 `/user/balance` 传输、峰谷计价表与每会话的计费花费计价，因此部署可以在不把这个能力与聊天补全适配器耦合的前提下，展示「还剩多少、这个会话花了多少」。浏览器侧是 [`dsh-client-ui-billing`](../ui-billing/README.md)。

## 安装

把插件加进组合（一个 `cordis.yml` 行）并给它一个凭据。它先从凭据 seam（或 `apiKeyEnv` 指定的环境变量）解析 API key，再从 `baseURL`、其次 `$DEEPSEEK_BASE_URL`、最后公共 API 解析端点。

```yaml
- id: llm-billing
  name: '@rayadesu/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

插件注册 `billing` Remote，含三个方法：`getBalance()`（解析后的 `/user/balance` 快照）、`getSessionSpend(sessionId)`（单个会话的计费花费）与 `getTodaySpend()`（当前北京时间自然日内所有会话的计费花费合计）。会话花费把每条 `assistant/message` 事件的计费 token（缓存命中输入、含缓存写入的未命中输入、含推理的输出）按事件自身发生时刻（北京时间）所在的峰/谷单价计价，再按模型汇总。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4 Flash + V4 Pro + V4 Flash Vision Exp | 展示用的模型行，按展示顺序。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京） | 高峰时段窗口；其余时段为低谷。 |
| `billing.models` | 官方 V4 费率 | 每个模型的峰/谷单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token）。 |

只想覆盖某个模型而不丢其它，就提供一个非空的 `billing.models` 列表；空或省略则回退到官方默认费率。

## 模型体验

无，因为本包是 provider 与会话事实的只读 Remote 投影，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；它唯一的 provider 调用是一次带凭据的 `/user/balance` 读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **有费率行才计价** —— 会话花费与今日花费只统计价目表（`billing.models`）里有的模型；没有费率行的模型不计入。
- **按需读取** —— 会话花费在每次调用时读取该会话的完整事件日志，而非维护增量聚合，因此成本随单会话日志大小增长；`getTodaySpend()` 会读取每个会话的日志，日志无法读取的会话带警告跳过，而不是让整日合计失败。
