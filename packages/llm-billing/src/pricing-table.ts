/**
 * The published rate schedule: which models cost what, and since when.
 *
 * Data only — every policy decision about how a rate is chosen (revision
 * lookup, peak windows, day boundaries) lives in `billing.ts`. Keeping them
 * apart means adding a model never touches the pricing engine: the change is
 * one row here, plus a test.
 *
 * Rates are CNY per 1M tokens. Rows sharing a model are that model's rate
 * history (see {@link resolveBilling}).
 * @module @rayadesu/dsh-llm-billing/pricing-table
 */

import type { BillingConfigModel, DeepSeekRateRevision, PeakHourWindow } from './billing.ts'

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

/**
 * Inclusive epoch ms of the announced V4 Pro route switch: 2026-09-14 12:00
 * Beijing time (UTC+8, no DST) = 04:00 UTC. From that instant the V4 Pro route
 * is served by V4.1 Flash and billed at the V4.1 Flash rates.
 */
export const V4_PRO_ROUTE_SWITCH_AT = Date.UTC(2026, 8, 14, 4, 0, 0)

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
 * The V4.1 Flash rates as they reach the retired V4 Pro route from
 * {@link V4_PRO_ROUTE_SWITCH_AT}: the same price pair as the flash series'
 * second revision, carried at its own effective instant.
 */
const V4_PRO_SWITCHED_RATES: DeepSeekRateRevision = {
  effectiveFrom: V4_PRO_ROUTE_SWITCH_AT,
  peak: FLASH_REPRICED_RATES.peak,
  offPeak: FLASH_REPRICED_RATES.offPeak,
}

/**
 * Official peak/off-peak rates (CNY per 1M tokens) per model, as dated
 * revisions. Base rows are the schedule effective 2026-08-17; the V4 Flash
 * series (V4.1 Flash, V4 Flash, V4 Flash Vision Exp) carries the second
 * revision effective 2026-09-10 12:00 Beijing, and the V4 Pro row the V4.1
 * Flash rates from its announced route switch (2026-09-14 12:00 Beijing) —
 * the MiMo series (V2.5, and V2.6 which kept V2.5's pricing) is untouched by
 * either adjustment. Rows sharing a model are that model's rate history.
 */
export const DEFAULT_MODEL_PRICING: readonly BillingConfigModel[] = [
  // deepseek-flash is the V4.1 Flash route, DSH's default catalog entry; image
  // inputs are converted to tokens at the same per-token price.
  { model: 'deepseek-flash', ...FLASH_BASE_RATES },
  { model: 'deepseek-flash', ...FLASH_REPRICED_RATES },
  { model: 'deepseek-v4-flash', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4-flash', ...FLASH_REPRICED_RATES },
  // deepseek-v4.1-flash-expires-on-0910 was the V4.1 Flash preview route,
  // retired when the model was released on 2026-09-10; its rows stay so the
  // logs that used it keep pricing.
  { model: 'deepseek-v4.1-flash-expires-on-0910', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4.1-flash-expires-on-0910', ...FLASH_REPRICED_RATES },
  {
    model: 'deepseek-v4-pro',
    peak: { cacheHitInput: 0.30, cacheMissInput: 9.0, output: 27.0 },
    offPeak: { cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 },
  },
  // From the announced route switch V4 Pro is served by V4.1 Flash and billed
  // at the V4.1 Flash rates.
  { model: 'deepseek-v4-pro', ...V4_PRO_SWITCHED_RATES },
  // deepseek-v4-flash-vision-exp bills at the same rates as deepseek-v4-flash;
  // images are converted to tokens at the same per-token price.
  { model: 'deepseek-v4-flash-vision-exp', ...FLASH_BASE_RATES },
  { model: 'deepseek-v4-flash-vision-exp', ...FLASH_REPRICED_RATES },
  // MiMo series (Xiaomi): flat rate, no peak/off-peak distinction. V2.6 keeps
  // V2.5's published API pricing (2026-09-22 launch, "API pricing unchanged
  // from V2.5"); cache writes bill at the miss rate, though Xiaomi's launch
  // window makes them free provider-side for a limited time.
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
  {
    model: 'mimo-v2.6-pro',
    peak: { cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 },
    offPeak: { cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 },
  },
  {
    model: 'mimo-v2.6-flash',
    peak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 },
    offPeak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 },
  },
]
