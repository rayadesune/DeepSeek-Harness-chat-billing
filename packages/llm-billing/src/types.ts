/**
 * Client-safe balance and spend vocabulary shared by the `billing` Remote,
 * its generated artifacts, and the web UI.
 *
 * Billing semantics (single source of truth, see billing.ts): every spend is
 * priced per event by its own timestamp — Beijing-time (UTC+8, no DST) hour
 * and weekday, with peak windows Monday–Friday 09:00–12:00 / 14:00–18:00 and
 * weekends always off-peak; cache-hit input, cache-miss input (including
 * cache writes), and output (including reasoning) are billed separately at
 * per-1M-token rates, taking the rate revision in effect at that same instant
 * (the flash series was re-priced from 2026-09-10 12:00 Beijing, its earlier
 * samples keeping the superseded rates, and V4 Pro follows the V4.1 Flash
 * rates from its announced route switch on 2026-09-14 12:00 Beijing). The
 * published table prices the DeepSeek V4 rows and the MiMo-V2.5 series (flat
 * rate, no peak/off-peak distinction).
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
  /**
   * Samples that carried usage but have NO pricing row, and so contribute
   * nothing to {@link total} — so a session that only ever used an unlisted
   * model does not read as "no usage" beside a today row that says otherwise.
   */
  unpriced?: DeepSeekUnpricedUsage | undefined
}

/**
 * Provider-reported usage that could NOT be billed: it matched no pricing row,
 * and no rate is ever guessed from a similar-looking model id. Purely advisory
 * — it never changes a spend's `total`, and the whole field is omitted when
 * every sample was priced against its own row.
 */
export interface DeepSeekUnpricedUsage {
  /** Number of usage samples affected. */
  events: number
  /** Token count affected: input + cache read + cache write + output tokens. */
  tokens: number
  /** The wire model ids affected, in first-seen order. */
  models: readonly string[]
}

/** The billed spend of every session on one Beijing-time calendar day. */
export interface DeepSeekTodaySpend {
  /** Total billed cost in CNY across every priced model and every session. */
  total: number
  /** One row per model that reported usage AND has a pricing row; empty when today has no priced usage. */
  models: readonly DeepSeekSessionSpendModel[]
  /**
   * Samples that carried usage but have NO pricing row, and so contribute
   * nothing to {@link total}. Without this, an upstream model that ships before
   * its rate row reads exactly like "no usage" (see MiMo-V2.6, which arrived
   * before the table knew it) — the difference is what this field exists to
   * report. Add the row under `billing.models` to price these.
   */
  unpriced?: DeepSeekUnpricedUsage | undefined
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
  /**
   * Billed cost in CNY on the queried Beijing day for the whole conversation:
   * the top-level session's own spend plus every subagent session it delegated
   * (transitively), since a subagent child is the same conversation's work, not
   * a session the user opened. A subagent row is therefore never reported on
   * its own — its spend rides this total.
   */
  total: number
  /**
   * The session's own billed cost in CNY on the queried day, before its
   * subagent descendants were merged into {@link total}; they are equal when no
   * descendant priced anything that day. The row's decomposition fact: `total`
   * is the conversation's day, this is the session's own share of it.
   */
  ownTotal: number
}

/**
 * Today's per-session billed spend. One row per top-level session that priced
 * something today, with every subagent session's spend already folded into the
 * row of the session that delegated it (so no subagent appears as its own row).
 */
export interface DeepSeekTodaySessionsSpend {
  /** Top-level sessions with today's spend, sorted by `total` descending. */
  sessions: readonly DeepSeekTodaySessionSpend[]
}

/**
 * The subagent part of one conversation's billed spend: every subagent session
 * the queried session delegated (transitively), summed across every day its log
 * covers. A session's own log cannot price its delegation children, so the
 * browser adds this subtotal to the live own-session value to show what the
 * conversation actually cost.
 */
export interface DeepSeekDelegatedSpend {
  /** Merged billed cost in CNY across every delegated subagent session. */
  total: number
  /** One row per model priced in those sessions; empty when the session delegated nothing priced. */
  models: readonly DeepSeekSessionSpendModel[]
  /**
   * Whether the QUERIED session is itself a delegated subagent child. Its own
   * spend then rides the ranking row of the top-level session that delegated
   * it, so the panel has no row of its own to read a today share from.
   */
  isSubagent: boolean
  /**
   * Whether the queried session was created BEFORE the current Beijing day, so
   * its billed spend can span more than today. This — not a comparison of two
   * amounts — is what decides whether the panel renders the parenthesized today
   * share: the live session amount and the 60-second-cached ranking row drift
   * apart mid-turn, which would otherwise conjure a parenthesis for a session
   * that started today. `false` when the session started on the current day or
   * when its creation instant could not be resolved (an unproven crossing must
   * not conjure one either).
   */
  crossedDay: boolean
}

/** The billed cost of one completed Turn. */
export interface DeepSeekTurnSpend {
  /** Total billed cost in CNY across every priced model in the Turn. */
  total: number
}

/** One completed Turn's cost, located by the id of an assistant message inside it. */
export interface DeepSeekTurnSpendRow {
  /** The durable id of one assistant message inside the Turn. */
  messageId: string
  /** The Turn's total billed cost in CNY (the same value for every message of the Turn). */
  total: number
}

/**
 * Every completed Turn's billed cost in one session, in log order. One call
 * replaces the per-message `getTurnSpend` fan-out (the transcript renders one
 * row per message; fetching the whole map once is O(log), fetching per row is
 * O(messages × log)).
 */
export interface DeepSeekSessionTurnSpends {
  /** One row per assistant message inside a completed Turn; a Turn with N assistant messages contributes N rows. */
  turns: readonly DeepSeekTurnSpendRow[]
}
