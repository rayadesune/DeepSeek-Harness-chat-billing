// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekBillingEstimate, DeepSeekSessionSpend } from '@deepseek-ai/dsh-llm-billing/types'
import { BalanceBadge, type BalanceBadgeProps } from '../src/client/BalanceBadge.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: BalanceBadgeProps['t'] = makeTranslate(zh)

const SPEND: DeepSeekSessionSpend = {
  total: 0.04,
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    cost: 0.04,
    peakCost: 0.04,
    offPeakCost: 0,
    cacheHitInputTokens: 1000,
    cacheMissInputTokens: 100000,
    outputTokens: 20000,
    cacheHitInputCost: 0.01,
    cacheMissInputCost: 0.02,
    outputCost: 0.01,
  }],
}

function estimate(over: Partial<DeepSeekBillingEstimate> = {}): DeepSeekBillingEstimate {
  return {
    balance: { isAvailable: true, lines: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }] },
    models: [
      { model: 'deepseek-v4-flash', displayName: 'DeepSeek-V4-Flash', tasksRemaining: 73, sessionCount: 2, totalTokens: 1000000, avgTokensPerTask: 500000 },
      { model: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro', tasksRemaining: 12, sessionCount: 1, totalTokens: 2000000, avgTokensPerTask: 2000000 },
    ],
    ...over,
  }
}

function props(
  getEstimate: () => Promise<DeepSeekBillingEstimate>,
  getSessionSpend: () => Promise<DeepSeekSessionSpend> = async () => SPEND,
): BalanceBadgeProps {
  return {
    getEstimate,
    getSessionSpend,
    sessionId: 'session-1',
    t,
  } as BalanceBadgeProps
}

describe('BalanceBadge', () => {
  it('renders nothing while the first fetch is in flight', () => {
    const { container } = render(<BalanceBadge {...props(() => new Promise(() => {}))} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the balance and this conversation spend on the trigger', async () => {
    render(<BalanceBadge {...props(async () => estimate())} />)
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
    expect(screen.getByText('本轮对话花费：¥0.04')).toBeDefined()
  })

  it('keeps the spend line hidden while the conversation has no priced usage', async () => {
    render(<BalanceBadge {...props(async () => estimate(), async () => ({ total: 0, models: [] }))} />)
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
    expect(screen.queryByText(/本轮对话花费/)).toBeNull()
  })

  it('opens the label box with the amount, the spend, and the cache-hit/input/output breakdown', async () => {
    render(<BalanceBadge {...props(async () => estimate())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeDefined()
    expect(screen.getByText('¥0.04')).toBeDefined()
    expect(screen.getByText('缓存命中 ¥0.01 · 未命中输入 ¥0.02 · 输出 ¥0.01')).toBeDefined()
  })

  it('renders an info button with the spend disclaimer', async () => {
    render(<BalanceBadge {...props(async () => estimate())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByRole('button', { name: zh['info.aria'] })).toBeDefined()
  })

  it('renders the unavailable word when the fetch rejects', async () => {
    render(<BalanceBadge {...props(async () => { throw new Error('no key') })} />)
    expect(await screen.findByText(zh['state.unavailable'])).toBeDefined()
  })

  it('keeps the last value visible while a refresh is in flight, then updates it', async () => {
    const getEstimate = vi.fn()
      .mockResolvedValueOnce(estimate())
      .mockResolvedValueOnce(new Promise(resolve => setTimeout(() => resolve(estimate({
        balance: { isAvailable: true, lines: [{ currency: 'CNY', total: '9.00', granted: '0.00', toppedUp: '9.00' }] },
      })), 20)))
    render(<BalanceBadge {...props(getEstimate)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['action.refresh'] }))
    // The previous value must stay on screen during the refetch.
    expect(screen.getByText('剩余额度：¥110.00')).toBeDefined()
    await waitFor(() => { expect(getEstimate).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(screen.getByText('剩余额度：¥9.00')).toBeDefined() })
  })

  it('prefixes USD with the dollar sign', async () => {
    const usd = estimate({ balance: { isAvailable: true, lines: [{ currency: 'USD', total: '5.00', granted: '0.00', toppedUp: '5.00' }] } })
    render(<BalanceBadge {...props(async () => usd)} />)
    await waitFor(() => { expect(screen.getByText('剩余额度：$5.00')).toBeDefined() })
  })

  it('shows the no-usage word for a session without priced usage', async () => {
    render(<BalanceBadge {...props(async () => estimate(), async () => ({ total: 0, models: [] }))} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText(`本会话花费：${zh['stat.none']}`)).toBeDefined()
  })

  it('trims trailing zeros in the spend amount', async () => {
    const trimmed: DeepSeekSessionSpend = {
      total: 0.3,
      models: [{
        model: 'deepseek-v4-flash',
        displayName: 'DeepSeek-V4-Flash',
        cost: 0.3,
        peakCost: 0,
        offPeakCost: 0.3,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 100000,
        outputTokens: 20000,
        cacheHitInputCost: 0,
        cacheMissInputCost: 0.2,
        outputCost: 0.1,
      }],
    }
    render(<BalanceBadge {...props(async () => estimate(), async () => trimmed)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('本会话花费：¥0.3')).toBeDefined()
  })
})
