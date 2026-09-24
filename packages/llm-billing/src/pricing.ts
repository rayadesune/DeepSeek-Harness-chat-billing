/**
 * DeepSeek pricing: the peak/off-peak pricing table, the per-event pricing, and
 * the resolved-billing shape. Pure functions over token usage and the pricing
 * table, so the Remote gateway stays transport-free and the whole spend is
 * testable without a key.
 *
 * The per-event pricing lives in {@link priceEvent} / {@link priceUsage}; the
 * fold state machine that consumes it (`BillingFolder` / {@link applyBillingEvent})
 * lives in `fold.ts`, and every scan path prices through these primitives so a
 * pricing-table change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/pricing
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { BeijingParts } from './beijing-time.ts'
import { beijingPartsOf } from './beijing-time.ts'
import { DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS } from './pricing-table.ts'

/** One token price point, in CNY per 1M tokens. */
export interface DeepSeekTokenPrice {
  /** 1M input cache-hit tokens. */
  cacheHitInput: number
  /** 1M input cache-miss tokens (cache writes bill at this rate too). */
  cacheMissInput: number
  /** 1M output tokens. */
  output: number
}

/**
 * One published peak/off-peak rate revision of a model: the price pair plus the
 * instant it took effect. A provider re-prices a series without repricing its
 * history, so the table keeps every revision and prices each sample at the
 * rates of the sample's own timestamp.
 */
export interface DeepSeekRateRevision {
  /** Price during peak hours. */
  peak: DeepSeekTokenPrice
  /** Price during off-peak hours. */
  offPeak: DeepSeekTokenPrice
  /**
   * Inclusive epoch ms this revision takes effect: it prices every sample at or
   * after that instant. `undefined` on a model's base revision, which also
   * covers every earlier instant.
   */
  effectiveFrom?: number
}

/** Resolved pricing for one model: its published rate revisions, oldest first. */
export interface DeepSeekModelPricing {
  /** Peak-hour price of the newest revision (the rates in effect now). */
  peak: DeepSeekTokenPrice
  /** Off-peak price of the newest revision (the rates in effect now). */
  offPeak: DeepSeekTokenPrice
  /**
   * Every published revision of this model, ascending by `effectiveFrom` (an
   * undated base revision first); always at least one. {@link priceUsage} picks
   * the revision in effect at the priced sample's own timestamp.
   */
  revisions: readonly DeepSeekRateRevision[]
}

/** One model's pricing-table row in configuration form. */
export interface BillingConfigModel extends DeepSeekRateRevision {
  /** Wire model id. */
  model: string
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
  /**
   * Per-model pricing rows; omission uses the published V4 and MiMo rates.
   * Several rows for one model declare that model's rate history, priced per
   * sample by `effectiveFrom` (see {@link BillingConfigModel}).
   */
  models?: BillingConfigModel[]
}

// Declared here before the table moved out; re-exported so the package's public
// surface and its tests keep importing them from the billing entry point.
export { DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS, FLASH_SERIES_RATE_CHANGE_AT, V4_PRO_ROUTE_SWITCH_AT } from './pricing-table.ts'

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
 *
 * Rows sharing a model are that model's rate revisions, kept in ascending
 * `effectiveFrom` order (an undated base revision first). Two rows declaring
 * the same effective instant are one revision and the later row wins — the
 * historical override rule — so re-declaring a model can neither duplicate a
 * revision nor install a second undated base.
 * @param config - optional raw billing configuration.
 * @returns the resolved table (per model: its revisions plus the newest rates) and peak-hour windows.
 */
export function resolveBilling(config: BillingConfig | undefined): ResolvedBilling {
  const peakHours = config?.peakHours !== undefined && config.peakHours.length > 0
    ? config.peakHours
    : DEFAULT_PEAK_HOURS
  const rows = config?.models !== undefined && config.models.length > 0
    ? config.models
    : DEFAULT_MODEL_PRICING
  const schedules = new Map<string, DeepSeekRateRevision[]>()
  for (const row of rows) {
    // Spelled out per branch: `exactOptionalPropertyTypes` forbids handing an
    // explicit `undefined` to an optional field.
    const revision: DeepSeekRateRevision = row.effectiveFrom === undefined
      ? { peak: row.peak, offPeak: row.offPeak }
      : { effectiveFrom: row.effectiveFrom, peak: row.peak, offPeak: row.offPeak }
    const revisions = schedules.get(row.model)
    if (revisions === undefined) {
      schedules.set(row.model, [revision])
      continue
    }
    const duplicate = revisions.findIndex(candidate => candidate.effectiveFrom === revision.effectiveFrom)
    if (duplicate >= 0) revisions[duplicate] = revision
    else revisions.push(revision)
  }
  const models = new Map<string, DeepSeekModelPricing>()
  for (const [model, revisions] of schedules) {
    revisions.sort(
      (left, right) => (left.effectiveFrom ?? Number.NEGATIVE_INFINITY) - (right.effectiveFrom ?? Number.NEGATIVE_INFINITY),
    )
    const newest = revisions[revisions.length - 1]!
    models.set(model, { peak: newest.peak, offPeak: newest.offPeak, revisions })
  }
  return { peakHours, models }
}

/**
 * The rate revision in effect at one instant: the newest revision that took
 * effect at or before it. Revisions are ascending, so the scan stops at the
 * first future one. An instant before the earliest dated revision bills at that
 * earliest revision — a model with only dated rows is never left unpriced.
 */
function ratesAt(revisions: readonly DeepSeekRateRevision[], time: number): DeepSeekRateRevision {
  let chosen = revisions[0]!
  for (let index = 1; index < revisions.length; index += 1) {
    const revision = revisions[index]!
    if (revision.effectiveFrom === undefined || revision.effectiveFrom > time) break
    chosen = revision
  }
  return chosen
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
 * only; weekends are off-peak) and the rate revision in effect at its own
 * timestamp. Each `assistant/message` event with usage
 * contributes cache-hit input, cache-miss input (uncached input plus cache
 * writes), and output (reasoning included) tokens at the rate of its own
 * timestamp; a model with usage but no pricing row contributes nothing.
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
  return priceUsage(parts, reported, event.data.message.source.model, billing, names)
}

/** Every token one usage sample reports, whether or not it gets priced. */
export function usageTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** Max distinct model ids remembered for the once-only warning. */
const UNPRICED_WARN_LIMIT = 64

/** Model ids already reported, so a long-running host logs each one once. */
const reportedUnpricedModels = new Set<string>()

/**
 * Report a model carrying no rate row, at most once per id (and at most
 * {@link UNPRICED_WARN_LIMIT} ids per process). Every figure reads as zero when
 * the upstream model is unknown, which looks exactly like "no usage" rather
 * than a missing row — the one thing this warning exists to separate.
 *
 * Deliberately NOT guessed: model ids are chosen by whoever ships the model, so
 * a similar-looking name says nothing about a similar price — and a wrong number
 * that LOOKS authoritative is worse than a visible gap. The fix is one row under
 * `billing.models`, which is exactly what the warning points at.
 * @param model - the unlisted wire model id.
 */
export function reportUnpricedModel(model: string): void {
  if (reportedUnpricedModels.has(model) || reportedUnpricedModels.size >= UNPRICED_WARN_LIMIT) return
  reportedUnpricedModels.add(model)
  console.warn(`[llm-billing] no pricing row for model "${model}" — its usage is NOT billed; add its row under billing.models to price it`)
}

/**
 * Price one provider-reported usage sample for one model at the rates of the
 * sample's own Beijing-time hour and weekday — the peak or off-peak price of
 * the rate revision in effect at the sample's own timestamp (a re-priced series
 * bills its history at the rates that applied then). `undefined` when the model
 * has no pricing row.
 * @param parts - the sample's Beijing-time view.
 * @param usage - the reported token buckets.
 * @param model - the wire model id the sample belongs to.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the priced contribution, or `undefined` when the model has no rate row.
 */
export function priceUsage(
  parts: BeijingParts,
  usage: TokenUsage,
  model: string,
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
): BillingEventContribution | undefined {
  const pricing = billing.models.get(model)
  if (pricing === undefined) return undefined
  const peak = isPeakParts(billing, parts.hour, parts.weekday)
  const revision = ratesAt(pricing.revisions, parts.time)
  const price = peak ? revision.peak : revision.offPeak
  const hit = usage.cacheReadTokens ?? 0
  const miss = usage.inputTokens + (usage.cacheWriteTokens ?? 0)
  const output = usage.outputTokens
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
