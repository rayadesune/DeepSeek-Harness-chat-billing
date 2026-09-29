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
import type { BillingConfigModel, PeakHourWindow } from './billing.ts';
/**
 * Published peak-hour windows (Beijing time): 09:00–12:00 and 14:00–18:00,
 * applied on weekdays (Monday–Friday) only — weekends are always off-peak
 * (effective 2026-08-23).
 */
export declare const DEFAULT_PEAK_HOURS: readonly PeakHourWindow[];
/**
 * Inclusive epoch ms of the published V4 Flash series re-pricing:
 * 2026-09-10 12:00 Beijing time (UTC+8, no DST) = 04:00 UTC. Samples before
 * this instant keep the base rates; samples at or after it bill at the second
 * revision.
 */
export declare const FLASH_SERIES_RATE_CHANGE_AT: number;
/**
 * Inclusive epoch ms of the announced V4 Pro route switch: 2026-09-14 12:00
 * Beijing time (UTC+8, no DST) = 04:00 UTC. From that instant the V4 Pro route
 * is served by V4.1 Flash and billed at the V4.1 Flash rates.
 */
export declare const V4_PRO_ROUTE_SWITCH_AT: number;
/**
 * Official peak/off-peak rates (CNY per 1M tokens) per model, as dated
 * revisions. Base rows are the schedule effective 2026-08-17; the V4 Flash
 * series (V4.1 Flash, V4 Flash, V4 Flash Vision Exp) carries the second
 * revision effective 2026-09-10 12:00 Beijing, and the V4 Pro row the V4.1
 * Flash rates from its announced route switch (2026-09-14 12:00 Beijing) —
 * the MiMo series (V2.5, and V2.6 which kept V2.5's pricing) is untouched by
 * either adjustment. Rows sharing a model are that model's rate history.
 */
export declare const DEFAULT_MODEL_PRICING: readonly BillingConfigModel[];
//# sourceMappingURL=pricing-table.d.ts.map