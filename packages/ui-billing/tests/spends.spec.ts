/**
 * `sumSpends`: the additive merge behind the badge's conversation amount — this
 * session's own live spend plus the delegated-subagent subtotal.
 */
import { describe, expect, it } from 'vitest'
import type { DeepSeekSessionSpend, DeepSeekSessionSpendModel } from '@rayadesu/dsh-llm-billing/types'
import { sumSpends } from '../src/client/spends.ts'

/** One model row with every priced field derived from a single amount. */
function row(model: string, cost: number): DeepSeekSessionSpendModel {
  return {
    model,
    displayName: model.toUpperCase(),
    cost,
    peakCost: cost,
    offPeakCost: 0,
    cacheHitInputTokens: 1,
    cacheMissInputTokens: 2,
    outputTokens: 3,
    cacheHitInputCost: cost / 3,
    cacheMissInputCost: cost / 3,
    outputCost: cost / 3,
  }
}

function spend(total: number, models: DeepSeekSessionSpendModel[]): DeepSeekSessionSpend {
  return { total, models }
}

describe('sumSpends', () => {
  it('adds the totals and keeps the own model order', () => {
    const merged = sumSpends(spend(0.04, [row('flash', 0.04)]), spend(0.5, [row('pro', 0.5)]))
    expect(merged.total).toBeCloseTo(0.54, 10)
    expect(merged.models.map(entry => entry.model)).toEqual(['flash', 'pro'])
    expect(merged.models.map(entry => entry.cost)).toEqual([0.04, 0.5])
  })

  it('merges rows of the same model so the breakdown still adds up', () => {
    const merged = sumSpends(spend(0.04, [row('flash', 0.04)]), spend(0.02, [row('flash', 0.02)]))
    expect(merged.total).toBeCloseTo(0.06, 10)
    expect(merged.models).toHaveLength(1)
    expect(merged.models[0]).toMatchObject({
      model: 'flash',
      displayName: 'FLASH',
      cost: expect.closeTo(0.06, 10), // oxlint-disable-line typescript/no-unsafe-assignment
      peakCost: expect.closeTo(0.06, 10),
      cacheHitInputTokens: 2,
      cacheMissInputTokens: 4,
      outputTokens: 6,
    })
    expect(merged.models.reduce((sum, entry) => sum + entry.cost, 0)).toBeCloseTo(merged.total, 10)
  })

  it('returns the own spend unchanged when nothing was delegated', () => {
    const own = spend(0.04, [row('flash', 0.04)])
    expect(sumSpends(own, spend(0, []))).toEqual(own)
  })
})
