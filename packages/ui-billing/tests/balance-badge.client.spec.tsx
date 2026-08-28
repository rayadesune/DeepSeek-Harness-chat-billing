// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BalanceBadge, SESSION_RANKING_LIMIT, type BalanceBadgeProps } from '../src/client/BalanceBadge.tsx'
import { TurnCostAction, type TurnCostActionProps } from '../src/client/TurnCostAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

const TODAY_SPEND: DeepSeekTodaySpend = {
  total: 0.31,
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    cost: 0.31,
    peakCost: 0.2,
    offPeakCost: 0.11,
    cacheHitInputTokens: 2000,
    cacheMissInputTokens: 200000,
    outputTokens: 30000,
    cacheHitInputCost: 0.01,
    cacheMissInputCost: 0.2,
    outputCost: 0.1,
  }],
}

function balance(over: Partial<DeepSeekBalance> = {}): DeepSeekBalance {
  return {
    isAvailable: true,
    lines: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
    ...over,
  }
}

// Stable defaults: fresh functions per props() call would re-trigger the
// badge's fetch effects on every rerender.
const EMPTY_TODAY_SESSIONS: DeepSeekTodaySessionsSpend = { sessions: [] }
const defaultGetTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => EMPTY_TODAY_SESSIONS
const defaultGetTurnSpend = async (): Promise<{ total: number }> => ({ total: 0 })

function props(
  getBalance: () => Promise<DeepSeekBalance>,
  getSessionSpend: () => Promise<DeepSeekSessionSpend> = async () => SPEND,
  getTodaySpend: () => Promise<DeepSeekTodaySpend> = async () => TODAY_SPEND,
  useSession: (selector: (snapshot: { running: boolean }) => boolean) => boolean = () => false,
  getTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend> = defaultGetTodaySessionsSpend,
  getTurnSpend: (sessionId: SessionId, messageId: string) => Promise<{ total: number }> = defaultGetTurnSpend,
): BalanceBadgeProps {
  return {
    getBalance,
    getSessionSpend,
    getTodaySpend,
    getTodaySessionsSpend,
    getTurnSpend,
    useSession,
    sessionId: 'session-1',
    t,
  } as BalanceBadgeProps
}

describe('BalanceBadge', () => {
  it('renders nothing while the first fetch is in flight', () => {
    const { container } = render(<BalanceBadge {...props(() => new Promise(() => {}))} />)
    expect(container.innerHTML).toBe('')
  })

  it('appears as soon as the balance settles, without waiting for the spends', async () => {
    const getSessionSpend = vi.fn(() => new Promise<DeepSeekSessionSpend>(() => {}))
    const getTodaySpend = vi.fn(() => new Promise<DeepSeekTodaySpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, getTodaySpend)} />)
    // The balance landed; the badge renders even though both spends never settle.
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
  })

  it('shows the balance and this conversation spend on the trigger', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
    expect(screen.getByText('本轮对话花费：¥0.04')).toBeDefined()
  })

  it('keeps the spend line hidden while the conversation has no priced usage', async () => {
    render(<BalanceBadge {...props(async () => balance(), async () => ({ total: 0, models: [] }))} />)
    expect(await screen.findByText('剩余额度：¥110.00')).toBeDefined()
    expect(screen.queryByText(/本轮对话花费/)).toBeNull()
  })

  it('opens the label box with the amount, the spend, today\'s spend, and the cache-hit/input/output breakdown', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日共花费：¥0.31')).toBeDefined()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeDefined()
    expect(screen.getByText('¥0.04')).toBeDefined()
    expect(screen.getByText('缓存命中 ¥0.01 · 未命中输入 ¥0.02 · 输出 ¥0.01')).toBeDefined()
  })

  it('renders an info button with the spend disclaimer', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByRole('button', { name: zh['info.aria'] })).toBeDefined()
  })

  it('renders the unavailable word when the fetch rejects', async () => {
    render(<BalanceBadge {...props(async () => { throw new Error('no key') })} />)
    expect(await screen.findByText(zh['state.unavailable'])).toBeDefined()
  })

  it('keeps the last value visible while a refresh is in flight, then updates it', async () => {
    const getBalance = vi.fn()
      .mockResolvedValueOnce(balance())
      .mockResolvedValueOnce(new Promise(resolve => setTimeout(() => { resolve(balance({
        lines: [{ currency: 'CNY', total: '9.00', granted: '0.00', toppedUp: '9.00' }],
      })) }, 20)))
    render(<BalanceBadge {...props(getBalance)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['action.refresh'] }))
    // The previous value must stay on screen during the refetch.
    expect(screen.getByText('剩余额度：¥110.00')).toBeDefined()
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(screen.getByText('剩余额度：¥9.00')).toBeDefined() })
  })

  it('keeps both spend values when a refresh rejects', async () => {
    const getSessionSpend = vi.fn()
      .mockResolvedValueOnce(SPEND)
      .mockRejectedValueOnce(new Error('boom'))
    const getTodaySpend = vi.fn()
      .mockResolvedValueOnce(TODAY_SPEND)
      .mockRejectedValueOnce(new Error('boom'))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['action.refresh'] }))
    await waitFor(() => { expect(getSessionSpend).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(getTodaySpend).toHaveBeenCalledTimes(2) })
    // A failed refetch keeps the previous values instead of blanking them.
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日共花费：¥0.31')).toBeDefined()
  })

  it('recomputes only the spends when a turn settles, without refetching the balance', async () => {
    vi.useFakeTimers()
    let running = false
    const getBalance = vi.fn(async () => balance())
    const getSessionSpend = vi.fn(async () => SPEND)
    const getTodaySpend = vi.fn(async () => TODAY_SPEND)
    const { rerender } = render(
      <BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />,
    )
    // Flush the mount effect's microtask chain (no timers involved).
    await act(async () => {})
    expect(screen.getByText('剩余额度：¥110.00')).toBeDefined()
    expect(getBalance).toHaveBeenCalledTimes(1)
    const spendCallsBeforeMessage = getSessionSpend.mock.calls.length
    const todayCallsBeforeMessage = getTodaySpend.mock.calls.length

    // A turn runs and settles: the running flag flips true then false; the
    // debounced recompute fires after the 2s window, and the balance stays
    // untouched.
    running = true
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    running = false
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(getSessionSpend.mock.calls.length).toBe(spendCallsBeforeMessage)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(getSessionSpend.mock.calls.length).toBeGreaterThan(spendCallsBeforeMessage)
    expect(getTodaySpend.mock.calls.length).toBeGreaterThan(todayCallsBeforeMessage)
    expect(getBalance).toHaveBeenCalledTimes(1)
  })

  it('debounces a turn storm: turns settling inside the window price once', async () => {
    vi.useFakeTimers()
    let running = false
    const getBalance = vi.fn(async () => balance())
    const getSessionSpend = vi.fn(async () => SPEND)
    const getTodaySpend = vi.fn(async () => TODAY_SPEND)
    const { rerender } = render(
      <BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />,
    )
    await act(async () => {})
    const spendCallsBefore = getSessionSpend.mock.calls.length
    const todayCallsBefore = getTodaySpend.mock.calls.length

    // Two turns settle inside the debounce window (an agent continuing across
    // turns); only ONE recompute may fire after the window.
    running = true
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    running = false
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    running = true
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    running = false
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(getSessionSpend.mock.calls.length).toBe(spendCallsBefore + 1)
    expect(getTodaySpend.mock.calls.length).toBe(todayCallsBefore + 1)
    expect(getBalance).toHaveBeenCalledTimes(1)
  })

  it('passes force to getTodaySpend only on the manual refresh, not on mount', async () => {
    const getTodaySpend = vi.fn(async (_force?: boolean) => TODAY_SPEND)
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    await act(async () => {})
    // The mount read is a plain (cached) read — no force.
    expect(getTodaySpend.mock.calls[0]?.[0]).toBeFalsy()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(screen.getByRole('button', { name: zh['action.refresh'] }))
    await act(async () => {})
    // The manual refresh bypasses the host-side cache.
    expect(getTodaySpend.mock.calls[1]?.[0]).toBe(true)
  })

  it('keeps both spend values when a turn-settle recompute rejects', async () => {
    vi.useFakeTimers()
    let running = false
    const getBalance = vi.fn(async () => balance())
    const getSessionSpend = vi.fn(async () => SPEND)
    const getTodaySpend = vi.fn(async () => TODAY_SPEND)
    const { rerender } = render(
      <BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />,
    )
    await act(async () => {})
    expect(screen.getByText('剩余额度：¥110.00')).toBeDefined()

    // A turn settles but both recomputes reject: the previous values stay.
    running = true
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    getSessionSpend.mockRejectedValueOnce(new Error('boom'))
    getTodaySpend.mockRejectedValueOnce(new Error('boom'))
    running = false
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(getTodaySpend.mock.calls.length).toBe(2)
    expect(screen.getByText('本轮对话花费：¥0.04')).toBeDefined()
  })

  it('prefixes USD with the dollar sign', async () => {
    const usd = balance({ lines: [{ currency: 'USD', total: '5.00', granted: '0.00', toppedUp: '5.00' }] })
    render(<BalanceBadge {...props(async () => usd)} />)
    await waitFor(() => { expect(screen.getByText('剩余额度：$5.00')).toBeDefined() })
  })

  it('shows the no-usage word for a session without priced usage', async () => {
    render(<BalanceBadge {...props(async () => balance(), async () => ({ total: 0, models: [] }))} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText(`本会话花费：${zh['stat.none']}`)).toBeDefined()
  })

  it('shows the no-usage word for a day without priced usage across every session', async () => {
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => ({ total: 0, models: [] }))}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText(`今日共花费：${zh['stat.none']}`)).toBeDefined()
  })

  it('shows a placeholder for today\'s spend when it fails to load', async () => {
    const getTodaySpend = vi.fn(async () => { throw new Error('boom') })
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The balance and session spend resolved; today's spend has no value yet.
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日共花费：—')).toBeDefined()
  })

  it('shows the session spend as soon as it settles, without waiting for today\'s spend', async () => {
    const getTodaySpend = vi.fn(() => new Promise<DeepSeekTodaySpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The session spend landed; today's spend never settles, so its line
    // keeps the placeholder instead of blanking the other line.
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日共花费：—')).toBeDefined()
  })

  it('shows today\'s spend as soon as it settles, without waiting for the session spend', async () => {
    const getSessionSpend = vi.fn(() => new Promise<DeepSeekSessionSpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, async () => TODAY_SPEND)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('今日共花费：¥0.31')).toBeDefined()
    expect(screen.getByText('本会话花费：—')).toBeDefined()
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
    render(<BalanceBadge {...props(async () => balance(), async () => trimmed)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('本会话花费：¥0.3')).toBeDefined()
  })

  it('renders the today-session ranking below the model rows, highest first, with the untitled fallback', async () => {
    const getTodaySessionsSpend = async () => ({
      sessions: [
        { sessionId: 'session-a' as SessionId, title: '会话甲', total: 0.31 },
        { sessionId: 'session-b' as SessionId, title: null, total: 0.12 },
      ],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('今日会话花费')).toBeDefined()
    const names = screen.getAllByText(/会话甲|未命名/)
    expect(names[0]?.textContent).toBe('会话甲')
    expect(names[1]?.textContent).toBe('未命名')
    expect(screen.getByText('¥0.31')).toBeDefined()
    expect(screen.getByText('¥0.12')).toBeDefined()
  })

  it('caps the ranking at the limit and shows the overflow hint', async () => {
    const sessions = Array.from({ length: SESSION_RANKING_LIMIT + 3 }, (_, index) => ({
      sessionId: `session-${index}` as SessionId,
      title: `会话${index}`,
      total: 1 - index / 100,
    }))
    const getTodaySessionsSpend = async () => ({ sessions })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('今日会话花费')).toBeDefined()
    expect(screen.getAllByText(/^会话\d+$/)).toHaveLength(SESSION_RANKING_LIMIT)
    expect(screen.getByText(`…还有 3 个会话`)).toBeDefined()
  })

  it('renders no ranking section when no session priced today', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(screen.queryByText('今日会话花费')).toBeNull()
  })

  it('passes force to getTodaySessionsSpend only on the manual refresh, not on mount', async () => {
    const getTodaySessionsSpend = vi.fn(async (_force?: boolean) => ({ sessions: [] }))
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    await act(async () => {})
    expect(getTodaySessionsSpend.mock.calls[0]?.[0]).toBeFalsy()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(screen.getByRole('button', { name: zh['action.refresh'] }))
    await act(async () => {})
    expect(getTodaySessionsSpend.mock.calls[1]?.[0]).toBe(true)
  })
})

describe('TurnCostAction', () => {
  const costT: TurnCostActionProps['t'] = makeTranslate(zh)

  const TURN: DeepSeekTurnSpend = { total: 0.31 }

  function renderCost(
    getTurnSpend: (sessionId: SessionId, messageId: string) => Promise<DeepSeekTurnSpend>,
    messageId = 'm1',
  ) {
    return render(<TurnCostAction
      messageId={messageId}
      sessionId={'session-1' as SessionId}
      getTurnSpend={getTurnSpend}
      t={costT}
      useSession={() => false}
    /> as TurnCostActionProps)
  }

  it('shows the cost label after the Remote settles, then memoizes the fetch', async () => {
    const getTurnSpend = vi.fn(async () => TURN)
    renderCost(getTurnSpend)
    // The label word and the amount are separate spans (two tones).
    expect(screen.queryByText('¥0.31')).toBeNull()
    await waitFor(() => expect(screen.getByText('本轮花费')).toBeDefined())
    expect(screen.getByText('¥0.31')).toBeDefined()
    expect(getTurnSpend).toHaveBeenCalledWith('session-1', 'm1')
    expect(getTurnSpend).toHaveBeenCalledTimes(1)
    // A second mount of the same (session, message) reuses the memo.
    renderCost(getTurnSpend)
    await waitFor(() => expect(screen.getAllByText('¥0.31')).toHaveLength(2))
    expect(getTurnSpend).toHaveBeenCalledTimes(1)
  })

  it('hides when the Turn priced to zero', async () => {
    let resolveFetch!: (value: DeepSeekTurnSpend) => void
    const getTurnSpend = vi.fn(
      () => new Promise<DeepSeekTurnSpend>(resolve => { resolveFetch = resolve }),
    )
    renderCost(getTurnSpend, 'm-zero')
    // The component's fetch runs in a microtask after the effect commits.
    await waitFor(() => expect(getTurnSpend).toHaveBeenCalledTimes(1))
    await act(async () => { resolveFetch({ total: 0 }) })
    expect(screen.queryByText(/本轮花费/)).toBeNull()
  })

  it('stays hidden when the fetch fails', async () => {
    let rejectFetch!: (reason: Error) => void
    const getTurnSpend = vi.fn(
      () => new Promise<DeepSeekTurnSpend>((_, reject) => { rejectFetch = reject }),
    )
    renderCost(getTurnSpend, 'm-fail')
    await waitFor(() => expect(getTurnSpend).toHaveBeenCalledTimes(1))
    await act(async () => { rejectFetch(new Error('boom')) })
    expect(screen.queryByText(/本轮花费/)).toBeNull()
  })
})
