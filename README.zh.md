# DeepSeek Harness 计费插件

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，在 Web 会话头部直接显示你的 **DeepSeek 账户余额**，以及**大概还能跑多少个任务**。

> 余额是 `GET /user/balance` 的真实数字；「还能跑多少任务」是估算值，不是计费承诺。

## 显示什么

- **会话头部徽标** —— 剩余余额（`剩余额度：¥X`）加上「按当前模型预计还能跑多少任务」。
- **详情面板** —— 每个模型一行：还能跑多少任务，或「暂无消耗记录」/「按消耗能跑不足 1 个任务，该充钱了」。
- **刷新** —— 按需重新拉取余额并重新折叠用量。

## 包结构

| 包 | 侧 | 作用 |
| --- | --- | --- |
| [`packages/llm-billing`](packages/llm-billing) —— `@deepseek-ai/dsh-llm-billing` | 主机端 | 负责 `/user/balance` 传输、跨会话的每模型 token 折叠、峰/谷计价表。对外暴露 `billing` Remote（`getBalance`、`getEstimate`）。 |
| [`packages/ui-billing`](packages/ui-billing) —— `@deepseek-ai/dsh-client-ui-billing` | 浏览器端 | 自己挂载 `billing` Remote，并贡献会话头部徽标。 |

## 前置条件

- **DeepSeek Harness**（`dsh`）—— 插件运行在 dsh profile 内。
- **一个 DeepSeek API key** —— 余额从 DeepSeek API 读取，所以每个用户都需要自己的 key。

## 安装

把两个包装进 profile、接进组合、再配好 key。

### 1. 安装包

```bash
dsh plugin --profile web add @deepseek-ai/dsh-llm-billing @deepseek-ai/dsh-client-ui-billing
```

> 在包发布到 npm 之前，先从本仓库安装：
> `dsh plugin --profile web add github:<owner>/DeepSeek-Harness-billing-plugin`。

### 2. 接进组合

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: llm-billing
      name: '@deepseek-ai/dsh-llm-billing'
    - id: ui-billing
      name: '@deepseek-ai/dsh-client-ui-billing'
```

### 3. 配置你的 DeepSeek API key

二选一：在网页「模型」页填入（会把 `DEEPSEEK_API_KEY` 写入 `~/.dsh/.credentials.yaml`），或导出环境变量：

```bash
export DEEPSEEK_API_KEY=sk-...
```

### 4. 重启

```bash
dsh web
```

## 配置

两个包都有合理默认值，下面都是可选的。

### 主机端（`llm-billing`）

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次调用时解析的凭据引用（环境变量）名。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，其次 `https://api.deepseek.com` | 端点基础地址；会追加 `/user/balance`。 |
| `models` | V4 Flash + V4 Pro | 展示用的模型行，按展示顺序。 |
| `billing.peakHours` | 09:00–12:00、14:00–18:00（北京） | 高峰时段窗口；其余时段为低谷。 |
| `billing.models` | 官方 V4 费率 | 每个模型的峰/谷单价行（`cacheHitInput`、`cacheMissInput`、`output`，单位：元/百万 token）。 |

### 估算是怎么算的

- **1 个任务 = 1 次会话。** 所有可达会话（在线 + 已持久化）按会话 id 去重后各折叠一次。
- 每个模型累计三个计费 token 桶：**缓存命中输入**、**未命中输入**（未缓存输入 + 缓存写入）、**输出**（含推理）。
- 每模型的「平均每次会话消耗」按**当前峰/谷时段单价**折算，得到平均每任务费用。
- `还能跑多少 = floor(人民币余额 ÷ 平均每任务费用)`。没有历史、没有费率行、或非人民币余额的模型不给出估算。

计费按 DeepSeek **8 月 17 日实行**的费率（北京时间峰/谷时段）。

## 已知限制

- **仅人民币** —— 估算读取人民币余额行；非人民币余额不给出估算。
- **按需折叠** —— 每次调用都重新折叠用量，成本随会话数量和日志体积增长。
- **是估算，不是承诺** —— 它用历史平均消耗去换算余额；实际计费以服务商为准。

## 许可证

[MIT](LICENSE)
