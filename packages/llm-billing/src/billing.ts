/**
 * DeepSeek billing: the peak/off-peak pricing table and the per-session spend
 * pricing. Pure functions over session events and the pricing table, so the
 * Remote gateway stays transport-free and the whole spend is testable without
 * a key.
 * @module @deepseek-ai/dsh-llm-billing/billing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionSpend, DeepSeekTodaySpend } from './types.ts'

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

/** One peak-hour window on a 24h Beijing-time clock. */
export interface PeakHourWindow {
  /** Inclusive start hour, `0`–`23`. */
  start: number
  /** Exclusive end hour, `1`–`24`. */
  end: number
}

/** Optional billing configuration; omission uses the published defaults. */
export interface BillingConfig {
  /** Peak-hour windows in Beijing time. */
  peakHours?: PeakHourWindow[]
  /** Per-model pricing rows; omission uses the V4 Flash and V4 Pro defaults. */
  models?: BillingConfigModel[]
}

/** Published peak-hour windows (Beijing time): 09:00–12:00 and 14:00–18:00. */
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

/** The Beijing (Asia/Shanghai, UTC+8, no DST) calendar-day key of a timestamp. */
function beijingDayKey(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * Whether a timestamp falls inside any peak-hour window (Beijing time).
 * @param billing - resolved pricing with peak-hour windows.
 * @param now - the moment to classify.
 * @returns true during peak hours.
 */
export function isPeak(billing: ResolvedBilling, now: Date): boolean {
  const hour = beijingHour(now)
  return billing.peakHours.some(({ start, end }) => hour >= start && hour < end)
}

/** Running per-model spend accumulation for {@link computeSessionSpend}. */
interface SessionSpendRow {
  cacheHitInputTokens: number
  cacheMissInputTokens: number
  outputTokens: number
  cost: number
  peakCost: number
  offPeakCost: number
  cacheHitInputCost: number
  cacheMissInputCost: number
  outputCost: number
}

/**
 * Price a set of billed events at the official per-model rates, applying the
 * peak/off-peak table per event by its Beijing-time hour. Each
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
  const rows = new Map<string, SessionSpendRow>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const reported = event.data.usage
    if (reported === undefined) continue
    const model = event.data.message.source.model
    const pricing = billing.models.get(model)
    if (pricing === undefined) continue
    const peak = isPeak(billing, new Date(event.time))
    const price = peak ? pricing.peak : pricing.offPeak
    const hit = reported.cacheReadTokens ?? 0
    const miss = reported.inputTokens + (reported.cacheWriteTokens ?? 0)
    const output = reported.outputTokens
    const hitCost = (hit * price.cacheHitInput) / 1_000_000
    const missCost = (miss * price.cacheMissInput) / 1_000_000
    const outputCost = (output * price.output) / 1_000_000
    const cost = hitCost + missCost + outputCost
    let row = rows.get(model)
    if (row === undefined) {
      row = {
        cacheHitInputTokens: 0, cacheMissInputTokens: 0, outputTokens: 0,
        cost: 0, peakCost: 0, offPeakCost: 0,
        cacheHitInputCost: 0, cacheMissInputCost: 0, outputCost: 0,
      }
      rows.set(model, row)
    }
    row.cacheHitInputTokens += hit
    row.cacheMissInputTokens += miss
    row.outputTokens += output
    row.cost += cost
    row.cacheHitInputCost += hitCost
    row.cacheMissInputCost += missCost
    row.outputCost += outputCost
    if (peak) row.peakCost += cost
    else row.offPeakCost += cost
  }
  const models = [...rows.entries()].map(([model, row]) => ({
    model,
    displayName: names.get(model) ?? model,
    cost: row.cost,
    peakCost: row.peakCost,
    offPeakCost: row.offPeakCost,
    cacheHitInputTokens: row.cacheHitInputTokens,
    cacheMissInputTokens: row.cacheMissInputTokens,
    outputTokens: row.outputTokens,
    cacheHitInputCost: row.cacheHitInputCost,
    cacheMissInputCost: row.cacheMissInputCost,
    outputCost: row.outputCost,
  }))
  return {
    total: models.reduce((sum, model) => sum + model.cost, 0),
    models,
  }
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
  return priceEvents(events.filter(event => beijingDayKey(new Date(event.time)) === day), billing, catalog)
}
