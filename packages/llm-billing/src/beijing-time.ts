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
export function beijingDayRangeOfKey(dayKey: string): { readonly start: number, readonly end: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (match === null) return undefined
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(utcMidnight)) return undefined
  return { start: utcMidnight - BEIJING_OFFSET_MS, end: utcMidnight + DAY_MS - BEIJING_OFFSET_MS }
}
