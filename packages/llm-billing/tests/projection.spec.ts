/**
 * The `billingTodaySpend` projection unit: per-session, per-Beijing-day spend
 * fold. The first priced event seeds the day, same-day events accumulate, a
 * new day resets the state, and a day strictly older than the state's day is
 * ignored defensively. The fold is compared against `computeTodaySpend` on a
 * mixed-day log so the projection path and the events path cannot drift, and
 * the state is checked against the unit schemas (the persisted-cache plain
 * JSON contract).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { computeTodaySpend, resolveBilling } from '../src/billing.ts'
import { billingTodaySpendDefinition, BILLING_UNIT_KEY, foldBillingUnit } from '../src/projection.ts'

function assistantMessage(model: string, usage: TokenUsage, time: number, seq = 0): SessionEvent {
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
const CATALOG = [{ id: FLASH, name: 'DeepSeek-V4-Flash' }]
const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 }

// 2026-08-20 is a Thursday (weekday): 02:00Z is 10:00 Beijing (peak);
// 12:00Z is 20:00 Beijing (off-peak) — both on Beijing day 2026-08-20.
const DAY1_PEAK = Date.parse('2026-08-20T02:00:00Z')
const DAY1_OFF = Date.parse('2026-08-20T12:00:00Z')
// 16:30Z is 2026-08-21 00:30 Beijing — the next Beijing calendar day.
const DAY2 = Date.parse('2026-08-20T16:30:00Z')
// 2026-08-19 12:00Z is 20:00 Beijing — the previous Beijing calendar day.
const DAY0 = Date.parse('2026-08-19T12:00:00Z')

describe('billingTodaySpend unit', () => {
  const unit = billingTodaySpendDefinition(resolveBilling(undefined), CATALOG)
  const billing = resolveBilling(undefined)

  it('declares the owned key', () => {
    expect(unit.key).toBe(BILLING_UNIT_KEY)
  })

  it('keeps the initial empty state for events without priced usage (same reference)', () => {
    const initial = unit.init()
    const turnStart = { type: 'turn/start', seq: 0, time: DAY1_PEAK, data: { turn: 0 } } as unknown as SessionEvent
    const unknownModel = assistantMessage('other-model', USAGE, DAY1_PEAK, 1)
    const noUsage = { ...assistantMessage(FLASH, USAGE, DAY1_PEAK, 2), data: { ...assistantMessage(FLASH, USAGE, DAY1_PEAK, 2).data, usage: undefined } } as unknown as SessionEvent
    expect(unit.apply(initial, turnStart)).toBe(initial)
    expect(unit.apply(initial, unknownModel)).toBe(initial)
    expect(unit.apply(initial, noUsage)).toBe(initial)
    expect(initial).toEqual({ dayKey: '', spend: { total: 0, models: [] } })
  })

  it('seeds the first priced event and accumulates same-day events across peak and off-peak hours', () => {
    const state = foldBillingUnit(unit, [
      assistantMessage(FLASH, USAGE, DAY1_PEAK, 0),
      assistantMessage(FLASH, USAGE, DAY1_OFF, 1),
    ])
    expect(state.dayKey).toBe('2026-08-20')
    expect(state.spend.total).toBeCloseTo(13.60 + 6.80, 10)
    const row = state.spend.models[0]
    expect(row?.peakCost).toBeCloseTo(13.60, 10)
    expect(row?.offPeakCost).toBeCloseTo(6.80, 10)
    expect(row?.cacheHitInputTokens).toBe(2_000_000)
  })

  it('resets to the new day when the session crosses the Beijing midnight', () => {
    const state = foldBillingUnit(unit, [
      assistantMessage(FLASH, USAGE, DAY1_PEAK, 0),
      assistantMessage(FLASH, USAGE, DAY1_OFF, 1),
      assistantMessage(FLASH, USAGE, DAY2, 2),
    ])
    // Only the new day's event survives the reset.
    expect(state.dayKey).toBe('2026-08-21')
    expect(state.spend.total).toBeCloseTo(6.80, 10)
  })

  it('ignores an event whose Beijing day is older than the state day (defensive)', () => {
    const state = foldBillingUnit(unit, [
      assistantMessage(FLASH, USAGE, DAY2, 0),
      assistantMessage(FLASH, USAGE, DAY1_PEAK, 1),
    ])
    expect(state.dayKey).toBe('2026-08-21')
    expect(state.spend.total).toBeCloseTo(6.80, 10)
  })

  it('matches computeTodaySpend on the session\'s latest day (parity between paths)', () => {
    const events = [
      assistantMessage(FLASH, USAGE, DAY0, 0),
      assistantMessage(FLASH, USAGE, DAY1_PEAK, 1),
      assistantMessage(FLASH, USAGE, DAY1_OFF, 2),
      assistantMessage(FLASH, USAGE, DAY2, 3),
    ]
    const state = foldBillingUnit(unit, events)
    const reference = computeTodaySpend(events, billing, CATALOG, new Date(DAY2 + 3_600_000))
    expect(state.dayKey).toBe('2026-08-21')
    expect(state.spend).toEqual(reference)
  })

  it('produces plain-JSON state that passes the unit schemas (persisted-cache contract)', () => {
    const state = foldBillingUnit(unit, [
      assistantMessage(FLASH, USAGE, DAY1_PEAK, 0),
      assistantMessage(FLASH, USAGE, DAY1_OFF, 1),
    ])
    const parsed = unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(parsed).toEqual(state)
    const viewed = unit.wire!.viewSchema.parse(unit.wire!.view(parsed))
    expect(viewed).toEqual(state)
  })
})
