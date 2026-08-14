/**
 * Client-safe balance and estimate vocabulary shared by the `billing` Remote,
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

/** One model's remaining-task estimate derived from its historical average. */
export interface DeepSeekModelEstimate {
  /** Wire model id, e.g. `deepseek-v4-flash`. */
  model: string
  /** Selector label, e.g. `DeepSeek-V4-Flash`. */
  displayName: string
  /** Whole tasks the remaining balance can still fund; null without history or a CNY balance. */
  tasksRemaining: number | null
  /** Sessions that reported billed usage for this model; 0 means no history to estimate from. */
  sessionCount: number
  /** Total billed tokens across those sessions, for cross-checking the estimate. */
  totalTokens: number
  /** Average billed tokens per session; null when {@link sessionCount} is 0. */
  avgTokensPerTask: number | null
}

/** The complete billing estimate: balance plus per-model task projections. */
export interface DeepSeekBillingEstimate {
  balance: DeepSeekBalance
  models: readonly DeepSeekModelEstimate[]
}
