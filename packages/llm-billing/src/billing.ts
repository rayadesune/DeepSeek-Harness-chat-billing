/**
 * DeepSeek billing: the peak/off-peak pricing table and the per-session spend
 * pricing. Pure functions over session events and the pricing table, so the
 * Remote gateway stays transport-free and the whole spend is testable without
 * a key.
 *
 * The per-event pricing lives in {@link priceEvent} and the fold in the
 * {@link SpendAccumulator}: the events-scan paths ({@link computeSessionSpend},
 * {@link computeTodaySpend}), the session-projection unit (`billingTodaySpend`
 * in projection.ts), and the scanner's single-pass events path all price
 * through the same primitives, so a pricing-table change cannot drift one path
 * from the others.
 * @module @rayadesu/dsh-llm-billing/billing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel, DeepSeekTodaySpend, DeepSeekTurnSpend } from './types.ts'

/** One token price point, in CNY per 1M tokens. */
export interface DeepSeekTokenPrice {
  /** 1M input cache-hit tokens. */
  cacheHitInput: number
  /** 1M input cache-miss tokens (cache writes bill at this rate too). */
  cacheMissInput: number
  /** 1M output tokens. */
  output: number
}

/** Peak and off-peak price pair for one model. */
export interface DeepSeekModelPricing {
  /** Price during peak hours. */
  peak: DeepSeekTokenPrice
  /** Price during off-peak hours. */
  offPeak: DeepSeekTokenPrice
}

/** One model's pricing-table row in configuration form. */
export interface BillingConfigModel {
  /** Wire model id. */
  model: string
  /** Peak-hour price. */
  peak: DeepSeekTokenPrice
  /** Off-peak price. */
  offPeak: DeepSeekTokenPrice
}

/** One peak-hour window on a 24h Beijing-time clock, applied weekdays only. */
export interface PeakHourWindow {
  /** Inclusive start hour, `0`–`23`. */
  start: number
  /** Exclusive end hour, `1`–`24`. */
  end: number
}

/** Optional billing configuration; omission uses the published defaults. */
export interface BillingConfig {
  /**
   * Peak-hour windows in Beijing time, applied on weekdays (Monday–Friday)
   * only; weekends (Saturday and Sunday) are always off-peak.
   */
  peakHours?: PeakHourWindow[]
  /** Per-model pricing rows; omission uses the V4 Flash, V4 Pro, and V4 Flash Vision defaults. */
  models?: BillingConfigModel[]
}

/**
 * Published peak-hour windows (Beijing time): 09:00–12:00 and 14:00–18:00,
 * applied on weekdays (Monday–Friday) only — weekends are always off-peak
 * (effective 2026-08-23).
 */
export const DEFAULT_PEAK_HOURS: readonly PeakHourWindow[] = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
]

/** Official peak/off-peak rates (CNY per 1M tokens), effective 2026-08-17. */
export const DEFAULT_MODEL_PRICING: readonly BillingConfigModel[] = [
  {
    model: 'deepseek-v4-flash',
    peak: { cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 },
    offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
  },
  {
    model: 'deepseek-v4-pro',
    peak: { cacheHitInput: 0.30, cacheMissInput: 9.0, output: 27.0 },
    offPeak: { cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 },
  },
  // deepseek-v4-flash-vision-exp bills at the same rates as deepseek-v4-flash;
  // images are converted to tokens at the same per-token price.
  {
    model: 'deepseek-v4-flash-vision-exp',
    peak: { cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 },
    offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
  },
  // MiMo-V2.5 series (Xiaomi): flat rate, no peak/off-peak distinction.
  {
    model: 'mimo-v2.5-pro',
    peak: { cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 },
    offPeak: { cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 },
  },
  {
    model: 'mimo-v2.5',
    peak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 },
    offPeak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 },
  },
]

/** Resolved billing configuration: a pricing table plus peak-hour windows. */
export interface ResolvedBilling {
  peakHours: readonly { start: number; end: number }[]
  models: ReadonlyMap<string, DeepSeekModelPricing>
}

/**
 * Resolve optional configuration to a pricing table, defaulting omitted or
 * empty rows to the published rates. Schemastery materializes an absent
 * `z.array` as `[]` rather than `undefined`, so emptiness — not just absence —
 * selects the defaults. Explicit non-empty rows override the same model; a
 * supplied non-empty `models` list is authoritative.
 * @param config - optional raw billing configuration.
 * @returns the resolved table and peak-hour windows.
 */
export function resolveBilling(config: BillingConfig | undefined): ResolvedBilling {
  const peakHours = config?.peakHours !== undefined && config.peakHours.length > 0
    ? config.peakHours
    : DEFAULT_PEAK_HOURS
  const rows = config?.models !== undefined && config.models.length > 0
    ? config.models
    : DEFAULT_MODEL_PRICING
  const models = new Map<string, DeepSeekModelPricing>()
  for (const row of rows) models.set(row.model, { peak: row.peak, offPeak: row.offPeak })
  return { peakHours, models }
}

/** One shifted-timestamp view of a Beijing (UTC+8, no DST) instant. */
export interface BeijingParts {
  /** Beijing hour, `0`–`23`. */
  hour: number
  /** Beijing weekday as `getUTCDay()`: `0` is Sunday, `6` is Saturday. */
  weekday: number
  /** Beijing calendar-day key (`YYYY-MM-DD`). */
  dayKey: string
}

/**
 * Derive the Beijing hour, weekday, and calendar-day key of one timestamp from
 * a single shifted `Date` — every timezone-sensitive read shares this one
 * implementation, so the pieces cannot drift apart. Callers that filter by
 * day and then price the same event reuse the returned view via
 * {@link priceEventAt}, so each event is parsed exactly once.
 * @param time - epoch milliseconds.
 */
export function beijingPartsOf(time: number): BeijingParts {
  const shifted = new Date(time + 8 * 3_600_000)
  return {
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
    dayKey: shifted.toISOString().slice(0, 10),
  }
}

/** The Beijing (Asia/Shanghai, UTC+8, no DST) calendar-day key of a timestamp. */
export function beijingDayKey(now: Date): string {
  return beijingPartsOf(now.getTime()).dayKey
}

/**
 * Structural source of a session's durable inherited-prefix boundary. The
 * field moved between DSH runtimes:
 *
 * - since 0.1.2-alpha.4, `SessionHeader.seedLength` was removed (the header
 *   now carries only `isSeeded`: boolean) and the exact cut moved to
 *   `Session.inheritedEventCount` / `SessionInspection.inheritedEventCount`;
 * - at and before the 0.1.1-rc.2 npm baseline, the cut lived on the durable
 *   header as `seedLength` (optional; absent for an unseeded session) and on
 *   the persistence `inspect` result as `meta.seedLength`.
 *
 * The reader accepts any of the three shapes and prefers the newer,
 * exact-count field, so the same plugin code prices correctly on both
 * families of runtime.
 */
export interface ForkBoundarySource {
  /** 0.1.2-alpha.4+: `Session.inheritedEventCount` / `SessionInspection.inheritedEventCount`. */
  readonly inheritedEventCount?: number
  /** 0.1.1-rc.2 and earlier: `SessionHeader.seedLength`. */
  readonly seedLength?: number
  /** ≤ 0.1.1-rc.2: the header slice of a `Session` (its `header.seedLength`). */
  readonly header?: { readonly seedLength?: number; readonly isSeeded?: boolean }
  /** ≤ 0.1.1-rc.2: the `meta` of a persistence `inspect` result (its `seedLength`). */
  readonly meta?: { readonly seedLength?: number; readonly isSeeded?: boolean }
}

/**
 * The durable inherited-prefix boundary of one session: the number of leading
 * events it inherited verbatim from its fork source, 0 for a session created
 * without a seed. A forked session (or any seeded replay) carries that count
 * in its session state; every event with `seq < seedLength` is a copy of an
 * event already billed in that source session, so pricing must skip them or
 * the same model output is counted once per copy. Accepts the durable field
 * of both DSH runtime families (see {@link ForkBoundarySource}).
 * @param source - the session, inspection result, header slice, or durable
 *   header carrying the boundary; `undefined` reads as 0.
 * @returns the inherited-prefix length; 0 for an unseeded session.
 */
export function forkBoundaryOf(source: ForkBoundarySource | undefined): number {
  if (source === undefined) return 0
  const inherited = source.inheritedEventCount
  if (inherited !== undefined && Number.isSafeInteger(inherited)) return inherited
  return source.header?.seedLength ?? source.meta?.seedLength ?? source.seedLength ?? 0
}

/** Whether a durable header marks a fork-inherited (seeded) session across both runtime families. */
export function isSeededSession(header: { readonly seedLength?: number; readonly isSeeded?: boolean } | undefined): boolean {
  if (header === undefined) return false
  if (header.isSeeded === true) return true
  return (header.seedLength ?? 0) > 0
}

/** Whether a Beijing (hour, weekday) pair falls inside any peak-hour window. */
function isPeakParts(billing: ResolvedBilling, hour: number, weekday: number): boolean {
  if (weekday === 0 || weekday === 6) return false
  return billing.peakHours.some(({ start, end }) => hour >= start && hour < end)
}

/**
 * Whether a timestamp falls inside any peak-hour window (Beijing time,
 * weekdays Monday–Friday only). Weekends (Saturday and Sunday) are always
 * off-peak, matching the published peak-hours rule.
 * @param billing - resolved pricing with peak-hour windows.
 * @param now - the moment to classify.
 * @returns true during a weekday peak hour.
 */
export function isPeak(billing: ResolvedBilling, now: Date): boolean {
  const { hour, weekday } = beijingPartsOf(now.getTime())
  return isPeakParts(billing, hour, weekday)
}

/**
 * One priced billed event's contribution: the model row plus the Beijing
 * calendar day its timestamp falls on. `undefined` when the event carries no
 * priced usage (not an `assistant/message`, no usage report, or a model
 * without a pricing row).
 */
export interface BillingEventContribution {
  /** Beijing-time calendar-day key of the event's timestamp. */
  dayKey: string
  /** Wire model id, e.g. `deepseek-v4-flash`. */
  model: string
  /** Selector label for the model. */
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

/**
 * Price one event at the official per-model rates, applying the peak/off-peak
 * table by its Beijing-time hour and weekday (peak windows apply Monday–Friday
 * only; weekends are off-peak). Each `assistant/message` event with usage
 * contributes cache-hit input, cache-miss input (uncached input plus cache
 * writes), and output (reasoning included) tokens at the rate of its own
 * timestamp; a model with usage but no pricing row contributes nothing (the
 * published table prices only the two V4 rows).
 * @param event - the event to price.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the priced contribution, or `undefined` when the event has no priced usage.
 */
export function priceEvent(
  event: SessionEvent,
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
): BillingEventContribution | undefined {
  return priceEventAt(beijingPartsOf(event.time), event, billing, names)
}

/**
 * Price one event at the official per-model rates using a precomputed
 * Beijing-time view — the day-filtering and pricing of one event share a
 * single timezone parse (see {@link beijingPartsOf}). Semantics are identical
 * to {@link priceEvent}.
 * @param parts - the event's Beijing-time view.
 * @param event - the event to price.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the priced contribution, or `undefined` when the event has no priced usage.
 */
export function priceEventAt(
  parts: BeijingParts,
  event: SessionEvent,
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
): BillingEventContribution | undefined {
  if (event.type !== 'assistant/message') return undefined
  const reported = event.data.usage
  if (reported === undefined) return undefined
  const model = event.data.message.source.model
  const pricing = billing.models.get(model)
  if (pricing === undefined) return undefined
  const peak = isPeakParts(billing, parts.hour, parts.weekday)
  const price = peak ? pricing.peak : pricing.offPeak
  const hit = reported.cacheReadTokens ?? 0
  const miss = reported.inputTokens + (reported.cacheWriteTokens ?? 0)
  const output = reported.outputTokens
  const hitCost = (hit * price.cacheHitInput) / 1_000_000
  const missCost = (miss * price.cacheMissInput) / 1_000_000
  const outputCost = (output * price.output) / 1_000_000
  const cost = hitCost + missCost + outputCost
  return {
    dayKey: parts.dayKey,
    model,
    displayName: names.get(model) ?? model,
    cost,
    peakCost: peak ? cost : 0,
    offPeakCost: peak ? 0 : cost,
    cacheHitInputTokens: hit,
    cacheMissInputTokens: miss,
    outputTokens: output,
    cacheHitInputCost: hitCost,
    cacheMissInputCost: missCost,
    outputCost,
  }
}

/** A spend with no priced usage. */
export function emptyTodaySpend(): DeepSeekTodaySpend {
  return { total: 0, models: [] }
}

/** The today-spend shape of a single priced contribution. */
function contributionModel(priced: BillingEventContribution): DeepSeekSessionSpendModel {
  return {
    model: priced.model,
    displayName: priced.displayName,
    cost: priced.cost,
    peakCost: priced.peakCost,
    offPeakCost: priced.offPeakCost,
    cacheHitInputTokens: priced.cacheHitInputTokens,
    cacheMissInputTokens: priced.cacheMissInputTokens,
    outputTokens: priced.outputTokens,
    cacheHitInputCost: priced.cacheHitInputCost,
    cacheMissInputCost: priced.cacheMissInputCost,
    outputCost: priced.outputCost,
  }
}

/** Sum two model rows of the same model (pure). */
function mergeModelRows(left: DeepSeekSessionSpendModel, right: DeepSeekSessionSpendModel): DeepSeekSessionSpendModel {
  return {
    model: left.model,
    displayName: left.displayName,
    cost: left.cost + right.cost,
    peakCost: left.peakCost + right.peakCost,
    offPeakCost: left.offPeakCost + right.offPeakCost,
    cacheHitInputTokens: left.cacheHitInputTokens + right.cacheHitInputTokens,
    cacheMissInputTokens: left.cacheMissInputTokens + right.cacheMissInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheHitInputCost: left.cacheHitInputCost + right.cacheHitInputCost,
    cacheMissInputCost: left.cacheMissInputCost + right.cacheMissInputCost,
    outputCost: left.outputCost + right.outputCost,
  }
}

/**
 * Mutable model-row accumulator behind every spend fold. Rows keep first-seen
 * model order — the same shape a pure `addEventContribution` chain produces —
 * so the single-pass scan path and the pure public paths cannot diverge. One
 * `Map` lookup per contribution instead of a per-event array copy: the huge
 * event-log folds allocate one row object per model, not one intermediate
 * array per event.
 */
export class SpendAccumulator {
  private readonly rows = new Map<string, DeepSeekSessionSpendModel>()
  private total = 0

  /** Add one priced contribution. */
  add(priced: BillingEventContribution): void {
    const row = contributionModel(priced)
    const existing = this.rows.get(priced.model)
    this.rows.set(priced.model, existing === undefined ? row : mergeModelRows(existing, row))
    this.total += priced.cost
  }

  /** The folded spend; the accumulator stays usable afterwards. */
  finish(): DeepSeekTodaySpend {
    return { total: this.total, models: [...this.rows.values()] }
  }
}

/**
 * Merge one priced event's contribution into an accumulator spend (pure:
 * returns a new spend, never mutates its input).
 * @param spend - the accumulator (per session and day, or across sessions).
 * @param priced - the priced contribution to add.
 * @returns the merged spend.
 */
export function addEventContribution(
  spend: DeepSeekTodaySpend,
  priced: BillingEventContribution,
): DeepSeekTodaySpend {
  const row = contributionModel(priced)
  const rows = spend.models.map(existing => existing.model === priced.model ? mergeModelRows(existing, row) : existing)
  if (!rows.some(existing => existing.model === priced.model)) rows.push(row)
  return { total: spend.total + priced.cost, models: rows }
}

/**
 * Sum two spends (per session and day, or across sessions) into one (pure:
 * returns a new spend, never mutates its inputs).
 * @param target - the accumulator spend.
 * @param source - the spend to add.
 * @returns the summed spend.
 */
export function mergeTodaySpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const rows = new Map<string, DeepSeekSessionSpendModel>()
  for (const row of target.models) rows.set(row.model, row)
  for (const row of source.models) {
    const existing = rows.get(row.model)
    rows.set(row.model, existing === undefined ? row : mergeModelRows(existing, row))
  }
  return { total: target.total + source.total, models: [...rows.values()] }
}

/**
 * Price a set of billed events at the official per-model rates, applying the
 * peak/off-peak table per event by its Beijing-time hour and weekday (peak
 * windows apply Monday–Friday only; weekends are off-peak). Each
 * `assistant/message` event with usage contributes cache-hit input, cache-miss
 * input (uncached input plus cache writes), and output (reasoning included)
 * tokens at the rate of its own timestamp, with the three component costs
 * carried separately; a model with usage but no pricing row is omitted (the
 * published table prices only the two V4 rows).
 * @param events - the events to price.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @param dayKey - when provided, only events on this Beijing calendar day contribute.
 * @param startSeq - when provided, only events with `seq >= startSeq` contribute
 *   (a forked session's inherited prefix, `seq < startSeq`, is skipped).
 * @returns the total cost plus one row per priced model.
 */
function priceEvents(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
  dayKey?: string,
  startSeq = 0,
): DeepSeekTodaySpend {
  const accumulator = new SpendAccumulator()
  for (const event of events) {
    if (event.seq < startSeq) continue
    const priced = priceEvent(event, billing, names)
    if (priced === undefined || (dayKey !== undefined && priced.dayKey !== dayKey)) continue
    accumulator.add(priced)
  }
  return accumulator.finish()
}

/**
 * Price one session's complete event log at the official per-model rates.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param startSeq - when provided, only events with `seq >= startSeq`
 *   contribute: a forked session's inherited prefix (see {@link forkBoundaryOf})
 *   is skipped, so each model output is billed only in the session that
 *   produced it.
 * @returns the session's total cost plus one row per priced model.
 */
export function computeSessionSpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  startSeq = 0,
): DeepSeekSessionSpend {
  const names = new Map(catalog.map(model => [model.id, model.name]))
  return priceEvents(events, billing, names, undefined, startSeq)
}

/**
 * Price one completed Turn's billed usage at the official per-model rates,
 * identified by its closing assistant message id. The turn's events are those
 * between its `turn/start` and `turn/end` (both matched by the message's own
 * turn coordinate); each priced event applies the peak/off-peak table by its
 * Beijing-time hour and weekday. A message that cannot be located, a turn
 * without bracketing `turn/start` / `turn/end` events (for example after
 * compaction), or a session with no priced usage prices to zero.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param messageId - the closing assistant message's durable id.
 * @returns the turn's total cost in CNY.
 */
export function computeTurnSpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  messageId: string,
): DeepSeekTurnSpend {
  const names = new Map(catalog.map(model => [model.id, model.name]))
  let turn: number | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    if (event.data.message.id !== messageId) continue
    turn = event.data.turn
    break
  }
  if (turn === undefined) return { total: 0 }
  const accumulator = new SpendAccumulator()
  let active = false
  for (const event of events) {
    if (event.type === 'turn/start' && event.data.turn === turn) {
      active = true
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === turn) break
    if (!active) continue
    const priced = priceEvent(event, billing, names)
    if (priced !== undefined) accumulator.add(priced)
  }
  return { total: accumulator.finish().total }
}

/**
 * Price every event whose Beijing-time calendar day is the day of `now`,
 * aggregating across every session's event log. Events from other Beijing
 * days are ignored, so a caller passes the concatenated logs of all sessions.
 * @param events - every session's complete event log, concatenated.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param now - the reference moment whose Beijing-time calendar day is "today".
 * @returns today's total cost plus one row per priced model.
 */
export function computeTodaySpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  now: Date = new Date(),
): DeepSeekTodaySpend {
  const day = beijingDayKey(now)
  const names = new Map(catalog.map(model => [model.id, model.name]))
  return priceEvents(events, billing, names, day)
}
