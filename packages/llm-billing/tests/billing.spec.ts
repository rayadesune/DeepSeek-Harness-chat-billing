/**
 * Session spend pricing: pricing resolution, weekday peak-hour classification
 * (weekends are always off-peak), and the per-session spend conversion. Pure
 * functions only, so the suite is keyless and deterministic.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  addEventContribution,
  beijingDayKey,
  beijingPartsOf,
  computeSessionSpend,
  computeSessionTurnSpends,
  computeTodaySpend,
  computeTurnSpend,
  emptyTodaySpend,
  FLASH_SERIES_RATE_CHANGE_AT,
  forkBoundaryOf,
  isPeak,
  isSeededSession,
  mergeTodaySpend,
  negateSpend,
  priceEvent,
  resolveBilling,
  SessionTurnSpendFolder,
  SpendAccumulator,
  subtractSpend,
  V4_PRO_ROUTE_SWITCH_AT,
} from '../src/billing.ts'
import type { BillingEventContribution, DeepSeekTodaySpend } from '../src/billing.ts'

function assistantMessage(model: string, usage: TokenUsage, time = 0, seq = 0): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 0,
      // One message per step: distinct seqs must not collide on the
      // `(turn, step)` replacement slot.
      step: seq,
      message: {
        id: 'm' as never,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'deepseek-official', model },
      },
      usage,
    },
  } as unknown as SessionEvent
}

const FLASH = 'deepseek-v4-flash'
/** The V4.1 Flash route id DSH's `llm-deepseek` catalog defaults to. */
const V41_FLASH_ROUTE = 'deepseek-flash'
/** The retired V4.1 Flash preview id, kept for the logs that used it. */
const V41_FLASH = 'deepseek-v4.1-flash-expires-on-0910'
const PRO = 'deepseek-v4-pro'
const VISION_EXP = 'deepseek-v4-flash-vision-exp'
const MIMO_PRO = 'mimo-v2.5-pro'
const MIMO = 'mimo-v2.5'
/** Every route billed at the V4 Flash series rates. */
const FLASH_SERIES = [V41_FLASH_ROUTE, FLASH, V41_FLASH, VISION_EXP] as const
const CATALOG = [
  { id: V41_FLASH_ROUTE, name: 'DeepSeek-V41-Flash' },
  { id: FLASH, name: 'DeepSeek-V4-Flash' },
  { id: V41_FLASH, name: 'DeepSeek-V4.1-Flash' },
  { id: PRO, name: 'DeepSeek-V4-Pro' },
  { id: VISION_EXP, name: 'DeepSeek-V4-Flash-Vision-Exp' },
  { id: MIMO_PRO, name: 'MiMo-V2.5-Pro' },
  { id: MIMO, name: 'MiMo-V2.5' },
  { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro' },
  { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
]

/**
 * The V4 Flash series' two published revisions (CNY per 1M tokens): the base
 * schedule effective 2026-08-17 and the re-pricing effective 2026-09-10 12:00
 * Beijing. The plugin ships them in `DEFAULT_MODEL_PRICING`; the suite restates
 * them where a config row must spell its rates out.
 */
const BASE_RATES = {
  peak: { cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 },
  offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
}
const REPRICED_RATES = {
  peak: { cacheHitInput: 0.04, cacheMissInput: 2.0, output: 8.0 },
  offPeak: { cacheHitInput: 0.02, cacheMissInput: 1.0, output: 4.0 },
}
/** V4 Pro's own rates, in force until its announced 2026-09-14 route switch. */
const PRO_RATES = {
  peak: { cacheHitInput: 0.30, cacheMissInput: 9.0, output: 27.0 },
  offPeak: { cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 },
}

describe('resolveBilling', () => {
  it('uses the published defaults when no config is supplied', () => {
    const billing = resolveBilling(undefined)
    expect(billing.peakHours).toEqual([{ start: 9, end: 12 }, { start: 14, end: 18 }])
    // `peak`/`offPeak` are the newest revision: every flash-series route (V4.1
    // Flash — also DSH's current default route — V4 Flash, the retired preview
    // id, and V4 Flash Vision Exp) was re-priced effective 2026-09-10 12:00
    // Beijing to off-peak 0.02 / 1.0 / 4.0, peak at twice those prices.
    for (const model of FLASH_SERIES) {
      expect(billing.models.get(model)?.peak).toEqual(REPRICED_RATES.peak)
      expect(billing.models.get(model)?.offPeak).toEqual(REPRICED_RATES.offPeak)
      expect(billing.models.get(model)?.revisions).toHaveLength(2)
    }
    // V4 Pro keeps its own rates until the announced 2026-09-14 12:00 route
    // switch, which is why the exposed pair is now the V4.1 Flash one.
    expect(billing.models.get(PRO)?.peak).toEqual(REPRICED_RATES.peak)
    expect(billing.models.get(PRO)?.offPeak).toEqual(REPRICED_RATES.offPeak)
    expect(billing.models.get(PRO)?.revisions?.[0]).toEqual({ effectiveFrom: undefined, ...PRO_RATES })
    // MiMo-V2.5 series: flat rate (peak === offPeak).
    expect(billing.models.get(MIMO_PRO)?.peak)
      .toEqual({ cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 })
    expect(billing.models.get(MIMO_PRO)?.offPeak)
      .toEqual({ cacheHitInput: 0.025, cacheMissInput: 3.0, output: 6.0 })
    expect(billing.models.get(MIMO)?.peak)
      .toEqual({ cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 })
    expect(billing.models.get(MIMO)?.offPeak)
      .toEqual({ cacheHitInput: 0.02, cacheMissInput: 1.0, output: 2.0 })
  })

  it('prices every route of the DSH llm-deepseek default catalog', () => {
    const billing = resolveBilling(undefined)
    // The catalog DSH ships today: V4.1 Flash (its default route), V4 Flash,
    // V4 Pro, and V4 Flash Vision Exp.
    for (const id of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
      expect(billing.models.has(id)).toBe(true)
      expect(billing.models.get(id)?.revisions.length).toBeGreaterThan(0)
    }
  })

  it('keeps the published rate history per model, oldest first', () => {
    const billing = resolveBilling(undefined)
    const flash = billing.models.get(FLASH)?.revisions
    expect(flash).toHaveLength(2)
    expect(flash?.[0]).toEqual({ effectiveFrom: undefined, ...BASE_RATES })
    expect(flash?.[1]).toEqual({ effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT, ...REPRICED_RATES })
    // The re-pricing instant is 2026-09-10 12:00 Beijing time (04:00 UTC), and
    // it covered the whole flash series, V4.1 Flash included.
    expect(FLASH_SERIES_RATE_CHANGE_AT).toBe(Date.parse('2026-09-10T12:00:00+08:00'))
    for (const model of FLASH_SERIES) expect(billing.models.get(model)?.revisions).toEqual(flash)
    // V4 Pro carries its own pair plus the V4.1 Flash pair from the announced
    // route switch (2026-09-14 12:00 Beijing = 04:00 UTC).
    expect(V4_PRO_ROUTE_SWITCH_AT).toBe(Date.parse('2026-09-14T12:00:00+08:00'))
    expect(billing.models.get(PRO)?.revisions).toEqual([
      { effectiveFrom: undefined, ...PRO_RATES },
      { effectiveFrom: V4_PRO_ROUTE_SWITCH_AT, ...REPRICED_RATES },
    ])
    expect(billing.models.get(MIMO)?.revisions).toHaveLength(1)
  })

  it('overrides a model when an explicit row is supplied', () => {
    const billing = resolveBilling({
      models: [{
        model: FLASH,
        peak: { cacheHitInput: 1, cacheMissInput: 2, output: 3 },
        offPeak: { cacheHitInput: 0.5, cacheMissInput: 1, output: 1.5 },
      }],
    })
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 1, cacheMissInput: 2, output: 3 })
    expect(billing.models.get(FLASH)?.revisions).toHaveLength(1)
    expect(billing.models.has(PRO)).toBe(false)
  })

  it('orders config rows into a revision history whatever order they arrive in', () => {
    const billing = resolveBilling({
      models: [
        // The dated revision first: resolution sorts it after the base row, and
        // the newest revision stays the exposed pair.
        { model: FLASH, effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT, ...REPRICED_RATES },
        { model: FLASH, ...BASE_RATES },
      ],
    })
    expect(billing.models.get(FLASH)?.revisions?.map(revision => revision.effectiveFrom))
      .toEqual([undefined, FLASH_SERIES_RATE_CHANGE_AT])
    expect(billing.models.get(FLASH)?.offPeak).toEqual(REPRICED_RATES.offPeak)
  })

  it('lets a later row replace an earlier one declaring the same effective instant', () => {
    const flat = { cacheHitInput: 1, cacheMissInput: 1, output: 1 }
    const billing = resolveBilling({
      models: [
        { model: FLASH, ...BASE_RATES },
        { model: FLASH, peak: flat, offPeak: flat },
      ],
    })
    expect(billing.models.get(FLASH)?.revisions).toHaveLength(1)
    expect(billing.models.get(FLASH)?.peak).toEqual(flat)
  })

  it('falls back to the defaults for empty arrays (schemastery materializes absent z.array as [])', () => {
    const billing = resolveBilling({ models: [], peakHours: [] })
    expect(billing.models.get(FLASH)?.peak).toEqual(REPRICED_RATES.peak)
    expect(billing.models.get(PRO)?.offPeak).toEqual(REPRICED_RATES.offPeak)
    expect(billing.peakHours).toEqual([{ start: 9, end: 12 }, { start: 14, end: 18 }])
  })
})

describe('isPeak', () => {
  it('classifies weekday Beijing daytime hours as peak and others as off-peak', () => {
    const billing = resolveBilling(undefined)
    // 10:00 Beijing = 02:00 UTC; 20:00 Beijing = 12:00 UTC; 2026-08-20 is a Thursday.
    expect(isPeak(billing, new Date('2026-08-20T02:00:00Z'))).toBe(true)
    expect(isPeak(billing, new Date('2026-08-20T12:00:00Z'))).toBe(false)
  })

  it('treats weekends as off-peak all day, even inside a weekday peak window', () => {
    const billing = resolveBilling(undefined)
    // 2026-08-22 is a Saturday and 2026-08-23 a Sunday; 02:00Z is 10:00 Beijing,
    // which is peak on weekdays but off-peak on weekends.
    expect(isPeak(billing, new Date('2026-08-22T02:00:00Z'))).toBe(false)
    expect(isPeak(billing, new Date('2026-08-23T02:00:00Z'))).toBe(false)
    // Weekend hours outside the windows are off-peak too.
    expect(isPeak(billing, new Date('2026-08-22T12:00:00Z'))).toBe(false)
  })
})

describe('forkBoundaryOf', () => {
  it('returns 0 for a missing header or an unseeded session', () => {
    expect(forkBoundaryOf(undefined)).toBe(0)
    expect(forkBoundaryOf({})).toBe(0)
    expect(forkBoundaryOf({ seedLength: undefined })).toBe(0)
    expect(forkBoundaryOf({ inheritedEventCount: 0 })).toBe(0)
  })

  it('returns the durable inherited-prefix length when the header carries seedLength', () => {
    expect(forkBoundaryOf({ seedLength: 7 })).toBe(7)
  })

  it('reads the boundary from every runtime family shape', () => {
    // 0.1.2-alpha.4+ Session / SessionInspection: the exact cut is a top-level field.
    expect(forkBoundaryOf({ inheritedEventCount: 3 })).toBe(3)
    // ≤ 0.1.1-rc.2 Session: the cut lived on the durable header.
    expect(forkBoundaryOf({ header: { seedLength: 4 } })).toBe(4)
    // ≤ 0.1.1-rc.2 persistence inspect: the cut lived on meta.
    expect(forkBoundaryOf({ meta: { seedLength: 5 } })).toBe(5)
  })

  it('prefers the newer inherited count over legacy header fields', () => {
    expect(forkBoundaryOf({ inheritedEventCount: 9, header: { seedLength: 2 }, meta: { seedLength: 3 }, seedLength: 4 }))
      .toBe(9)
  })
})

describe('isSeededSession', () => {
  it('recognizes a seeded session on both runtime families', () => {
    // 0.1.2-alpha.4+ snapshot header: boolean only.
    expect(isSeededSession({ isSeeded: true })).toBe(true)
    expect(isSeededSession({ isSeeded: false })).toBe(false)
    // ≤ 0.1.1-rc.2 snapshot header: nonzero seedLength marked the fork cut.
    expect(isSeededSession({ seedLength: 2 })).toBe(true)
    expect(isSeededSession({ seedLength: 0 })).toBe(false)
    expect(isSeededSession({})).toBe(false)
    expect(isSeededSession(undefined)).toBe(false)
  })
})

describe('beijingPartsOf', () => {
  it('derives the Beijing day, hour, and weekday with pure arithmetic', () => {
    // 2026-08-20 02:00Z = 10:00 Beijing on a Thursday. The view also carries the
    // instant itself, which rate-revision pricing needs back.
    const peak = Date.parse('2026-08-20T02:00:00Z')
    expect(beijingPartsOf(peak)).toEqual({ time: peak, hour: 10, weekday: 4, dayKey: '2026-08-20' })
    // 16:30Z = 00:30 Beijing the NEXT calendar day (Friday).
    const past = Date.parse('2026-08-20T16:30:00Z')
    expect(beijingPartsOf(past)).toEqual({ time: past, hour: 0, weekday: 5, dayKey: '2026-08-21' })
    // 2026-08-22 is a Saturday; 2026-08-23 a Sunday.
    expect(beijingPartsOf(Date.parse('2026-08-22T02:00:00Z')).weekday).toBe(6)
    expect(beijingPartsOf(Date.parse('2026-08-23T02:00:00Z')).weekday).toBe(0)
  })

  it('handles month, year, and leap-day boundaries', () => {
    // 2026-12-31 16:00Z = 2027-01-01 00:00 Beijing.
    expect(beijingPartsOf(Date.parse('2026-12-31T16:00:00Z')).dayKey).toBe('2027-01-01')
    // 2028 is a leap year: 2028-02-28 16:00Z = 2028-02-29 00:00 Beijing.
    expect(beijingPartsOf(Date.parse('2028-02-28T16:00:00Z')).dayKey).toBe('2028-02-29')
    // 1970-01-01 00:00Z is a Thursday (epoch edge).
    expect(beijingPartsOf(0)).toEqual({ time: 0, hour: 8, weekday: 4, dayKey: '1970-01-01' })
  })

  it('rejects a non-finite timestamp loudly', () => {
    expect(() => beijingPartsOf(Number.NaN)).toThrow(RangeError)
  })

  it('agrees with the Date-based day key on the current instant', () => {
    const now = new Date()
    const reference = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
    expect(beijingDayKey(now)).toBe(reference)
    expect(beijingPartsOf(now.getTime()).dayKey).toBe(reference)
  })
})

describe('computeSessionSpend', () => {
  // 2026-08-20 is a Thursday (weekday): 02:00Z is 10:00 Beijing (peak);
  // 12:00Z is 20:00 Beijing (off-peak).
  const PEAK = Date.parse('2026-08-20T02:00:00Z')
  const OFF_PEAK = Date.parse('2026-08-20T12:00:00Z')
  // Flash peak: hit 0.10, miss 3.0, output 9.0 CNY/M; off-peak: 0.05, 1.5, 4.5.
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }

  it('prices cache hit, cache miss (including writes), and output at the peak rate for a peak-hour event', () => {
    const spend = computeSessionSpend([assistantMessage(FLASH, USAGE, PEAK)], resolveBilling(undefined), CATALOG)
    expect(spend.total).toBeCloseTo(0.10 + 4.50 + 9.00, 10)
    expect(spend.models).toHaveLength(1)
    const row = spend.models[0]
    expect(row?.displayName).toBe('DeepSeek-V4-Flash')
    expect(row?.cost).toBeCloseTo(13.60, 10)
    expect(row?.peakCost).toBeCloseTo(13.60, 10)
    expect(row?.offPeakCost).toBe(0)
    expect(row?.cacheHitInputTokens).toBe(1_000_000)
    expect(row?.cacheMissInputTokens).toBe(1_500_000)
    expect(row?.outputTokens).toBe(1_000_000)
    expect(row?.cacheHitInputCost).toBeCloseTo(0.10, 10)
    expect(row?.cacheMissInputCost).toBeCloseTo(4.50, 10)
    expect(row?.outputCost).toBeCloseTo(9.00, 10)
  })

  it('prices the same usage at the off-peak rate for an off-peak-hour event', () => {
    const spend = computeSessionSpend([assistantMessage(FLASH, USAGE, OFF_PEAK)], resolveBilling(undefined), CATALOG)
    expect(spend.total).toBeCloseTo(0.05 + 2.25 + 4.50, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(6.80, 10)
    expect(spend.models[0]?.peakCost).toBe(0)
    expect(spend.models[0]?.cacheHitInputCost).toBeCloseTo(0.05, 10)
    expect(spend.models[0]?.cacheMissInputCost).toBeCloseTo(2.25, 10)
    expect(spend.models[0]?.outputCost).toBeCloseTo(4.50, 10)
  })

  it('splits peak and off-peak portions across mixed-hour events', () => {
    const spend = computeSessionSpend(
      [assistantMessage(FLASH, USAGE, PEAK, 0), assistantMessage(FLASH, USAGE, OFF_PEAK, 1)],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBeCloseTo(13.60 + 6.80, 10)
    expect(spend.models[0]?.peakCost).toBeCloseTo(13.60, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(6.80, 10)
  })

  it('prices every flash-series route exactly like flash, with its own label', () => {
    const billing = resolveBilling(undefined)
    const labels: Record<string, string> = {
      [FLASH]: 'DeepSeek-V4-Flash',
      [V41_FLASH_ROUTE]: 'DeepSeek-V41-Flash',
      [V41_FLASH]: 'DeepSeek-V4.1-Flash',
      [VISION_EXP]: 'DeepSeek-V4-Flash-Vision-Exp',
    }
    for (const [time, expected] of [[PEAK, 13.60], [OFF_PEAK, 6.80]] as const) {
      const flash = computeSessionSpend([assistantMessage(FLASH, USAGE, time)], billing, CATALOG)
      for (const model of FLASH_SERIES) {
        const spend = computeSessionSpend([assistantMessage(model, USAGE, time)], billing, CATALOG)
        expect(spend.total).toBeCloseTo(expected, 10)
        expect(spend.total).toBeCloseTo(flash.total, 10)
        expect(spend.models[0]?.displayName).toBe(labels[model])
        expect(spend.models[0]?.cacheHitInputTokens).toBe(flash.models[0]?.cacheHitInputTokens)
        expect(spend.models[0]?.cacheMissInputTokens).toBe(flash.models[0]?.cacheMissInputTokens)
        expect(spend.models[0]?.outputTokens).toBe(flash.models[0]?.outputTokens)
      }
    }
  })

  it('prices a weekend event at the off-peak rate even during a weekday peak window', () => {
    // 2026-08-22 02:00Z is Saturday 10:00 Beijing — inside the weekday peak
    // window, but weekends are always off-peak (effective 2026-08-23).
    const WEEKEND_PEAK_HOUR = Date.parse('2026-08-22T02:00:00Z')
    const spend = computeSessionSpend(
      [assistantMessage(FLASH, USAGE, WEEKEND_PEAK_HOUR)],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBeCloseTo(0.05 + 2.25 + 4.50, 10)
    expect(spend.models[0]?.peakCost).toBe(0)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(6.80, 10)
  })

  it('omits a model that reported usage but has no pricing row', () => {
    const spend = computeSessionSpend(
      [assistantMessage('other-model', USAGE, PEAK)],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBe(0)
    expect(spend.models).toEqual([])
  })

  it('returns a zero total for a session without billed usage', () => {
    const spend = computeSessionSpend(
      [{ type: 'turn/start', seq: 0, time: PEAK, data: { turn: 0 } }],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBe(0)
    expect(spend.models).toEqual([])
  })

  it('prices only events at or after startSeq, matching the sliced log (fork boundary)', () => {
    const events = [
      assistantMessage(FLASH, USAGE, PEAK, 0),
      assistantMessage(FLASH, USAGE, PEAK, 1),
      assistantMessage(FLASH, USAGE, OFF_PEAK, 2),
    ]
    const spend = computeSessionSpend(events, resolveBilling(undefined), CATALOG, 2)
    expect(spend.total).toBeCloseTo(6.80, 10)
    expect(spend).toEqual(computeSessionSpend([events[2]!], resolveBilling(undefined), CATALOG))
  })
})

describe('rate revisions (V4 Flash series re-priced 2026-09-10 12:00 Beijing)', () => {
  // 2026-09-10 is a Thursday. 03:59:59.999Z = 11:59:59.999 Beijing, the last
  // instant of a peak window under the base rates; 04:00:00Z = 12:00 Beijing,
  // the first instant of the second revision (inside the off-peak window);
  // 2026-09-11 02:00Z = Friday 10:00 Beijing, a peak hour under the second
  // revision.
  const BEFORE = Date.parse('2026-09-10T03:59:59.999Z')
  const AT = Date.parse('2026-09-10T04:00:00Z')
  const NEXT_PEAK = Date.parse('2026-09-11T02:00:00Z')
  const BASE_PEAK = Date.parse('2026-08-20T02:00:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }
  const BILLING = resolveBilling(undefined)
  // 1M cache-hit + 1.5M cache-miss + 1M output, per schedule:
  // base peak 0.10 + 4.50 + 9.00 = 13.60; base off-peak 0.05 + 2.25 + 4.50 =
  // 6.80; re-priced peak 0.04 + 3.00 + 8.00 = 11.04; re-priced off-peak
  // 0.02 + 1.50 + 4.00 = 5.52.
  const BASE_PEAK_COST = 13.60
  const REPRICED_PEAK_COST = 11.04
  const REPRICED_OFF_PEAK_COST = 5.52

  it('prices the last instant before the change at the base rates', () => {
    const spend = computeSessionSpend([assistantMessage(FLASH, USAGE, BEFORE)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(BASE_PEAK_COST, 10)
    expect(spend.models[0]?.peakCost).toBeCloseTo(BASE_PEAK_COST, 10)
    expect(spend.models[0]?.cacheHitInputCost).toBeCloseTo(0.10, 10)
    expect(spend.models[0]?.outputCost).toBeCloseTo(9.00, 10)
  })

  it('prices the change instant itself at the re-priced off-peak rates', () => {
    const spend = computeSessionSpend([assistantMessage(FLASH, USAGE, AT)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
    expect(spend.models[0]?.peakCost).toBe(0)
    expect(spend.models[0]?.cacheHitInputCost).toBeCloseTo(0.02, 10)
    expect(spend.models[0]?.cacheMissInputCost).toBeCloseTo(1.50, 10)
    expect(spend.models[0]?.outputCost).toBeCloseTo(4.00, 10)
  })

  it('prices later peak hours at twice the re-priced off-peak prices', () => {
    const spend = computeSessionSpend([assistantMessage(FLASH, USAGE, NEXT_PEAK)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(REPRICED_PEAK_COST, 10)
    expect(spend.models[0]?.peakCost).toBeCloseTo(REPRICED_PEAK_COST, 10)
  })

  it('re-prices every model of the flash series, not only V4 Flash', () => {
    for (const model of FLASH_SERIES) {
      const spend = computeSessionSpend([assistantMessage(model, USAGE, AT)], BILLING, CATALOG)
      expect(spend.total).toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
    }
  })

  it('prices the V4.1 Flash route (DSH\'s default deepseek-flash) across the change', () => {
    // The route DSH defaults to since the release: its usage from before 12:00
    // today keeps the base rates, later usage takes the new ones.
    const before = computeSessionSpend([assistantMessage(V41_FLASH_ROUTE, USAGE, BEFORE)], BILLING, CATALOG)
    const after = computeSessionSpend([assistantMessage(V41_FLASH_ROUTE, USAGE, AT)], BILLING, CATALOG)
    expect(before.models[0]?.displayName).toBe('DeepSeek-V41-Flash')
    expect(before.total).toBeCloseTo(BASE_PEAK_COST, 10)
    expect(after.total).toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
  })

  it('leaves V4 Pro on its base rates across the change', () => {
    // V4 Pro is untouched by the 2026-09-10 re-pricing (its own route switch
    // comes later, on 2026-09-14): peak 0.30 + 9.00 × 1.5 + 27.00 = 40.80.
    const before = computeSessionSpend([assistantMessage(PRO, USAGE, BASE_PEAK)], BILLING, CATALOG)
    const after = computeSessionSpend([assistantMessage(PRO, USAGE, NEXT_PEAK)], BILLING, CATALOG)
    expect(after.total).toBeCloseTo(40.80, 10)
    expect(after.total).toBeCloseTo(before.total, 10)
  })

  it('sums the base-rate and re-priced portions of one Beijing day', () => {
    // 2026-09-10 11:00 Beijing (03:00Z, peak, base rates) and 13:00 Beijing
    // (05:00Z, off-peak, second revision) are both on the change day.
    const spend = computeTodaySpend([
      assistantMessage(FLASH, USAGE, Date.parse('2026-09-10T03:00:00Z'), 0),
      assistantMessage(FLASH, USAGE, Date.parse('2026-09-10T05:00:00Z'), 1),
    ], BILLING, CATALOG, new Date('2026-09-10T06:00:00Z'))
    expect(spend.total).toBeCloseTo(BASE_PEAK_COST + REPRICED_OFF_PEAK_COST, 10)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.peakCost).toBeCloseTo(BASE_PEAK_COST, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
  })

  it('prices a configured revision history by the sample timestamp', () => {
    const billing = resolveBilling({
      models: [
        { model: FLASH, effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT, ...REPRICED_RATES },
        { model: FLASH, ...BASE_RATES },
      ],
    })
    expect(computeSessionSpend([assistantMessage(FLASH, USAGE, BEFORE)], billing, CATALOG).total)
      .toBeCloseTo(BASE_PEAK_COST, 10)
    expect(computeSessionSpend([assistantMessage(FLASH, USAGE, AT)], billing, CATALOG).total)
      .toBeCloseTo(REPRICED_OFF_PEAK_COST, 10)
  })

  it('prices samples before a lone dated revision at that revision (never unpriced)', () => {
    const billing = resolveBilling({
      models: [{ model: FLASH, effectiveFrom: FLASH_SERIES_RATE_CHANGE_AT, ...REPRICED_RATES }],
    })
    expect(computeSessionSpend([assistantMessage(FLASH, USAGE, BASE_PEAK)], billing, CATALOG).total)
      .toBeCloseTo(REPRICED_PEAK_COST, 10)
  })
})

describe('rate revisions (V4 Pro route switch 2026-09-14 12:00 Beijing)', () => {
  // 2026-09-14 is a Monday. 03:59:59.999Z = 11:59:59.999 Beijing, the last
  // instant of a peak window on V4 Pro's own rates; 04:00:00Z = 12:00 Beijing,
  // the first instant served by V4.1 Flash and billed at its rates (inside the
  // off-peak window); 2026-09-15 02:00Z = Tuesday 10:00 Beijing, a peak hour.
  const BEFORE = Date.parse('2026-09-14T03:59:59.999Z')
  const AT = Date.parse('2026-09-14T04:00:00Z')
  const AFTER_PEAK = Date.parse('2026-09-15T02:00:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }
  const BILLING = resolveBilling(undefined)
  // Pro peak 0.30 + 9.00 × 1.5 + 27.00 = 40.80; V4.1 Flash off-peak 5.52 and
  // peak 11.04 for the same usage.
  const PRO_PEAK_COST = 40.80

  it('bills the V4 Pro route at its own rates right up to the switch', () => {
    const spend = computeSessionSpend([assistantMessage(PRO, USAGE, BEFORE)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(PRO_PEAK_COST, 10)
    expect(spend.models[0]?.displayName).toBe('DeepSeek-V4-Pro')
  })

  it('bills the routed route at the V4.1 Flash rates from the switch instant', () => {
    const spend = computeSessionSpend([assistantMessage(PRO, USAGE, AT)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(5.52, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(5.52, 10)
    expect(spend.models[0]?.cacheHitInputCost).toBeCloseTo(0.02, 10)
    expect(spend.models[0]?.cacheMissInputCost).toBeCloseTo(1.50, 10)
    expect(spend.models[0]?.outputCost).toBeCloseTo(4.00, 10)
  })

  it('applies the V4.1 Flash peak prices to the routed route', () => {
    const spend = computeSessionSpend([assistantMessage(PRO, USAGE, AFTER_PEAK)], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(11.04, 10)
    expect(spend.models[0]?.peakCost).toBeCloseTo(11.04, 10)
  })

  it('splits one Beijing day across the switch', () => {
    // 2026-09-14 11:00 Beijing (03:00Z, peak, V4 Pro's own rates) and 13:00
    // Beijing (05:00Z, off-peak, V4.1 Flash rates) are both on the switch day.
    const spend = computeTodaySpend([
      assistantMessage(PRO, USAGE, Date.parse('2026-09-14T03:00:00Z'), 0),
      assistantMessage(PRO, USAGE, Date.parse('2026-09-14T05:00:00Z'), 1),
    ], BILLING, CATALOG, new Date('2026-09-14T06:00:00Z'))
    expect(spend.total).toBeCloseTo(PRO_PEAK_COST + 5.52, 10)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.peakCost).toBeCloseTo(PRO_PEAK_COST, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(5.52, 10)
  })
})

describe('computeTodaySpend', () => {
  // 2026-08-20 04:00Z is 2026-08-20 12:00 Beijing (off-peak; day 2026-08-20).
  const NOW = Date.parse('2026-08-20T04:00:00Z')
  // 02:00Z is 10:00 Beijing (peak), same Beijing day as NOW.
  const PEAK = Date.parse('2026-08-20T02:00:00Z')
  // 12:00Z is 20:00 Beijing (off-peak), same Beijing day as NOW.
  const OFF_PEAK = Date.parse('2026-08-20T12:00:00Z')
  // 16:30Z is 2026-08-21 00:30 Beijing — a different Beijing calendar day.
  const NEXT_DAY = Date.parse('2026-08-20T16:30:00Z')
  // 2026-08-19 20:00Z is 2026-08-20 04:00 Beijing — the previous UTC day but
  // the same Beijing calendar day as NOW.
  const PREVIOUS_UTC_DAY = Date.parse('2026-08-19T20:00:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }

  it('prices every priced event on the reference Beijing calendar day, from any session', () => {
    const spend = computeTodaySpend(
      [
        assistantMessage(FLASH, USAGE, PEAK, 0),
        assistantMessage(FLASH, USAGE, OFF_PEAK, 1),
        assistantMessage(PRO, USAGE, PREVIOUS_UTC_DAY, 2),
      ],
      resolveBilling(undefined),
      CATALOG,
      new Date(NOW),
    )
    // Flash peak 13.60 + Flash off-peak 6.80 + Pro off-peak 20.40.
    expect(spend.total).toBeCloseTo(13.60 + 6.80 + 20.40, 10)
    expect(spend.models).toHaveLength(2)
    const flash = spend.models.find(row => row.model === FLASH)
    expect(flash?.peakCost).toBeCloseTo(13.60, 10)
    expect(flash?.offPeakCost).toBeCloseTo(6.80, 10)
    const pro = spend.models.find(row => row.model === PRO)
    expect(pro?.cost).toBeCloseTo(20.40, 10)
  })

  it('ignores events on other Beijing calendar days', () => {
    const spend = computeTodaySpend(
      [
        assistantMessage(FLASH, USAGE, PEAK),
        // 00:30 Beijing the next day — not today.
        assistantMessage(FLASH, USAGE, NEXT_DAY),
      ],
      resolveBilling(undefined),
      CATALOG,
      new Date(NOW),
    )
    expect(spend.total).toBeCloseTo(13.60, 10)
    expect(spend.models[0]?.cost).toBeCloseTo(13.60, 10)
  })

  it('returns a zero total when nothing priced falls on the reference day', () => {
    const spend = computeTodaySpend(
      [assistantMessage(FLASH, USAGE, NEXT_DAY)],
      resolveBilling(undefined),
      CATALOG,
      new Date(NOW),
    )
    expect(spend.total).toBe(0)
    expect(spend.models).toEqual([])
  })

  it('defaults the reference moment to now', () => {
    const spend = computeTodaySpend([], resolveBilling(undefined), CATALOG)
    expect(spend.total).toBe(0)
    expect(spend.models).toEqual([])
  })
})

describe('SpendAccumulator', () => {
  // 2026-08-20 is a Thursday: 02:00Z is 10:00 Beijing (peak), 12:00Z is 20:00
  // Beijing (off-peak); 16:30Z is the next Beijing day.
  const PEAK = Date.parse('2026-08-20T02:00:00Z')
  const OFF_PEAK = Date.parse('2026-08-20T12:00:00Z')
  const NEXT_DAY = Date.parse('2026-08-20T16:30:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }

  it('folds to the same spend as the pure addEventContribution chain on a mixed log', () => {
    const billing = resolveBilling(undefined)
    const events = [
      assistantMessage(FLASH, USAGE, PEAK),
      assistantMessage(PRO, USAGE, OFF_PEAK),
      assistantMessage(FLASH, USAGE, NEXT_DAY),
      assistantMessage('other-model', USAGE, PEAK),
      assistantMessage(PRO, USAGE, PEAK),
    ]
    const names = new Map(CATALOG.map(model => [model.id, model.name]))
    const accumulator = new SpendAccumulator()
    let expected = emptyTodaySpend()
    for (const event of events) {
      const priced = priceEvent(event, billing, names)
      if (priced !== undefined) {
        accumulator.add(priced)
        expected = addEventContribution(expected, priced)
      }
    }
    expect(accumulator.finish()).toEqual(expected)
  })

  it('keeps first-seen model order like the pure chain', () => {
    const billing = resolveBilling(undefined)
    const names = new Map(CATALOG.map(model => [model.id, model.name]))
    const priced = (model: string, time: number): BillingEventContribution | undefined =>
      priceEvent(assistantMessage(model, USAGE, time), billing, names)
    const accumulator = new SpendAccumulator()
    const flash = priced(FLASH, PEAK)!
    const pro = priced(PRO, OFF_PEAK)!
    const flashAgain = priced(FLASH, PEAK)!
    accumulator.add(flash)
    accumulator.add(pro)
    accumulator.add(flashAgain)
    const rows = accumulator.finish().models.map(row => row.model)
    expect(rows).toEqual([FLASH, PRO])
  })

  it('mergeTodaySpend sums rows and appends new models in source order', () => {
    const row = (model: string, cost: number): DeepSeekTodaySpend['models'][number] => ({
      model,
      displayName: model,
      cost,
      peakCost: cost,
      offPeakCost: 0,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
      outputTokens: 0,
      cacheHitInputCost: 0,
      cacheMissInputCost: 0,
      outputCost: 0,
    })
    const target: DeepSeekTodaySpend = { total: 1, models: [row(FLASH, 1)] }
    const source: DeepSeekTodaySpend = { total: 2.5, models: [row(FLASH, 2), row(PRO, 0.5)] }
    const merged = mergeTodaySpend(target, source)
    expect(merged.total).toBeCloseTo(3.5, 10)
    expect(merged.models.map(model => model.model)).toEqual([FLASH, PRO])
    expect(merged.models[0]?.cost).toBeCloseTo(3, 10)
    expect(merged.models[1]?.cost).toBeCloseTo(0.5, 10)
    // Pure: neither input is mutated.
    expect(target.models).toHaveLength(1)
    expect(source.models).toHaveLength(2)
  })
})

describe('computeTurnSpend', () => {
  // 2026-08-20 is a Thursday: 02:00Z is 10:00 Beijing (peak); 12:00Z is 20:00
  // Beijing (off-peak).
  const PEAK = Date.parse('2026-08-20T02:00:00Z')
  const OFF_PEAK = Date.parse('2026-08-20T12:00:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }
  const BILLING = resolveBilling(undefined)

  function turnMessage(model: string, turn: number, id: string, time: number, seq: number): SessionEvent {
    return {
      type: 'assistant/message',
      seq,
      time,
      data: {
        turn,
        step: seq,
        message: {
          id: id as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model },
        },
        usage: USAGE,
      },
    } as unknown as SessionEvent
  }

  function turnBoundary(type: 'turn/start' | 'turn/end', turn: number, seq: number, time: number): SessionEvent {
    return {
      type,
      seq,
      time,
      data: type === 'turn/end' ? { turn, step: 0, reason: { kind: 'done' } } : { turn, step: 0 },
    } as unknown as SessionEvent
  }

  const LOG = [
    turnBoundary('turn/start', 0, 0, PEAK),
    turnMessage(FLASH, 0, 'm0', PEAK, 1),
    turnBoundary('turn/end', 0, 2, PEAK),
    turnBoundary('turn/start', 1, 3, OFF_PEAK),
    turnMessage(PRO, 1, 'm1', OFF_PEAK, 4),
    turnMessage(FLASH, 1, 'm2', PEAK, 5),
    turnBoundary('turn/end', 1, 6, OFF_PEAK),
  ]

  it('prices only the target turn\'s events, per-event peak/off-peak by its own timestamp', () => {
    // Turn 1: Pro off-peak (hit 0.15 + miss 6.75 + output 13.50 = 20.40) plus
    // Flash peak (hit 0.10 + miss 4.50 + output 9.00 = 13.60) → 34.00.
    expect(computeTurnSpend(LOG, BILLING, CATALOG, 'm1').total).toBeCloseTo(34.00, 10)
    expect(computeTurnSpend(LOG, BILLING, CATALOG, 'm2').total).toBeCloseTo(34.00, 10)
    // Turn 0: Flash peak only → 13.60.
    expect(computeTurnSpend(LOG, BILLING, CATALOG, 'm0').total).toBeCloseTo(13.60, 10)
  })

  it('returns zero for an unknown message id', () => {
    expect(computeTurnSpend(LOG, BILLING, CATALOG, 'nope')).toEqual({ total: 0 })
  })

  it('returns zero when the turn has no bracketing turn/start..turn/end (compacted or orphaned)', () => {
    const orphan = [turnMessage(FLASH, 2, 'm-orphan', PEAK, 0)]
    expect(computeTurnSpend(orphan, BILLING, CATALOG, 'm-orphan').total).toBe(0)
    // A turn that never ended prices everything after its turn/start (the
    // closing message never reaches the actions row, so the client never
    // asks, but the guard holds and the partial usage still counts).
    const open = [
      turnBoundary('turn/start', 0, 0, PEAK),
      turnMessage(FLASH, 0, 'm-open', PEAK, 1),
    ]
    expect(computeTurnSpend(open, BILLING, CATALOG, 'm-open').total).toBeCloseTo(13.60, 10)
  })

  it('excludes models without a pricing row', () => {
    const log = [
      turnBoundary('turn/start', 0, 0, PEAK),
      turnMessage('other-model', 0, 'm0', PEAK, 1),
      turnBoundary('turn/end', 0, 2, PEAK),
    ]
    expect(computeTurnSpend(log, BILLING, CATALOG, 'm0').total).toBe(0)
  })

  it('folds every Turn in one pass with exactly computeTurnSpend\'s totals', () => {
    const spends = computeSessionTurnSpends(LOG, BILLING, CATALOG)
    expect(spends.turns.map(row => row.messageId)).toEqual(['m0', 'm1', 'm2'])
    for (const row of spends.turns) {
      expect(row.total).toBeCloseTo(computeTurnSpend(LOG, BILLING, CATALOG, row.messageId).total, 10)
    }
    expect(spends.turns[0]?.total).toBeCloseTo(13.60, 10)
    expect(spends.turns[1]?.total).toBeCloseTo(34.00, 10)
    expect(spends.turns[2]?.total).toBeCloseTo(34.00, 10)
  })

  it('folds incrementally: only appended events are priced, a re-feed is a no-op', () => {
    const folder = new SessionTurnSpendFolder(BILLING, CATALOG)
    folder.feed(LOG.slice(0, 3))
    expect(folder.processed).toBe(3)
    const first = folder.finish()
    expect(first.turns.map(row => row.messageId)).toEqual(['m0'])
    expect(first.turns[0]?.total).toBeCloseTo(13.60, 10)
    folder.feed(LOG)
    const rows = folder.finish().turns
    expect(rows.map(row => row.messageId)).toEqual(['m0', 'm1', 'm2'])
    expect(rows[1]?.total).toBeCloseTo(34.00, 10)
    expect(folder.processed).toBe(LOG.length)
    // Re-feeding the same log changes nothing.
    folder.feed(LOG)
    expect(folder.finish().turns).toHaveLength(3)
  })

  it('resets the fold when the log is replaced by a shorter one', () => {
    const folder = new SessionTurnSpendFolder(BILLING, CATALOG)
    folder.feed(LOG)
    expect(folder.finish().turns).toHaveLength(3)
    folder.feed(LOG.slice(0, 3))
    expect(folder.finish().turns.map(row => row.messageId)).toEqual(['m0'])
  })
})

describe('MiMo-V2.5 flat-rate billing', () => {
  // MiMo uses flat rate (peak === offPeak), so peak and off-peak produce the
  // same cost regardless of Beijing-time hour and weekday.
  const PEAK = Date.parse('2026-08-20T02:00:00Z')   // 10:00 Beijing, weekday
  const OFF_PEAK = Date.parse('2026-08-20T12:00:00Z') // 20:00 Beijing, weekday
  const WEEKEND = Date.parse('2026-08-22T02:00:00Z')  // Saturday 10:00 Beijing
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }

  it('prices mimo-v2.5-pro at the flat rate (peak === offPeak)', () => {
    // mimo-v2.5-pro: hit 0.025, miss 3.0, output 6.0 CNY/M.
    // 1M hit → 0.025, 1.5M miss → 4.5, 1M output → 6.0 → total 10.525
    const billing = resolveBilling(undefined)
    const spend = computeSessionSpend([assistantMessage(MIMO_PRO, USAGE, PEAK)], billing, CATALOG)
    expect(spend.total).toBeCloseTo(10.525, 10)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.displayName).toBe('MiMo-V2.5-Pro')
  })

  it('prices mimo-v2.5 at the flat rate', () => {
    // mimo-v2.5: hit 0.02, miss 1.0, output 2.0 CNY/M.
    // 1M hit → 0.02, 1.5M miss → 1.5, 1M output → 2.0 → total 3.52
    const billing = resolveBilling(undefined)
    const spend = computeSessionSpend([assistantMessage(MIMO, USAGE, PEAK)], billing, CATALOG)
    expect(spend.total).toBeCloseTo(3.52, 10)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.displayName).toBe('MiMo-V2.5')
  })

  it('charges the same rate at off-peak hours (flat rate)', () => {
    const billing = resolveBilling(undefined)
    const peakSpend = computeSessionSpend([assistantMessage(MIMO_PRO, USAGE, PEAK)], billing, CATALOG)
    const offPeakSpend = computeSessionSpend([assistantMessage(MIMO_PRO, USAGE, OFF_PEAK)], billing, CATALOG)
    expect(peakSpend.total).toBeCloseTo(offPeakSpend.total, 10)
  })

  it('charges the same rate on weekends (flat rate)', () => {
    const billing = resolveBilling(undefined)
    const peakSpend = computeSessionSpend([assistantMessage(MIMO, USAGE, PEAK)], billing, CATALOG)
    const weekendSpend = computeSessionSpend([assistantMessage(MIMO, USAGE, WEEKEND)], billing, CATALOG)
    expect(peakSpend.total).toBeCloseTo(weekendSpend.total, 10)
  })

  // V2.6 kept V2.5's published API pricing (2026-09-22 launch), so the same
  // USAGE costs the same on the V2.6 ids.
  it('prices the MiMo-V2.6 series at the kept V2.5 rates', () => {
    const billing = resolveBilling(undefined)
    const proFlash = computeSessionSpend([assistantMessage('mimo-v2.6-pro', USAGE, PEAK)], billing, CATALOG)
    expect(proFlash.total).toBeCloseTo(10.525, 10)
    expect(proFlash.models[0]?.displayName).toBe('MiMo-V2.6-Pro')
    const flash = computeSessionSpend([assistantMessage('mimo-v2.6-flash', USAGE, PEAK)], billing, CATALOG)
    expect(flash.total).toBeCloseTo(3.52, 10)
    expect(flash.models[0]?.displayName).toBe('MiMo-V2.6-Flash')
  })
})

describe('attempt pricing (DSH tokenUsage semantics)', () => {
  // 2026-08-20 02:00Z is 10:00 Beijing (weekday, peak).
  const PEAK = Date.parse('2026-08-20T02:00:00Z')
  const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }
  const BILLING = resolveBilling(undefined)

  /** A `request/header` naming the model of the next request (newer than the npm union). */
  function requestHeader(model: string, seq: number): SessionEvent {
    return {
      type: 'request/header',
      seq,
      time: PEAK,
      data: { header: { config: { provider: 'deepseek-official', model } } },
    } as unknown as SessionEvent
  }

  /** One `assistant/attempt` whose embedded stream reports usage (no route of its own). */
  function attempt(usage: TokenUsage, seq: number, turn = 0, step = 0): SessionEvent {
    return {
      type: 'assistant/attempt',
      seq,
      time: PEAK,
      data: { turn, step, stream: [{ type: 'chunk', time: PEAK, chunk: { type: 'usage', usage } }] },
    } as unknown as SessionEvent
  }

  /** One `assistant/message` of an explicit `(turn, step)` (attempt replacement keys on both). */
  function message(usage: TokenUsage, seq: number, turn = 0, step = 0): SessionEvent {
    return {
      type: 'assistant/message',
      seq,
      time: PEAK,
      data: {
        turn,
        step,
        message: {
          id: `m${seq}` as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model: FLASH },
        },
        usage,
      },
    } as unknown as SessionEvent
  }

  /** One `llm/retry-started` for an attempt (newer than the npm union). */
  function retryStarted(turn: number, step: number, seq: number): SessionEvent {
    return { type: 'llm/retry-started', seq, time: PEAK, data: { turn, step } } as unknown as SessionEvent
  }

  it('prices an assistant/attempt with the model of the latest request/header', () => {
    const spend = computeSessionSpend([
      requestHeader(FLASH, 0),
      attempt(USAGE, 1),
    ], BILLING, CATALOG)
    expect(spend.total).toBeCloseTo(13.60, 10)
    expect(spend.models[0]?.model).toBe(FLASH)
  })

  it('skips an attempt before any request/header names a model', () => {
    const spend = computeSessionSpend([attempt(USAGE, 0)], BILLING, CATALOG)
    expect(spend.total).toBe(0)
  })

  it('replaces the attempt sample with the message sample of the same (turn, step)', () => {
    const tiny: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const spend = computeSessionSpend([
      requestHeader(FLASH, 0),
      attempt(tiny, 1, 0, 1),
      message(USAGE, 2, 0, 1),
    ], BILLING, CATALOG)
    // Only the message's sample counts; the replaced attempt leaves no row behind.
    expect(spend.total).toBeCloseTo(13.60, 10)
    expect(spend.models).toHaveLength(1)
  })

  it('adds the retried attempt after llm/retry-started', () => {
    const spend = computeSessionSpend([
      requestHeader(FLASH, 0),
      attempt(USAGE, 1, 0, 1),
      retryStarted(0, 1, 2),
      attempt(USAGE, 3, 0, 1),
    ], BILLING, CATALOG)
    // Both requests were billed: the failed attempt and its retry.
    expect(spend.total).toBeCloseTo(13.60 * 2, 10)
  })

  it('prices a message with no data.usage from its stream usage chunk', () => {
    const streamOnly = {
      ...message(USAGE, 1),
      data: {
        turn: 0,
        step: 1,
        message: {
          id: 'm1' as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model: FLASH },
        },
        stream: [{ type: 'chunk', time: PEAK, chunk: { type: 'usage', usage: USAGE } }],
      },
    } as unknown as SessionEvent
    expect(computeSessionSpend([streamOnly], BILLING, CATALOG).total).toBeCloseTo(13.60, 10)
  })

  it('negates and subtracts spends exactly (replacement primitive)', () => {
    const spend = computeSessionSpend([message(USAGE, 0, 0, 0)], BILLING, CATALOG)
    expect(subtractSpend(spend, spend)).toEqual({ total: 0, models: [] })
    const doubled = mergeTodaySpend(spend, spend)
    expect(subtractSpend(doubled, spend).total).toBeCloseTo(spend.total, 10)
    expect(negateSpend(spend).total).toBeCloseTo(-spend.total, 10)
  })
})
