/**
 * Beijing wall-clock arithmetic (Asia/Shanghai: a fixed UTC+8, no DST) — the
 * calendar fields a sample's rate depends on, and the day boundaries a scan is
 * clipped to. Split out of `billing.ts`: pricing asks this module questions, it
 * never asks about pricing.
 * @module @rayadesu/dsh-llm-billing/beijing-time
 */
/** One shifted-timestamp view of a Beijing (UTC+8, no DST) instant. */
export interface BeijingParts {
    /**
     * The instant in epoch milliseconds. Pricing needs it back to resolve the
     * rate revision in effect at the sample's own timestamp (see
     * {@link ratesAt}), so the view carries it instead of a second parse.
     */
    time: number;
    /** Beijing hour, `0`–`23`. */
    hour: number;
    /** Beijing weekday as `getUTCDay()`: `0` is Sunday, `6` is Saturday. */
    weekday: number;
    /** Beijing calendar-day key (`YYYY-MM-DD`). */
    dayKey: string;
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
export declare function beijingPartsOf(time: number): BeijingParts;
/** The Beijing (Asia/Shanghai, UTC+8, no DST) calendar-day key of a timestamp. */
export declare function beijingDayKey(now: Date): string;
/**
 * The Beijing calendar day NAMED by `dayKey` as an epoch-millisecond range:
 * `start` inclusive, `end` exclusive. Derived from the key itself rather than
 * from a clock, because a scan prices whatever day it was asked for — today,
 * or a day a caller is replaying.
 *
 * The conversion needs no calendar arithmetic: `Date.UTC` builds midnight UTC
 * of that civil date, and Beijing midnight is a fixed offset earlier (no DST).
 * @param dayKey - a `YYYY-MM-DD` Beijing day key.
 * @returns the day's bounds, or `undefined` when the key is not that shape.
 */
export declare function beijingDayRangeOfKey(dayKey: string): {
    readonly start: number;
    readonly end: number;
} | undefined;
//# sourceMappingURL=beijing-time.d.ts.map