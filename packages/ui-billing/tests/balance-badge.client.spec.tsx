// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekBillingEstimate } from '@deepseek-ai/dsh-llm-billing/types'
import { BalanceBadge, type BalanceBadgeProps } from '../src/client/BalanceBadge.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: BalanceBadgeProps['t'] = makeTranslate(zh)

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
  getCurrentModel: () => string | null = () => 'deepseek-v4-flash',
): BalanceBadgeProps {
  return {
    getEstimate,
    getCurrentModel,
    subscribeCurrentModel: () => () => {},
    sessionId: 'session-1',
    t,
  } as BalanceBadgeProps
}

describe('BalanceBadge', () => {
  it('renders nothing while the first fetch is in flight', () => {
    const { container } = render(<BalanceBadge {...props(() => new Promise(() => {}))} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the balance and current-model estimate on the trigger', async () => {
    render(<BalanceBadge {...props(async () => estimate())} />)
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
    expect(screen.getByText('按当前模型预计还能跑：73 个任务')).toBeDefined()
  })

  it('opens the label box with the amount and one remaining-task line per model', async () => {
    render(<BalanceBadge {...props(async () => estimate())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('还能跑 73 个任务')).toBeDefined()
    expect(screen.getByText('还能跑 12 个任务')).toBeDefined()
  })

  it('shows the no-usage word for a model with no recorded sessions', async () => {
    const empty = estimate({
      models: [{ model: 'deepseek-v4-flash', displayName: 'DeepSeek-V4-Flash', tasksRemaining: null, sessionCount: 0, totalTokens: 0, avgTokensPerTask: null }],
    })
    render(<BalanceBadge {...props(async () => empty)} />)
    fireEvent.click(await screen.findByRole('button'))
    expect(await screen.findByText(zh['stat.none'])).toBeDefined()
  })

  it('shows the short form on the trigger when the current model has no remaining tasks', async () => {
    const zero = estimate({
      models: [{ model: 'deepseek-v4-flash', displayName: 'DeepSeek-V4-Flash', tasksRemaining: 0, sessionCount: 1, totalTokens: 1000, avgTokensPerTask: 1000 }],
    })
    render(<BalanceBadge {...props(async () => zero)} />)
    expect(await screen.findByText(zh['trigger.tasks.short'])).toBeDefined()
  })

  it('shows the top-up hint in the panel when a model has no remaining tasks', async () => {
    const zero = estimate({
      models: [{ model: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro', tasksRemaining: 0, sessionCount: 1, totalTokens: 1000, avgTokensPerTask: 1000 }],
    })
    render(<BalanceBadge {...props(async () => zero)} />)
    fireEvent.click(await screen.findByRole('button'))
    expect(await screen.findByText(zh['label.tasks.insufficient'])).toBeDefined()
  })

  it('renders an info button with the estimate disclaimer', async () => {
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
})
