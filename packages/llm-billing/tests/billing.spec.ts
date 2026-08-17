/**
 * Session spend pricing: pricing resolution, peak-hour classification, and the
 * per-session spend conversion. Pure functions only, so the suite is keyless
 * and deterministic.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  computeSessionSpend,
  isPeak,
  resolveBilling,
} from '../src/billing.ts'

function assistantMessage(model: string, usage: TokenUsage, time = 0): SessionEvent {
  return {
    type: 'assistant/message',
    seq: 0,
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
const CATALOG = [
  { id: FLASH, name: 'DeepSeek-V4-Flash' },
  { id: PRO, name: 'DeepSeek-V4-Pro' },
]

describe('resolveBilling', () => {
  it('uses the published defaults when no config is supplied', () => {
    const billing = resolveBilling(undefined)
    expect(billing.peakHours).toEqual([{ start: 9, end: 12 }, { start: 14, end: 18 }])
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 })
    expect(billing.models.get(PRO)?.offPeak).toEqual({ cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 })
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
  it('classifies Beijing daytime hours as peak and others as off-peak', () => {
    const billing = resolveBilling(undefined)
    // 10:00 Beijing = 02:00 UTC; 20:00 Beijing = 12:00 UTC.
    expect(isPeak(billing, new Date('2026-08-20T02:00:00Z'))).toBe(true)
    expect(isPeak(billing, new Date('2026-08-20T12:00:00Z'))).toBe(false)
  })
})

describe('computeSessionSpend', () => {
  // 02:00Z is 10:00 Beijing (peak); 12:00Z is 20:00 Beijing (off-peak).
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
      [{ type: 'turn/start', seq: 0, time: PEAK, data: { turn: 0 } } as SessionEvent],
      resolveBilling(undefined),
      CATALOG,
    )
    expect(spend.total).toBe(0)
    expect(spend.models).toEqual([])
  })
})
