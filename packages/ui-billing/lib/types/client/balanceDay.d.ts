/**
 * Today's consumption measured from the API balance series itself: the day's
 * FIRST queried balance minus the current one, plus every top-up the series
 * showed in between. Pure API arithmetic — no token pricing involved — and the
 * same caliber as the `balanceinfo` program this mirrors (`utils/balance.ts`
 * + `Dashboard.tsx` there): a top-up is an observed INCREASE rounded UP to the
 * next ¥10 step (the provider tops up in round tens, so a ¥9 rise after a ¥10
 * top-up and ¥1 of spend still reads as ¥10), which is what keeps a day that
 * was topped up and then spent down from reporting a negative consumption.
 *
 * This is a SEPARATE caliber from the panel's priced 今日花费: that figure
 * prices THIS machine's own event logs, while this one is the account's own
 * arithmetic, so spend from another client — or from before this browser was
 * open — shows up here and nowhere else. The two figures legitimately differ.
 *
 * The day rolls over on the LOCAL calendar day (the reference program's
 * `toLocalDayKey`, deliberately not the host's Beijing day key: only the
 * browser knows which day the user reading the panel is in), and the record is
 * persisted through a `localStorage`-shaped seam so the day's first sample
 * survives a reload — and a `dsh` restart — instead of resetting the baseline
 * to whatever the balance happens to be at the next mount.
 *
 * Every amount is carried in integer cents: the API reports decimal strings,
 * and the arithmetic (differences, the ¥10 step) must not drift through binary
 * floats.
 */
import type { DeepSeekBalance } from '@rayadesu/dsh-llm-billing/types';
/** `localStorage` key the day record is persisted under. */
export declare const BALANCE_DAY_STORAGE_KEY = "dsh.billing.balance-day.v1";
/** One top-up step in cents: an observed increase rounds UP to the next ¥10. */
export declare const TOP_UP_STEP_CENTS = 1000;
/** One currency's samples within the recorded day; every amount is in cents. */
export interface BalanceDayCurrency {
    /** The day's FIRST queried balance — the baseline every consumption is measured from. */
    first: number;
    /** The day's newest queried balance. */
    last: number;
    /** Top-ups detected between the day's samples, in cents. */
    recharge: number;
}
/** The samples of ONE local calendar day, per currency. */
export interface BalanceDayRecord {
    /** Format revision; a record another revision wrote reads as no record. */
    v: 1;
    /** Local calendar day (`YYYY-MM-DD`) every sample in this record belongs to. */
    day: string;
    /** Per-currency accumulators, keyed by the API's currency code. */
    currencies: Record<string, BalanceDayCurrency>;
}
/** The `localStorage` slice the tracker persists through; injectable for tests. */
export interface BalanceDayStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/**
 * `YYYY-MM-DD` of one instant in the LOCAL calendar day — the day key the
 * mirrored program uses (`toLocalDayKey`), and the key a user's "today" means.
 * @param date - the instant to key.
 * @returns the local day key.
 */
export declare function localDayKey(date: Date): string;
/**
 * The top-up one observed increase implies, in cents: the mirrored program's
 * `rechargeFromGrowth` — a growth of ¥9 (topped up ¥10, spent ¥1) reads as
 * ¥10, ¥23 as ¥30, and a growth of zero or less as nothing at all.
 * @param growthCents - the increase between two adjacent samples, in cents.
 * @returns the top-up the increase implies, in cents.
 */
export declare function topUpFromGrowthCents(growthCents: number): number;
/**
 * Parse one persisted record. Anything malformed — foreign JSON, another
 * revision, a non-numeric accumulator — reads as NO record, so a corrupted
 * store costs one day's baseline instead of throwing inside a render.
 * @param raw - the stored string, or `null` when nothing was stored.
 * @returns the decoded record, or `null` when there is nothing usable.
 */
export declare function decodeBalanceDayRecord(raw: string | null): BalanceDayRecord | null;
/**
 * Fold one queried balance into the day record. A sample of a NEW local day
 * starts a fresh record whose baseline IS that sample; a sample of the
 * recorded day banks any increase as a top-up and moves the series' last value
 * forward. A currency the snapshot does not carry keeps its earlier sample, so
 * a provider that reports a line intermittently cannot reset the baseline.
 * @param record - the record so far, or `null` before the first sample.
 * @param balance - the freshly queried balance snapshot.
 * @param now - the instant of the sample (its local day is the record's day).
 * @returns the updated record.
 */
export declare function applyBalanceSample(record: BalanceDayRecord | null, balance: DeepSeekBalance, now: Date): BalanceDayRecord;
/**
 * Today's consumption for the snapshot's PRIMARY line — the line the panel
 * shows as `API 剩余金额` — or `null` when today holds no sample for that
 * currency: a figure nothing measured stays HIDDEN rather than reading as ¥0.
 * The amount is clamped at zero exactly like the mirrored program, so a
 * balance that grew without an identifiable top-up (an increase below one ¥10
 * step, which no top-up could have produced) never prints as a negative
 * consumption.
 * @param record - the day record, or `null` before the first sample.
 * @param balance - the balance snapshot whose primary line is on screen.
 * @param now - the instant the figure is rendered at (its local day is "today").
 * @returns the consumption in yuan, or `null` when it cannot be measured.
 */
export declare function balanceDaySpendOf(record: BalanceDayRecord | null, balance: DeepSeekBalance, now: Date): number | null;
/** The day tracker the browser half shares across badge mounts. */
export interface BalanceDayTracker {
    /** Fold one freshly queried balance into the day record and persist it. */
    record(balance: DeepSeekBalance, now?: Date): void;
    /** Today's consumption for one balance snapshot, or `null` before today's first sample. */
    spend(balance: DeepSeekBalance, now?: Date): number | null;
}
/**
 * Build the tracker over one storage seam. A store that is absent or throws
 * (private mode, a blocked quota) degrades to memory-only: the record still
 * works for the life of the page, and neither reading nor writing it can take
 * the balance display down.
 * @param storage - the persistence seam; omit for a memory-only tracker.
 * @returns the tracker.
 */
export declare function createBalanceDayTracker(storage?: BalanceDayStorage): BalanceDayTracker;
/**
 * The page's own `localStorage`, or `undefined` where it is absent or refuses
 * access. A sandboxed frame or a store blocked by the browser throws on
 * ACCESS, so the seam is probed with a read before it is handed out. The probe
 * only reads, so it leaves nothing behind on the host page.
 * @returns the seam, or `undefined` when this page has no usable store.
 */
export declare function browserBalanceDayStorage(): BalanceDayStorage | undefined;
//# sourceMappingURL=balanceDay.d.ts.map