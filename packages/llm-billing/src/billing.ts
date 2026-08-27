/**
 * DeepSeek billing: the peak/off-peak pricing table and the per-session spend
 * pricing. Pure functions over session events and the pricing table, so the
 * Remote gateway stays transport-free and the whole spend is testable without
 * a key.
 *
 * The per-event pricing lives in {@link priceEvent}, the one shared fold
 * primitive: the events-scan paths ({@link computeSessionSpend},
 * {@link computeTodaySpend}) and the session-projection unit
 * (`billingTodaySpend` in projection.ts) all fold the same contribution, so a
 * pricing-table change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/billing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel, DeepSeekTodaySpend } from './types.ts'

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
export const DEFAULT_PEAK_HOURS: { start: number; end: number }[] = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
]

/** Official peak/off-peak rates (CNY per 1M tokens), effective 2026-08-17. */
export const DEFAULT_MODEL_PRICING: BillingConfigModel[] = [
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

/** The Beijing (Asia/Shanghai, UTC+8, no DST) hour of a timestamp. */
function beijingHour(now: Date): number {
  return new Date(now.getTime() + 8 * 3_600_000).getUTCHours()
}

/**
 * The Beijing (Asia/Shanghai, UTC+8, no DST) weekday of a timestamp, as
 * `getUTCDay()`: `0` is Sunday, `6` is Saturday.
 */
function beijingWeekday(now: Date): number {
  return new Date(now.getTime() + 8 * 3_600_000).getUTCDay()
}

/** The Beijing (Asia/Shanghai, UTC+8, no DST) calendar-day key of a timestamp. */
export function beijingDayKey(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
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
  const weekday = beijingWeekday(now)
  if (weekday === 0 || weekday === 6) return false
  const hour = beijingHour(now)
  return billing.peakHours.some(({ start, end }) => hour >= start && hour < end)
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
  if (event.type !== 'assistant/message') return undefined
  const reported = event.data.usage
  if (reported === undefined) return undefined
  const model = event.data.message.source.model
  const pricing = billing.models.get(model)
  if (pricing === undefined) return undefined
  const time = new Date(event.time)
  const peak = isPeak(billing, time)
  const price = peak ? pricing.peak : pricing.offPeak
  const hit = reported.cacheReadTokens ?? 0
  const miss = reported.inputTokens + (reported.cacheWriteTokens ?? 0)
  const output = reported.outputTokens
  const hitCost = (hit * price.cacheHitInput) / 1_000_000
  const missCost = (miss * price.cacheMissInput) / 1_000_000
  const outputCost = (output * price.output) / 1_000_000
  const cost = hitCost + missCost + outputCost
  return {
    dayKey: beijingDayKey(time),
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
  const rows = spend.models.map(row => row.model === priced.model
    ? {
        ...row,
        cost: row.cost + priced.cost,
        peakCost: row.peakCost + priced.peakCost,
        offPeakCost: row.offPeakCost + priced.offPeakCost,
        cacheHitInputTokens: row.cacheHitInputTokens + priced.cacheHitInputTokens,
        cacheMissInputTokens: row.cacheMissInputTokens + priced.cacheMissInputTokens,
        outputTokens: row.outputTokens + priced.outputTokens,
        cacheHitInputCost: row.cacheHitInputCost + priced.cacheHitInputCost,
        cacheMissInputCost: row.cacheMissInputCost + priced.cacheMissInputCost,
        outputCost: row.outputCost + priced.outputCost,
      }
    : row)
  if (!rows.some(row => row.model === priced.model)) rows.push(contributionModel(priced))
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
  let merged = target
  for (const row of source.models) {
    merged = addEventContribution(merged, {
      dayKey: '',
      model: row.model,
      displayName: row.displayName,
      cost: row.cost,
      peakCost: row.peakCost,
      offPeakCost: row.offPeakCost,
      cacheHitInputTokens: row.cacheHitInputTokens,
      cacheMissInputTokens: row.cacheMissInputTokens,
      outputTokens: row.outputTokens,
      cacheHitInputCost: row.cacheHitInputCost,
      cacheMissInputCost: row.cacheMissInputCost,
      outputCost: row.outputCost,
    })
  }
  return merged
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
 * @param catalog - model display rows, in presentation order.
 * @returns the total cost plus one row per priced model.
 */
function priceEvents(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
): DeepSeekSessionSpend {
  const names = new Map(catalog.map(model => [model.id, model.name]))
  let spend: DeepSeekSessionSpend = { total: 0, models: [] }
  for (const event of events) {
    const priced = priceEvent(event, billing, names)
    if (priced === undefined) continue
    spend = addEventContribution(spend, priced)
  }
  return spend
}

/**
 * Price one session's complete event log at the official per-model rates.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @returns the session's total cost plus one row per priced model.
 */
export function computeSessionSpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
): DeepSeekSessionSpend {
  return priceEvents(events, billing, catalog)
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
  let spend: DeepSeekTodaySpend = emptyTodaySpend()
  for (const event of events) {
    const priced = priceEvent(event, billing, names)
    if (priced === undefined || priced.dayKey !== day) continue
    spend = addEventContribution(spend, priced)
  }
  return spend
}
