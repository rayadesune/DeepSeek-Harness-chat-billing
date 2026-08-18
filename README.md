# DeepSeek Harness 计费插件

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，在 Web 会话头部直接显示你的 **DeepSeek 账户余额**，以及**当前会话（本轮对话）的花费**。

> 余额是 `GET /user/balance` 的真实数字；会话花费是按官方峰/谷单价对每条消息的计费 token 逐条计价的结果，不是计费承诺。

## 显示什么

- **会话头部徽标** —— 两行：剩余余额（`剩余额度：¥X`）＋ 本轮对话的计费花费（`本轮对话花费：¥X`）。
- **详情面板** —— 剩余金额、本会话花费，以及每个模型一行的花费分项（`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`），外加手动刷新按钮与花费说明。
- **失败与空态** —— 会话没有可计价消耗时显示「暂无消耗记录」而不是编造数字；未配置 key、凭据被拒或传输错误时显示弱化的「额度不可用」，其提示携带 Remote 自己的错误信息。

## 数据更新机制

- **会话花费自动跟随** —— 当前会话每到达一条新消息，徽标就只重算**本会话的花费**（纯本地计价，不发网络请求），连续对话时花费会实时跟着走。
- **额度保持手动** —— 余额是账户级数据，只在挂载、切换会话、手动点刷新、或刷新浏览器时重新查询 `/user/balance`；**没有轮询**，不会自动跟随账户变化。
- **刷新期间旧值保留** —— 刷新失败保留上一次有效值，不会清空。

## 显示样式
<img width="652" height="348" alt="image" src="https://github.com/user-attachments/assets/6a70df86-9228-41b3-935b-3dda74188bb5" />


## 包结构

| 包 | 侧 | 作用 |
| --- | --- | --- |
| [`packages/llm-billing`](packages/llm-billing) —— `@deepseek-ai/dsh-llm-billing` | 主机端 | 负责 `/user/balance` 传输与峰/谷计价表。对外暴露 `billing` Remote（`getBalance`、`getSessionSpend`）。 |
| [`packages/ui-billing`](packages/ui-billing) —— `@deepseek-ai/dsh-client-ui-billing` | 浏览器端 | 自己挂载 `billing` Remote，并贡献会话头部徽标与详情面板。 |

## 前置条件

- **DeepSeek Harness**（`dsh`）—— 插件运行在 dsh profile 内。
- **一个 DeepSeek API key** —— 余额从 DeepSeek API 读取，所以每个用户都需要自己的 key。

## 安装

把两个包装进 profile、接进组合、再配好 key。

### 1. 安装包

> ⚠️ 现状：这两个包依赖的 harness 内部包（`@deepseek-ai/dsh-llm`、`dsh-session`、
> `dsh-credentials`、`dsh-session-persistence`、`dsh-typert-protocol`、`cordis` 等）
> **尚未发布到 npm**，所以下面的 `dsh plugin add` 目前无法从 registry 解析。
> 本仓库是一个独立的插件源码仓库；要把插件装进某个 dsh profile，先发布这些
> 依赖包（`@deepseek-ai` 或你自己的 scope），再用 registry 安装：

```bash
dsh plugin --profile web add @deepseek-ai/dsh-llm-billing @deepseek-ai/dsh-client-ui-billing
```

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

## 会话花费是怎么算的

- 每条 `assistant/message` 事件报告三个计费 token 桶：**缓存命中输入**、**未命中输入**（未缓存输入 + 缓存写入）、**输出**（含推理）。
- 每条消息按其**发生时刻（北京时间）**所在的峰/谷时段单价计价，三个桶分别计费（`缓存命中 ¥X · 未命中输入 ¥Y · 输出 ¥Z`），再按模型汇总。
- 没有费率行的模型不计入（内置价目表目前只含两个 V4 行）。计费按 DeepSeek **8 月 17 日实行**的费率（北京时间峰/谷时段）。

## 已知限制

- **有费率行才计价** —— 会话花费只统计价目表（`billing.models`）里有的模型。
- **额度不自动跟随** —— 余额保持手动刷新（无轮询），账户在其他客户端产生消耗时，界面值不会自动变化，需手动刷新或刷新浏览器。
- **是估算，不是承诺** —— 会话花费按官方单价对 token 计价；实际计费以服务商为准。

## 许可证

[MIT](LICENSE)
