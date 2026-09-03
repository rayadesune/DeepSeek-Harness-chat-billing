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
  computeSessionSpend,
  computeTodaySpend,
  computeTurnSpend,
  emptyTodaySpend,
  forkBoundaryOf,
  isPeak,
  isSeededSession,
  mergeTodaySpend,
  priceEvent,
  resolveBilling,
  SpendAccumulator,
} from '../src/billing.ts'
import type { BillingEventContribution, DeepSeekTodaySpend } from '../src/billing.ts'

function assistantMessage(model: string, usage: TokenUsage, time = 0, seq = 0): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 0,
      step: 0,
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
const PRO = 'deepseek-v4-pro'
const MIMO_PRO = 'mimo-v2.5-pro'
const MIMO = 'mimo-v2.5'
const CATALOG = [
  { id: FLASH, name: 'DeepSeek-V4-Flash' },
  { id: PRO, name: 'DeepSeek-V4-Pro' },
  { id: MIMO_PRO, name: 'MiMo-V2.5-Pro' },
  { id: MIMO, name: 'MiMo-V2.5' },
]

describe('resolveBilling', () => {
  it('uses the published defaults when no config is supplied', () => {
    const billing = resolveBilling(undefined)
    expect(billing.peakHours).toEqual([{ start: 9, end: 12 }, { start: 14, end: 18 }])
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 })
    expect(billing.models.get(PRO)?.offPeak).toEqual({ cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 })
    // deepseek-v4-flash-vision-exp bills at the same published rates as flash.
    expect(billing.models.get('deepseek-v4-flash-vision-exp')?.peak)
      .toEqual({ cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 })
    expect(billing.models.get('deepseek-v4-flash-vision-exp')?.offPeak)
      .toEqual({ cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 })
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

  it('overrides a model when an explicit row is supplied', () => {
    const billing = resolveBilling({
      models: [{
        model: FLASH,
        peak: { cacheHitInput: 1, cacheMissInput: 2, output: 3 },
        offPeak: { cacheHitInput: 0.5, cacheMissInput: 1, output: 1.5 },
      }],
    })
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 1, cacheMissInput: 2, output: 3 })
    expect(billing.models.has(PRO)).toBe(false)
  })

  it('falls back to the defaults for empty arrays (schemastery materializes absent z.array as [])', () => {
    const billing = resolveBilling({ models: [], peakHours: [] })
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 })
    expect(billing.models.get(PRO)?.offPeak).toEqual({ cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 })
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
      [assistantMessage(FLASH, USAGE, PEAK), assistantMessage(FLASH, USAGE, OFF_PEAK)],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBeCloseTo(13.60 + 6.80, 10)
    expect(spend.models[0]?.peakCost).toBeCloseTo(13.60, 10)
    expect(spend.models[0]?.offPeakCost).toBeCloseTo(6.80, 10)
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
        assistantMessage(FLASH, USAGE, PEAK),
        assistantMessage(FLASH, USAGE, OFF_PEAK),
        assistantMessage(PRO, USAGE, PREVIOUS_UTC_DAY),
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
        step: 0,
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
})
