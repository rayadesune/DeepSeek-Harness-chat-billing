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
export {};
//# sourceMappingURL=types.js.map