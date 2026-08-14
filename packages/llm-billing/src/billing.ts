/**
 * DeepSeek billing estimation: the peak/off-peak pricing table, the per-model
 * session-usage fold, and the balance → remaining-tasks conversion. Pure
 * functions over session events and the fetched balance, so the Remote gateway
 * stays transport-free and the whole estimate is testable without a key.
 * @module @deepseek-ai/dsh-llm-billing/billing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekBalance, DeepSeekModelEstimate } from './types.ts'

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

/** Optional billing estimate configuration; omission uses the published defaults. */
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

/** Cumulative billed-token buckets for one model across one or more sessions. */
export interface ModelUsage {
  cacheHitInputTokens: number
  cacheMissInputTokens: number
  outputTokens: number
  /** Distinct sessions that reported usage for this model. */
  sessions: number
}

/** Per-model usage aggregated across sessions, keyed by wire model id. */
export type PerModelUsage = Map<string, ModelUsage>

/**
 * Fold one session's `assistant/message` events into per-model billed-token
 * buckets. Cache misses are uncached input plus cache writes (DeepSeek bills a
 * write at the miss rate); cache hits are `cacheReadTokens`; output is
 * `outputTokens` (reasoning already included). Each model that reports usage
 * counts one session.
 * @param events - one session's complete event log.
 * @returns per-model usage for this session.
 */
export function foldSessionUsage(events: readonly SessionEvent[]): PerModelUsage {
  const usage: PerModelUsage = new Map()
  const entry = (model: string): ModelUsage => {
    let found = usage.get(model)
    if (found === undefined) {
      found = { cacheHitInputTokens: 0, cacheMissInputTokens: 0, outputTokens: 0, sessions: 1 }
      usage.set(model, found)
    }
    return found
  }
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const reported = event.data.usage
    if (reported === undefined) continue
    const model = entry(event.data.message.source.model)
    model.cacheHitInputTokens += reported.cacheReadTokens ?? 0
    model.cacheMissInputTokens += reported.inputTokens + (reported.cacheWriteTokens ?? 0)
    model.outputTokens += reported.outputTokens
  }
  return usage
}

/**
 * Merge one session's usage into the running aggregate, summing token buckets
 * and session counts per model.
 * @param target - running aggregate, mutated in place.
 * @param source - one session's fold.
 */
export function mergeSessionUsage(target: PerModelUsage, source: PerModelUsage): void {
  for (const [model, usage] of source) {
    const current = target.get(model)
    if (current === undefined) {
      target.set(model, { ...usage })
      continue
    }
    current.cacheHitInputTokens += usage.cacheHitInputTokens
    current.cacheMissInputTokens += usage.cacheMissInputTokens
    current.outputTokens += usage.outputTokens
    current.sessions += usage.sessions
  }
}

/** The Beijing (Asia/Shanghai, UTC+8, no DST) hour of a timestamp. */
function beijingHour(now: Date): number {
  return new Date(now.getTime() + 8 * 3_600_000).getUTCHours()
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

/** One model's billed-token average across the sessions that used it. */
interface ModelAverage {
  cacheHitInput: number
  cacheMissInput: number
  output: number
}

/**
 * Convert the remaining CNY balance into whole remaining tasks per model,
 * using each model's historical average billed tokens and the current
 * peak/off-peak price. A model with no history, no price row, or an empty
 * average reports null rather than a fabricated figure.
 * @param balance - fetched account balance.
 * @param usage - per-model usage across sessions.
 * @param billing - resolved pricing.
 * @param now - the moment deciding peak vs off-peak.
 * @param catalog - model display rows, in presentation order.
 * @returns one estimate per catalog entry.
 */
export function computeModelEstimates(
  balance: DeepSeekBalance,
  usage: PerModelUsage,
  billing: ResolvedBilling,
  now: Date,
  catalog: readonly { id: string; name: string }[],
): DeepSeekModelEstimate[] {
  const cny = balance.lines.find(line => line.currency === 'CNY')
  const peak = isPeak(billing, now)
  const remaining = cny === undefined ? Number.NaN : Number(cny.total)
  return catalog.map(({ id, name }) => {
    const modelUsage = usage.get(id)
    const pricing = billing.models.get(id)
    const sessionCount = modelUsage?.sessions ?? 0
    const totalTokens = modelUsage === undefined
      ? 0
      : modelUsage.cacheHitInputTokens + modelUsage.cacheMissInputTokens + modelUsage.outputTokens
    const usable = cny !== undefined
      && Number.isFinite(remaining)
      && modelUsage !== undefined
      && modelUsage.sessions > 0
      && pricing !== undefined
    if (!usable) {
      return {
        model: id,
        displayName: name,
        tasksRemaining: null,
        sessionCount,
        totalTokens,
        avgTokensPerTask: null,
      }
    }
    const average: ModelAverage = {
      cacheHitInput: modelUsage.cacheHitInputTokens / modelUsage.sessions,
      cacheMissInput: modelUsage.cacheMissInputTokens / modelUsage.sessions,
      output: modelUsage.outputTokens / modelUsage.sessions,
    }
    const price = peak ? pricing.peak : pricing.offPeak
    const avgCostPerTask = (
      average.cacheHitInput * price.cacheHitInput
      + average.cacheMissInput * price.cacheMissInput
      + average.output * price.output
    ) / 1_000_000
    const avgTokensPerTask = Math.round(average.cacheHitInput + average.cacheMissInput + average.output)
    if (!Number.isFinite(avgCostPerTask) || avgCostPerTask <= 0) {
      return { model: id, displayName: name, tasksRemaining: null, sessionCount, totalTokens, avgTokensPerTask }
    }
    return {
      model: id,
      displayName: name,
      tasksRemaining: Math.floor(remaining / avgCostPerTask),
      sessionCount,
      totalTokens,
      avgTokensPerTask,
    }
  })
}
