/**
 * Client-safe balance and spend vocabulary shared by the `billing` Remote,
 * its generated artifacts, and the web UI.
 *
 * Billing semantics (single source of truth, see billing.ts): every spend is
 * priced per event by its own timestamp — Beijing-time (UTC+8, no DST) hour
 * and weekday, with peak windows Monday–Friday 09:00–12:00 / 14:00–18:00 and
 * weekends always off-peak; cache-hit input, cache-miss input (including
 * cache writes), and output (including reasoning) are billed separately at
 * per-1M-token rates. The published table prices the DeepSeek V4 rows and
 * the MiMo-V2.5 series (flat rate, no peak/off-peak distinction).
 * @module @rayadesu/dsh-llm-billing/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

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

/** One model's billed spend within one session. */
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

/** The billed spend of one session. */
export interface DeepSeekSessionSpend {
  /** Total billed cost in CNY across every priced model. */
  total: number
  /** One row per model that reported usage AND has a pricing row; empty when the session has no priced usage. */
  models: readonly DeepSeekSessionSpendModel[]
}

/** The billed spend of every session on one Beijing-time calendar day. */
export interface DeepSeekTodaySpend {
  /** Total billed cost in CNY across every priced model and every session. */
  total: number
  /** One row per model that reported usage AND has a pricing row; empty when today has no priced usage. */
  models: readonly DeepSeekSessionSpendModel[]
}

/** One session's billed spend on one Beijing-time calendar day. */
export interface DeepSeekTodaySessionSpend {
  /** The session's durable identity. */
  sessionId: SessionId
  /**
   * The session's display title: the latest `session/title` event's text, or
   * `null` when the session has no title (or the title could not be resolved).
   */
  title: string | null
  /** Billed cost in CNY on the queried Beijing day. */
  total: number
}

/** Today's per-session billed spend across every session with a non-zero cost. */
export interface DeepSeekTodaySessionsSpend {
  /** Sessions with today's spend, sorted by `total` descending. */
  sessions: readonly DeepSeekTodaySessionSpend[]
}

/** The billed cost of one completed Turn. */
export interface DeepSeekTurnSpend {
  /** Total billed cost in CNY across every priced model in the Turn. */
  total: number
}
