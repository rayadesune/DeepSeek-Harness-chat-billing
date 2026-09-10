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

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel, DeepSeekSessionTurnSpends, DeepSeekTodaySpend, DeepSeekTurnSpend, DeepSeekTurnSpendRow } from './types.ts'

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

/**
 * Published peak-hour windows (Beijing time): 09:00–12:00 and 14:00–18:00,
 * applied on weekdays (Monday–Friday) only — weekends are always off-peak
 * (effective 2026-08-23).
 */
export const DEFAULT_PEAK_HOURS: readonly PeakHourWindow[] = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
]

/**
 * Inclusive epoch ms of the published V4 Flash series re-pricing:
 * 2026-09-10 12:00 Beijing time (UTC+8, no DST) = 04:00 UTC. Samples before
 * this instant keep the base rates; samples at or after it bill at the second
 * revision.
 */
export const FLASH_SERIES_RATE_CHANGE_AT = Date.UTC(2026, 8, 10, 4, 0, 0)

/** The V4 Flash series' base rates (effective 2026-08-17), CNY per 1M tokens. */
const FLASH_BASE_RATES: DeepSeekRateRevision = {
  peak: { cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 },
  offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
}

/**
 * The V4 Flash series' second revision (effective
 * {@link FLASH_SERIES_RATE_CHANGE_AT}): off-peak 0.02 / 1.0 / 4.0, peak at
 * twice those prices.
 */
const FLASH_REPRICED_RATES: DeepSeekRateRevision = {
  effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT,
  peak: { cacheHitInput: 0.04, cacheMissInput: 2.0, output: 8.0 },
  offPeak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 4.0 },
}

/**
 * Official peak/off-peak rates (CNY per 1M tokens) per model, as dated
 * revisions. Base rows are the schedule effective 2026-08-17; the V4 Flash
 * series (V4 Flash, V4.1 Flash, V4 Flash Vision Exp) additionally carries the
 * second revision effective 2026-09-10 12:00 Beijing, which leaves V4 Pro and
 * the MiMo-V2.5 series untouched. Rows sharing a model are that model's rate
 * history.
 */
export const DEFAULT_MODEL_PRICING: readonly BillingConfigModel[] = [
  { model: 'deepseek-v4-flash', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4-flash', ...FLASH_REPRICED_RATES },
  // deepseek-v4.1-flash-expires-on-0910 bills at the same rates as
  // deepseek-v4-flash; image inputs are converted to tokens at the same
  // per-token price.
  { model: 'deepseek-v4.1-flash-expires-on-0910', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4.1-flash-expires-on-0910', ...FLASH_REPRICED_RATES },
  {
    model: 'deepseek-v4-pro',
    peak: { cacheHitInput: 0.30, cacheMissInput: 9.0, output: 27.0 },
    offPeak: { cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 },
  },
  // deepseek-v4-flash-vision-exp bills at the same rates as deepseek-v4-flash;
  // images are converted to tokens at the same per-token price.
  { model: 'deepseek-v4-flash-vision-exp', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4-flash-vision-exp', ...FLASH_REPRICED_RATES },
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

/** One shifted-timestamp view of a Beijing (UTC+8, no DST) instant. */
export interface BeijingParts {
  /**
   * The instant in epoch milliseconds. Pricing needs it back to resolve the
   * rate revision in effect at the sample's own timestamp (see
   * {@link ratesAt}), so the view carries it instead of a second parse.
   */
  time: number
  /** Beijing hour, `0`–`23`. */
  hour: number
  /** Beijing weekday as `getUTCDay()`: `0` is Sunday, `6` is Saturday. */
  weekday: number
  /** Beijing calendar-day key (`YYYY-MM-DD`). */
  dayKey: string
}

/** Beijing is a fixed UTC+8 offset with no DST. */
const BEIJING_OFFSET_MS = 8 * 3_600_000
/** Milliseconds in one day. */
const DAY_MS = 86_400_000
/** Epoch day of 1970-01-01 in the civil-date algorithm below. */
const CIVIL_EPOCH_DAY = 719_468

/** Two-digit zero pad for a calendar field. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Civil date of an epoch day (Howard Hinnant's days-from-civil inverse):
 * pure integer arithmetic, no `Date` allocation and no ISO-string slicing.
 */
function civilDateOf(epochDay: number): { year: number; month: number; day: number } {
  const shifted = epochDay + CIVIL_EPOCH_DAY
  const era = Math.floor(shifted / 146_097)
  const dayOfEra = shifted - era * 146_097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1_460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  )
  const year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const month = monthPrime + (monthPrime < 10 ? 3 : -9)
  return {
    // January/February belong to the civil year AFTER the era year.
    year: month <= 2 ? year + 1 : year,
    month,
    day: dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1,
  }
}

/**
 * Derive the Beijing hour, weekday, and calendar-day key of one timestamp with
 * pure integer arithmetic — every timezone-sensitive read shares this one
 * implementation, so the pieces cannot drift apart. Callers that filter by
 * day and then price the same event reuse the returned view, so each event is
 * parsed exactly once. (The hot fold path runs this per committed event; the
 * previous `Date` + `toISOString().slice()` version allocated a `Date` and a
 * 24-character string per call.)
 * @param time - epoch milliseconds.
 * @throws {RangeError} when `time` is not a finite number.
 */
export function beijingPartsOf(time: number): BeijingParts {
  if (!Number.isFinite(time)) throw new RangeError(`billing: event time is not finite (${String(time)})`)
  const shifted = time + BEIJING_OFFSET_MS
  const epochDay = Math.floor(shifted / DAY_MS)
  const msOfDay = shifted - epochDay * DAY_MS
  const civil = civilDateOf(epochDay)
  return {
    time,
    hour: Math.floor(msOfDay / 3_600_000),
    // 1970-01-01 was a Thursday (4).
    weekday: ((epochDay + 4) % 7 + 7) % 7,
    dayKey: `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`,
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

/** The additive inverse of one spend (pure): used to replace a priced sample. */
export function negateSpend(spend: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const negate = (value: number): number => -value
  return {
    total: negate(spend.total),
    models: spend.models.map(row => ({
      ...row,
      cost: negate(row.cost),
      peakCost: negate(row.peakCost),
      offPeakCost: negate(row.offPeakCost),
      cacheHitInputTokens: negate(row.cacheHitInputTokens),
      cacheMissInputTokens: negate(row.cacheMissInputTokens),
      outputTokens: negate(row.outputTokens),
      cacheHitInputCost: negate(row.cacheHitInputCost),
      cacheMissInputCost: negate(row.cacheMissInputCost),
      outputCost: negate(row.outputCost),
    })),
  }
}

/**
 * Subtract one spend from another (pure). Rows that cancel out completely are
 * dropped so a replaced sample leaves no zero row behind.
 * @param target - the spend to subtract from.
 * @param source - the spend to remove.
 * @returns the difference.
 */
export function subtractSpend(target: DeepSeekTodaySpend, source: DeepSeekTodaySpend): DeepSeekTodaySpend {
  const rows = new Map<string, DeepSeekSessionSpendModel>()
  for (const row of target.models) rows.set(row.model, row)
  for (const row of source.models) {
    const existing = rows.get(row.model)
    if (existing === undefined) continue
    const next = mergeModelRows(existing, negateSpend({ total: 0, models: [row] }).models[0]!)
    if (next.cost === 0 && next.cacheHitInputTokens === 0 && next.cacheMissInputTokens === 0 && next.outputTokens === 0) {
      rows.delete(row.model)
    } else {
      rows.set(row.model, next)
    }
  }
  return { total: target.total - source.total, models: [...rows.values()] }
}

/**
 * One priced attempt sample kept for same-step replacement: DSH can report the
 * same `(turn, step)` twice (an `assistant/attempt` stream and the
 * `assistant/message` that assembles from it), and a later sample replaces the
 * earlier one instead of adding to it. `llm/retry-started` clears the slot, so
 * a retried attempt adds rather than replaces (both requests were billed).
 */
export interface BillingFoldSample {
  /** Turn of the producing attempt. */
  turn: number
  /** Step of the producing attempt. */
  step: number
  /** Beijing day of the sample's timestamp. */
  dayKey: string
  /** The sample's contribution as a one-row spend (subtracted on replacement). */
  spend: DeepSeekTodaySpend
}

/**
 * Plain-JSON fold state of one session's billed spend: the latest priced day,
 * the whole-session total, the fork boundary, the model of the latest request
 * (needed to price an `assistant/attempt`, which carries no route), and the
 * last sample kept for replacement.
 */
export interface BillingFoldState {
  /** Beijing-time calendar-day key of `spend`; `''` for no priced usage. */
  dayKey: string
  /** The spend of the session's latest priced Beijing day (own events only). */
  spend: DeepSeekTodaySpend
  /** The spend of the session's OWN events across every day. */
  session: DeepSeekTodaySpend
  /** Fork-inherited prefix length; events below it belong to the source session. */
  inheritedEventCount: number
  /** Wire model of the latest `request/header`; `''` before the first one. */
  model: string
  /** Latest priced attempt sample, for same-step replacement. */
  last: BillingFoldSample | null
}

/** The empty fold state for one fork boundary. */
export function emptyBillingFoldState(inheritedEventCount = 0): BillingFoldState {
  return {
    dayKey: '',
    spend: emptyTodaySpend(),
    session: emptyTodaySpend(),
    inheritedEventCount,
    model: '',
    last: null,
  }
}

/** Structural view of the newer event fields this fold reads (see the module note). */
interface StructuralEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

/** Whether an unknown value looks like a provider usage report. */
function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { inputTokens?: unknown; outputTokens?: unknown }
  return typeof candidate.inputTokens === 'number' && typeof candidate.outputTokens === 'number'
}

/**
 * The last `usage` sample embedded in an event's stream, if any. `assistant/
 * attempt` and the embedded streams are newer than the plugin's npm baseline,
 * so the stream is read structurally (a failed/retried attempt reports its
 * usage only there).
 */
function streamUsageOf(event: SessionEvent): TokenUsage | undefined {
  const stream = (event as StructuralEvent).data === undefined
    ? undefined
    : ((event as StructuralEvent).data as { stream?: unknown }).stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = (stream[index] as { chunk?: { type?: unknown; usage?: unknown } } | undefined)?.chunk
    if (chunk === undefined || chunk.type !== 'usage') continue
    return isTokenUsage(chunk.usage) ? chunk.usage : undefined
  }
  return undefined
}

/** The contribution as a one-row spend (the shape a sample keeps for replacement). */
function contributionSpend(priced: BillingEventContribution): DeepSeekTodaySpend {
  return { total: priced.cost, models: [contributionModel(priced)] }
}

/**
 * Fold one committed event into a session's billed-spend state.
 *
 * Priced samples come from `assistant/message` (its own reported usage, or the
 * stream's last usage chunk) and `assistant/attempt` (the stream's last usage
 * chunk, priced with the model of the latest `request/header`, since an
 * attempt carries no route). A sample for the same `(turn, step)` replaces the
 * previous one; `llm/retry-started` closes the replacement slot so a retried
 * attempt adds. Every other event is inert and returns the same state
 * reference.
 * @param state - the previous fold state.
 * @param event - the committed event.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the next state (the same reference when nothing was priced).
 */
export function applyBillingEvent(
  state: BillingFoldState,
  event: SessionEvent,
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
): BillingFoldState {
  if (event.seq < state.inheritedEventCount) return state
  // `assistant/attempt`, `llm/retry-started`, and the embedded stream are all
  // newer than the npm baseline this package builds against, so their fields
  // are read structurally.
  const type = (event as StructuralEvent).type
  if (type === 'request/header') {
    const model = ((event as StructuralEvent).data as { header?: { config?: { model?: unknown } } } | undefined)
      ?.header?.config?.model
    return typeof model === 'string' && model.length > 0 && model !== state.model ? { ...state, model } : state
  }
  const data = (event as StructuralEvent).data as
    | { turn?: unknown; step?: unknown; usage?: unknown; message?: { source?: { model?: unknown } }; stream?: unknown }
    | undefined
  if (type === 'llm/retry-started') {
    if (typeof data?.turn !== 'number' || typeof data.step !== 'number') return state
    const last = state.last
    if (last === null || last.turn !== data.turn || last.step !== data.step) return state
    return { ...state, last: null }
  }
  if (type !== 'assistant/message' && type !== 'assistant/attempt') return state
  const usage = (type === 'assistant/message' ? data?.usage : undefined) ?? streamUsageOf(event)
  if (!isTokenUsage(usage)) return state
  const model = type === 'assistant/message' ? data?.message?.source?.model : state.model
  if (typeof model !== 'string' || model.length === 0) return state
  const priced = priceUsage(beijingPartsOf(event.time), usage, model, billing, names)
  if (priced === undefined) return state

  let session = state.session
  let spend = state.spend
  let dayKey = state.dayKey
  const last = state.last
  const turn = typeof data?.turn === 'number' ? data.turn : 0
  const step = typeof data?.step === 'number' ? data.step : 0
  if (last !== null && last.turn === turn && last.step === step) {
    session = subtractSpend(session, last.spend)
    if (last.dayKey === dayKey) spend = subtractSpend(spend, last.spend)
  }
  session = addEventContribution(session, priced)
  if (dayKey === priced.dayKey) {
    spend = addEventContribution(spend, priced)
  } else if (dayKey === '' || priced.dayKey > dayKey) {
    // The session log is append-only and chronological, so a strictly older
    // day cannot legally follow; ignore it for the latest-day state (the
    // whole-session total still accrues).
    dayKey = priced.dayKey
    spend = addEventContribution(emptyTodaySpend(), priced)
  }
  return {
    ...state,
    dayKey,
    spend,
    session,
    last: { turn, step, dayKey: priced.dayKey, spend: contributionSpend(priced) },
  }
}

/**
 * Mutable wrapper over {@link applyBillingEvent} for the pure pricing paths:
 * feed events in order, read the folded spend.
 */
export class BillingFolder {
  private state: BillingFoldState

  /**
   * @param billing - resolved pricing with peak-hour windows.
   * @param catalog - model display rows, in presentation order.
   * @param inheritedEventCount - fork boundary to skip (default 0).
   */
  constructor(
    private readonly billing: ResolvedBilling,
    catalog: readonly { id: string; name: string }[],
    inheritedEventCount = 0,
  ) {
    this.names = new Map(catalog.map(model => [model.id, model.name]))
    this.state = emptyBillingFoldState(inheritedEventCount)
  }

  private readonly names: ReadonlyMap<string, string>

  /** Fold one event. */
  add(event: SessionEvent): void {
    this.state = applyBillingEvent(this.state, event, this.billing, this.names)
  }

  /** Fold every event, in order. */
  addAll(events: readonly SessionEvent[]): void {
    for (const event of events) this.add(event)
  }

  /** The folded state (live reference; do not mutate). */
  get fold(): BillingFoldState {
    return this.state
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
 * Price one session's complete event log at the official per-model rates,
 * with DSH's attempt semantics: every provider-reported sample (an
 * `assistant/message`'s usage, or an `assistant/attempt`'s stream usage)
 * contributes, a later sample for the same `(turn, step)` replaces the earlier
 * one, and `llm/retry-started` makes the retried attempt add.
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
  const folder = new BillingFolder(billing, catalog, startSeq)
  folder.addAll(events)
  return folder.fold.session
}

/**
 * Price one completed Turn's billed usage, identified by its closing
 * assistant message id. The turn's events are those between its `turn/start`
 * and `turn/end` (both matched by the message's own turn coordinate), priced
 * with the same attempt semantics as {@link computeSessionSpend}. A message
 * that cannot be located, a turn without bracketing `turn/start` / `turn/end`
 * events (for example after compaction), or a session with no priced usage
 * prices to zero.
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
  return { total: turnCostOf(events, billing, catalog, messageId) }
}

/**
 * The total cost of the Turn containing `messageId`, folded with the shared
 * attempt semantics (see {@link applyBillingEvent}).
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param messageId - one assistant message inside the Turn.
 * @returns the Turn's total cost in CNY, or 0 when the Turn cannot be located.
 */
function turnCostOf(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  messageId: string,
): number {
  let turn: number | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    if (event.data.message.id !== messageId) continue
    turn = event.data.turn
    break
  }
  if (turn === undefined) return 0
  const folder = new BillingFolder(billing, catalog)
  let active = false
  for (const event of events) {
    if (event.type === 'turn/start' && event.data.turn === turn) {
      active = true
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === turn) break
    if (!active) continue
    folder.add(event)
  }
  return folder.fold.session.total
}

/**
 * Incremental single-pass fold of one session's completed-Turn costs, keyed by
 * the id of every assistant message inside each Turn. Feeding the fold only
 * the appended tail keeps a growing session's map current in O(new events)
 * instead of re-scanning the whole log per message.
 *
 * Semantics are exactly {@link computeTurnSpend}'s: a Turn is the
 * `turn/start`..`turn/end` range (matched by the event's own turn coordinate),
 * every priced event inside it contributes at its own timestamp's rate, and a
 * message outside any bracket contributes nothing.
 */
export class SessionTurnSpendFolder {
  private readonly catalog: readonly { id: string; name: string }[]
  private readonly rows: DeepSeekTurnSpendRow[] = []
  private ids: string[] = []
  /** Events of the open Turn, folded with the shared attempt semantics on close. */
  private events: SessionEvent[] = []
  private open = false
  /** Events already fed; a shorter log resets the fold. */
  private cursor = 0

  /**
   * @param billing - resolved pricing with peak-hour windows.
   * @param catalog - model display rows, in presentation order.
   */
  constructor(
    private readonly billing: ResolvedBilling,
    catalog: readonly { id: string; name: string }[],
  ) {
    this.catalog = catalog
  }

  /** How many events have been folded so far (the host's incremental cursor). */
  get processed(): number {
    return this.cursor
  }

  /**
   * Fold every event from the cursor to the end of the log. A log shorter than
   * the cursor (rewritten session) restarts the fold from an empty state.
   * @param events - the session's complete event log, in seq order.
   */
  feed(events: readonly SessionEvent[]): void {
    if (events.length < this.cursor) this.reset()
    for (let index = this.cursor; index < events.length; index += 1) {
      const event = events[index]!
      if (event.type === 'turn/start') {
        this.open = true
        this.ids = []
        this.events = []
        continue
      }
      if (event.type === 'turn/end') {
        if (this.open) {
          const folder = new BillingFolder(this.billing, this.catalog)
          folder.addAll(this.events)
          const total = folder.fold.session.total
          for (const messageId of this.ids) this.rows.push({ messageId, total })
        }
        this.open = false
        this.ids = []
        this.events = []
        continue
      }
      if (!this.open) continue
      if (event.type === 'assistant/message') this.ids.push(event.data.message.id)
      this.events.push(event)
    }
    this.cursor = events.length
  }

  /** The folded map; the fold stays usable afterwards. */
  finish(): DeepSeekSessionTurnSpends {
    return { turns: [...this.rows] }
  }

  /** Drop the fold state so the next feed starts from the log's beginning. */
  private reset(): void {
    this.rows.length = 0
    this.ids = []
    this.events = []
    this.open = false
    this.cursor = 0
  }
}

/**
 * Price every completed Turn of one session in a single pass (the pure
 * equivalent of {@link SessionTurnSpendFolder}).
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @returns one row per assistant message inside a completed Turn, in log order.
 */
export function computeSessionTurnSpends(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
): DeepSeekSessionTurnSpends {
  const folder = new SessionTurnSpendFolder(billing, catalog)
  folder.feed(events)
  return folder.finish()
}

/**
 * Price one session's log for the Beijing-time calendar day of `now`. Events
 * after the reference day are ignored; the fold's latest-day state then
 * answers the query exactly (empty when the session's latest priced day is not
 * the reference day). Pricing follows {@link applyBillingEvent} (attempt
 * samples with same-step replacement).
 *
 * The fold's `(turn, step)` replacement slot is per session, so callers must
 * pass ONE session's log; aggregate across sessions with
 * {@link mergeTodaySpend}.
 * @param events - one session's complete event log.
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
  const folder = new BillingFolder(billing, catalog)
  for (const event of events) {
    // Only events up to the reference day can contribute.
    if (beijingPartsOf(event.time).dayKey > day) continue
    folder.add(event)
  }
  return folder.fold.dayKey === day ? folder.fold.spend : emptyTodaySpend()
}
