# @deepseek-ai/dsh-llm-billing

[English](README.md) | 中文

独立的宿主插件，把 DeepSeek 账户余额与按模型的剩余任务估算变成 `billing` Remote。它拥有 `/user/balance` 传输、跨会话按模型的 token 折叠，以及峰谷计价表，因此部署可以在不把这个估算与聊天补全适配器耦合的前提下，展示「还剩多少、大概还能跑几个任务」。浏览器侧是 [`dsh-client-ui-billing`](../../client/ui-billing/README.md)。

## 安装

把插件加进组合（一个 `cordis.yml` 行）并给它一个凭据。它先从凭据 seam（或 `apiKeyEnv` 指定的环境变量）解析 API key，再从 `baseURL`、其次 `$DEEPSEEK_BASE_URL`、最后公共 API 解析端点。

```yaml
- id: llm-billing
  name: '@deepseek-ai/dsh-llm-billing'
  config:
    # apiKeyEnv: DEEPSEEK_API_KEY   # default
    # baseURL: https://api.deepseek.com
```

插件注册 `billing` Remote，含两个方法：`getBalance()`（解析后的 `/user/balance` 快照）与 `getEstimate()`（余额加每个已配置模型的一条剩余任务估算）。估算是换算，不是计费承诺：用人民币余额除以每个模型的历史「每会话平均计费 token × 当前峰/谷单价」。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4 Flash + V4 Pro | 展示用的模型行，按展示顺序。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京） | 高峰时段窗口；其余时段为低谷。 |
| `billing.models` | 官方 V4 费率 | 每个模型的峰/谷单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token）。 |

只想覆盖某个模型而不丢其它，就提供一个非空的 `billing.models` 列表；空或省略则回退到官方默认费率。

## 模型体验

无，因为本包是 provider 与会话事实的只读 Remote 投影，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache effect

无；它唯一的 provider 调用是一次带凭据的 `/user/balance` 读取，不落在 provider 的 KV 缓存里。

## 已知限制与暂缓事项

- **仅人民币** —— 估算读取人民币余额行，非人民币余额返回 null。多币种换算暂缓。
- **会话粒度平均** —— 一个「任务」= 一次会话；一个会话里切换模型时，会分别计入它实际调用过的每个模型。平均是每会话口径，不是声明的任务成本。
- **按需折叠** —— 估算在每次调用时折叠所有可达会话，而非维护增量聚合，因此成本随会话数与日志大小增长。
