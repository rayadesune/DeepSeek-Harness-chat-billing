/**
 * Billing estimation: the per-model usage fold, pricing resolution, peak-hour
 * classification, and balance → remaining-tasks conversion. Pure functions
 * only, so the suite is keyless and deterministic.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  computeModelEstimates,
  foldSessionUsage,
  isPeak,
  mergeSessionUsage,
  resolveBilling,
} from '../src/billing.ts'
import type { DeepSeekBalance } from '../src/types.ts'

function assistantMessage(model: string, usage: TokenUsage): SessionEvent {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 0,
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

function balance(total: string): DeepSeekBalance {
  return { isAvailable: true, lines: [{ currency: 'CNY', total, granted: '0.00', toppedUp: total }] }
}

describe('foldSessionUsage', () => {
  it('buckets cache hit, cache miss (including writes), and output by model', () => {
    const usage = foldSessionUsage([
      assistantMessage(FLASH, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 }),
      assistantMessage(PRO, { inputTokens: 200, outputTokens: 30 }),
    ])
    expect(usage.get(FLASH)).toEqual({ cacheHitInputTokens: 20, cacheMissInputTokens: 110, outputTokens: 50, sessions: 1 })
    expect(usage.get(PRO)).toEqual({ cacheHitInputTokens: 0, cacheMissInputTokens: 200, outputTokens: 30, sessions: 1 })
  })

  it('ignores events without usage and counts one session per model', () => {
    const usage = foldSessionUsage([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 0 } } as SessionEvent,
      assistantMessage(FLASH, { inputTokens: 10, outputTokens: 5 }),
      assistantMessage(FLASH, { inputTokens: 20, outputTokens: 5 }),
    ])
    expect(usage.get(FLASH)?.sessions).toBe(1)
    expect(usage.get(FLASH)?.cacheMissInputTokens).toBe(30)
  })
})

describe('mergeSessionUsage', () => {
  it('sums token buckets and session counts across sessions', () => {
    const target = foldSessionUsage([assistantMessage(FLASH, { inputTokens: 10, outputTokens: 5 })])
    const second = foldSessionUsage([assistantMessage(FLASH, { inputTokens: 20, outputTokens: 5 })])
    mergeSessionUsage(target, second)
    expect(target.get(FLASH)).toEqual({ cacheHitInputTokens: 0, cacheMissInputTokens: 30, outputTokens: 10, sessions: 2 })
  })
})

describe('resolveBilling', () => {
  it('uses the published defaults when no config is supplied', () => {
    const billing = resolveBilling(undefined)
    expect(billing.peakHours).toEqual([{ start: 9, end: 12 }, { start: 14, end: 18 }])
    expect(billing.models.get(FLASH)?.peak).toEqual({ cacheHitInput: 0.10, cacheMissInput: 3.0, output: 9.0 })
    expect(billing.models.get(PRO)?.offPeak).toEqual({ cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 })
  })

  it('overrides a model when an explicit row is supplied', () => {
    const billing = resolveBilling({
      models: [{ model: FLASH, peak: { cacheHitInput: 1, cacheMissInput: 2, output: 3 }, offPeak: { cacheHitInput: 0.5, cacheMissInput: 1, output: 1.5 } }],
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

describe('computeModelEstimates', () => {
  it('converts balance to whole remaining tasks using the historical average and current price', () => {
    const usage = new Map([
      [FLASH, { cacheHitInputTokens: 0, cacheMissInputTokens: 1_000_000, outputTokens: 0, sessions: 2 }],
    ])
    const billing = resolveBilling(undefined)
    // Peak flash cache-miss price 3.0 元/M, so each task costs 1.5 元; 110 元 → 73 tasks.
    const peak = new Date('2026-08-20T02:00:00Z')
    const [flash] = computeModelEstimates(balance('110.00'), usage, billing, peak, CATALOG)
    expect(flash?.tasksRemaining).toBe(73)
    expect(flash?.avgTokensPerTask).toBe(500_000)
  })

  it('reports null for a model with no history', () => {
    const [pro] = computeModelEstimates(balance('110.00'), new Map(), resolveBilling(undefined), new Date('2026-08-20T02:00:00Z'), CATALOG)
    expect(pro?.tasksRemaining).toBeNull()
    expect(pro?.avgTokensPerTask).toBeNull()
  })

  it('reports null without a CNY balance line', () => {
    const usage = new Map([[FLASH, { cacheHitInputTokens: 0, cacheMissInputTokens: 1000, outputTokens: 0, sessions: 1 }]])
    const usd = { isAvailable: true, lines: [{ currency: 'USD', total: '1.00', granted: '0.00', toppedUp: '1.00' }] }
    const [flash] = computeModelEstimates(usd, usage, resolveBilling(undefined), new Date('2026-08-20T02:00:00Z'), CATALOG)
    expect(flash?.tasksRemaining).toBeNull()
  })
})
