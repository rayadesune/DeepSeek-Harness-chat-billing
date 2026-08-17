/**
 * Client-safe balance and spend vocabulary shared by the `billing` Remote,
 * its generated artifacts, and the web UI.
 * @module @deepseek-ai/dsh-llm-billing/types
 */

/** One currency line of the account balance returned by `GET /user/balance`. */
export interface DeepSeekBalanceLine {
  /** Currency code, e.g. `CNY` or `USD`. */
  currency: string
  /** Total available balance (granted plus topped up). */
  total: string
  /** Non-expired granted (free) balance. */
  granted: string
  /** Topped-up (paid) balance. */
  toppedUp: string
}

/** DeepSeek account balance returned by `GET /user/balance`. */
export interface DeepSeekBalance {
  /** Whether the account has any balance available for API calls. */
  isAvailable: boolean
  /** Balance lines, one per currency; empty when the provider reports none. */
  lines: readonly DeepSeekBalanceLine[]
}

/** One model's billed spend within one session, priced by the peak/off-peak table. */
export interface DeepSeekSessionSpendModel {
  /** Wire model id, e.g. `deepseek-v4-flash`. */
  model: string
  /** Selector label, e.g. `DeepSeek-V4-Flash`. */
  displayName: string
  /** Billed cost in CNY (peak plus off-peak portions). */
  cost: number
  /** Cost portion billed at peak rates. */
  peakCost: number
  /** Cost portion billed at off-peak rates. */
  offPeakCost: number
  /** Cache-hit input tokens billed at the hit rate. */
  cacheHitInputTokens: number
  /** Cache-miss input tokens (uncached input plus cache writes), billed at the miss rate. */
  cacheMissInputTokens: number
  /** Output tokens (reasoning included), billed at the output rate. */
  outputTokens: number
  /** Billed cost of cache-hit input tokens in CNY. */
  cacheHitInputCost: number
  /** Billed cost of cache-miss input tokens (uncached input plus cache writes) in CNY. */
  cacheMissInputCost: number
  /** Billed cost of output tokens (reasoning included) in CNY. */
  outputCost: number
}

/** The billed spend of one session, priced per event by its Beijing-time peak/off-peak hour. */
export interface DeepSeekSessionSpend {
  /** Total billed cost in CNY across every priced model. */
  total: number
  /** One row per model that reported usage AND has a pricing row; empty when the session has no priced usage. */
  models: readonly DeepSeekSessionSpendModel[]
}
