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
import { beijingPartsOf } from "./beijing-time.js";
import { DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS } from "./pricing-table.js";
// Declared here before the table moved out; re-exported so the package's public
// surface and its tests keep importing them from the billing entry point.
export { DEFAULT_MODEL_PRICING, DEFAULT_PEAK_HOURS, FLASH_SERIES_RATE_CHANGE_AT, V4_PRO_ROUTE_SWITCH_AT } from "./pricing-table.js";
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
export function resolveBilling(config) {
    const peakHours = config?.peakHours !== undefined && config.peakHours.length > 0
        ? config.peakHours
        : DEFAULT_PEAK_HOURS;
    const rows = config?.models !== undefined && config.models.length > 0
        ? config.models
        : DEFAULT_MODEL_PRICING;
    const schedules = new Map();
    for (const row of rows) {
        // Spelled out per branch: `exactOptionalPropertyTypes` forbids handing an
        // explicit `undefined` to an optional field.
        const revision = row.effectiveFrom === undefined
            ? { peak: row.peak, offPeak: row.offPeak }
            : { effectiveFrom: row.effectiveFrom, peak: row.peak, offPeak: row.offPeak };
        const revisions = schedules.get(row.model);
        if (revisions === undefined) {
            schedules.set(row.model, [revision]);
            continue;
        }
        const duplicate = revisions.findIndex(candidate => candidate.effectiveFrom === revision.effectiveFrom);
        if (duplicate >= 0)
            revisions[duplicate] = revision;
        else
            revisions.push(revision);
    }
    const models = new Map();
    for (const [model, revisions] of schedules) {
        revisions.sort((left, right) => (left.effectiveFrom ?? Number.NEGATIVE_INFINITY) - (right.effectiveFrom ?? Number.NEGATIVE_INFINITY));
        const newest = revisions[revisions.length - 1];
        models.set(model, { peak: newest.peak, offPeak: newest.offPeak, revisions });
    }
    return { peakHours, models };
}
/**
 * The rate revision in effect at one instant: the newest revision that took
 * effect at or before it. Revisions are ascending, so the scan stops at the
 * first future one. An instant before the earliest dated revision bills at that
 * earliest revision — a model with only dated rows is never left unpriced.
 */
function ratesAt(revisions, time) {
    let chosen = revisions[0];
    for (let index = 1; index < revisions.length; index += 1) {
        const revision = revisions[index];
        if (revision.effectiveFrom === undefined || revision.effectiveFrom > time)
            break;
        chosen = revision;
    }
    return chosen;
}
/** Whether a Beijing (hour, weekday) pair falls inside any peak-hour window. */
function isPeakParts(billing, hour, weekday) {
    if (weekday === 0 || weekday === 6)
        return false;
    return billing.peakHours.some(({ start, end }) => hour >= start && hour < end);
}
/**
 * Whether a timestamp falls inside any peak-hour window (Beijing time,
 * weekdays Monday–Friday only). Weekends (Saturday and Sunday) are always
 * off-peak, matching the published peak-hours rule.
 * @param billing - resolved pricing with peak-hour windows.
 * @param now - the moment to classify.
 * @returns true during a weekday peak hour.
 */
export function isPeak(billing, now) {
    const { hour, weekday } = beijingPartsOf(now.getTime());
    return isPeakParts(billing, hour, weekday);
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
export function priceEvent(event, billing, names) {
    return priceEventAt(beijingPartsOf(event.time), event, billing, names);
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
export function priceEventAt(parts, event, billing, names) {
    if (event.type !== 'assistant/message')
        return undefined;
    const reported = event.data.usage;
    if (reported === undefined)
        return undefined;
    return priceUsage(parts, reported, event.data.message.source.model, billing, names);
}
/** Every token one usage sample reports, whether or not it gets priced. */
export function usageTokens(usage) {
    return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** Max distinct model ids remembered for the once-only warning. */
const UNPRICED_WARN_LIMIT = 64;
/** Model ids already reported, so a long-running host logs each one once. */
const reportedUnpricedModels = new Set();
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
export function reportUnpricedModel(model) {
    if (reportedUnpricedModels.has(model) || reportedUnpricedModels.size >= UNPRICED_WARN_LIMIT)
        return;
    reportedUnpricedModels.add(model);
    console.warn(`[llm-billing] no pricing row for model "${model}" — its usage is NOT billed; add its row under billing.models to price it`);
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
export function priceUsage(parts, usage, model, billing, names) {
    const pricing = billing.models.get(model);
    if (pricing === undefined)
        return undefined;
    const peak = isPeakParts(billing, parts.hour, parts.weekday);
    const revision = ratesAt(pricing.revisions, parts.time);
    const price = peak ? revision.peak : revision.offPeak;
    const hit = usage.cacheReadTokens ?? 0;
    const miss = usage.inputTokens + (usage.cacheWriteTokens ?? 0);
    const output = usage.outputTokens;
    const hitCost = (hit * price.cacheHitInput) / 1_000_000;
    const missCost = (miss * price.cacheMissInput) / 1_000_000;
    const outputCost = (output * price.output) / 1_000_000;
    const cost = hitCost + missCost + outputCost;
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
    };
}
//# sourceMappingURL=pricing.js.map