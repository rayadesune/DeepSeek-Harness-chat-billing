// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BalanceBadge, SESSION_RANKING_LIMIT, type BalanceBadgeProps } from '../src/client/BalanceBadge.tsx'
import { formatTokens } from '../src/client/format.ts'
import { TurnCostAction, type TurnCostActionProps } from '../src/client/TurnCostAction.tsx'
import { createTurnCostStore, TURN_COST_STORE_LIMIT } from '../src/client/turnCostStore.ts'
import { en, zh } from '../src/client/locales.ts'
import { PLUGIN_VERSION } from '../src/client/version.ts'

/**
 * The manifest the build reads its version stamp from (see
 * packages/tsdown.client.ts). Resolved from the workspace root because vitest
 * serves test modules over an http URL, so `import.meta.url` is not a file URL.
 */
const packageVersion: string = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/ui-billing/package.json'), 'utf8'),
).version

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

/** One priced row whose only interesting part is its token buckets. */
function todaySpendWithTokens(cacheHit: number, cacheMiss: number, output: number): DeepSeekTodaySpend {
  return {
    total: 0.01,
    models: [{
      model: 'deepseek-v4-flash',
      displayName: 'DeepSeek-V4-Flash',
      cost: 0.01,
      peakCost: 0.01,
      offPeakCost: 0,
      cacheHitInputTokens: cacheHit,
      cacheMissInputTokens: cacheMiss,
      outputTokens: output,
      cacheHitInputCost: 0,
      cacheMissInputCost: 0.01,
      outputCost: 0,
    }],
  }
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

function props(
  getBalance: (force?: boolean) => Promise<DeepSeekBalance>,
  getSessionSpend: () => Promise<DeepSeekSessionSpend> = async () => SPEND,
  getTodaySpend: () => Promise<DeepSeekTodaySpend> = async () => TODAY_SPEND,
  useSession: (selector: (snapshot: { running: boolean }) => boolean) => boolean = () => false,
  getTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend> = defaultGetTodaySessionsSpend,
  getCachedBalance: () => DeepSeekBalance | null = () => null,
  useProjection: (key: string, selector?: (value: unknown) => unknown) => unknown = () => undefined,
): BalanceBadgeProps {
  return {
    getBalance,
    getCachedBalance,
    getSessionSpend,
    getTodaySpend,
    getTodaySessionsSpend,
    useSession,
    useProjection,
    sessionId: 'session-1',
    t,
  } as unknown as BalanceBadgeProps
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

  it('opens the label box with the amount, today\'s tokens and spend, this session\'s spend, and the breakdown', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('API 剩余金额：¥110.00')).toBeDefined()
    // 2,000 cache-hit + 200,000 cache-miss + 30,000 output tokens = 232,000.
    expect(screen.getByText('今日 Token：232K tok')).toBeDefined()
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeDefined()
    expect(screen.getByText('¥0.04')).toBeDefined()
    expect(screen.getByText('未缓存输入 ¥0.02 · 缓存读取 ¥0.01 · 输出 ¥0.01')).toBeDefined()
  })

  it('puts this session\'s spend on its own line, under today\'s tokens and spend', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const tokens = await screen.findByText('今日 Token：232K tok')
    const todaySpend = screen.getByText('今日花费：¥0.31')
    const sessionSpend = screen.getByText('本会话花费：¥0.04')
    // Today's tokens and today's spend share the first row; the session spend
    // sits on the next one instead of beside them.
    expect(tokens.parentElement).toBe(todaySpend.parentElement)
    expect(sessionSpend.parentElement).not.toBe(todaySpend.parentElement)
  })

  it('renders the token count in DSH\'s compact notation', async () => {
    // DSH's own rule table (ui-chat tests/chat-stats.client.spec.tsx: 517 /
    // 12.2K / 517K / 1.2M), then its edges: no digit grouping below 1e3, the
    // 1e6 threshold judged on the raw value (999,999 rounds up to 1000K), and
    // no unit above M — where a billion tokens land, since DSH ships only the
    // shared `number.thousand` and `number.million` units.
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_240)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_230_000)).toBe('1.2M')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(999_999)).toBe('1000K')
    expect(formatTokens(1_000_000_000)).toBe('1000M')
    expect(formatTokens(1_234_567_890)).toBe('1235M')
  })

  it('renders the token count through the panel with the tok suffix', async () => {
    const todaySpend = todaySpendWithTokens(1, 999, 0)
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => todaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('今日 Token：1K tok')).toBeDefined()
  })

  it('shows this session\'s share of today in parentheses once the session crossed a day', async () => {
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [
        { sessionId: 'session-other' as SessionId, title: '会话乙', total: 0.29 },
        { sessionId: 'session-1' as SessionId, title: '会话甲', total: 0.02 },
      ],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The row's own amount is the WHOLE session (¥0.04) while only ¥0.02 was
    // billed today: the two disagree, so the share is worth showing — matched by
    // session id, so neither the highest row (¥0.29) nor the total (¥0.31) leaks
    // into it.
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    expect(await screen.findByText('（¥0.02）')).toBeDefined()
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
  })

  it('hides the share when the session has not crossed a day', async () => {
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [{ sessionId: 'session-1' as SessionId, title: '会话甲', total: SPEND.total }],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    // Every yuan this session billed was billed today, so a parenthesized share
    // would only repeat the amount beside it.
    expect(screen.queryByText(/^（/)).toBeNull()
  })

  it('renders no share while the ranking is unsettled, then the confirmed zero', async () => {
    let resolveSessions!: (value: DeepSeekTodaySessionsSpend) => void
    const getTodaySessionsSpend = vi.fn(
      () => new Promise<DeepSeekTodaySessionsSpend>(resolve => { resolveSessions = resolve }),
    )
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    // Unknown is not a disagreement: an unsettled ranking renders no share (and
    // no placeholder either, since the share itself is what is conditional).
    expect(screen.queryByText(/^（/)).toBeNull()
    // Settled without a row for this session: today billed nothing, which does
    // disagree with the session's own total.
    await act(async () => {
      resolveSessions({ sessions: [{ sessionId: 'session-other' as SessionId, title: null, total: 0.29 }] })
    })
    expect(await screen.findByText('（¥0）')).toBeDefined()
  })

  it('renders an info button with the spend disclaimer', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByRole('button', { name: zh['info.aria'] })).toBeDefined()
  })

  it('shows the spend hint below the info button, version on the next line', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const info = await screen.findByRole('button', { name: zh['info.aria'] })
    fireEvent.mouseEnter(info)
    // The DSH bubble's viewport fit only corrects the vertical axis on the
    // bottom/top sides; `right` would leave a tall bubble clipped above.
    const bubble = await screen.findByRole('tooltip')
    expect(bubble.getAttribute('data-side')).toBe('bottom')
    // The primitive takes a plain string label, so the version rides the hint
    // text: its own line, flush with the left edge, from the build-time stamp.
    expect(bubble.textContent).toBe(zh['info.hint'].replace('{version}', PLUGIN_VERSION))
    expect(bubble.textContent).toContain(`\nv${packageVersion}`)
    expect(bubble.textContent).not.toContain('\n\n')
    expect(bubble.textContent).not.toContain('\u00A0')
    expect(PLUGIN_VERSION).toBe(packageVersion)
  })

  it('holds the spend hint to a tooltip-sized label in both dictionaries', () => {
    // The DSH Tooltip bubble clamps neither height nor hover: an over-long
    // label is clipped at the viewport edge and vanishes as soon as the
    // pointer leaves the button, so the rate schedule lives in the READMEs.
    // The budget covers the three lines — the estimate, the line naming the
    // parenthesized amount, and the trailing `{version}` (≈5 rendered lines at
    // the bubble's 300px cap).
    expect(zh['info.hint'].length).toBeLessThanOrEqual(105)
    expect(en['info.hint'].length).toBeLessThanOrEqual(225)
  })

  it('names the parenthesized today share in the hint, and the version after it', () => {
    // The hint explains what the 本会话花费 row's （¥X） is: this session's
    // spend today. It is its own line, and the version stays the last one.
    const lines = zh['info.hint'].split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('估算')
    expect(lines[1]).toBe('括号内为本会话今日花费。')
    expect(lines[2]).toBe('v{version}')
    expect(en['info.hint'].split('\n')).toHaveLength(3)
    expect(en['info.hint'].split('\n')[1]).toBe('The parenthesized amount is this session\'s spend today.')
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
    // The mount reads the TTL-served snapshot; the manual refresh forces.
    expect(getBalance.mock.calls[0]?.[0]).toBe(false)
    expect(getBalance.mock.calls[1]?.[0]).toBe(true)
  })

  it('renders a cached balance immediately on mount and revalidates in the background', async () => {
    const getBalance = vi.fn(async () => balance())
    const getCachedBalance = vi.fn(() => balance())
    render(<BalanceBadge {...props(getBalance, undefined, undefined, undefined, undefined, getCachedBalance)} />)
    // On screen before the revalidation settles: no blank badge on a session switch.
    expect(screen.getByText('剩余额度：¥110.00')).toBeDefined()
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(1) })
    expect(getBalance).toHaveBeenCalledWith(false)
    expect(getCachedBalance).toHaveBeenCalled()
  })

  it('renders the session spend from the pushed projection without waiting for the Remote', async () => {
    const projected = {
      dayKey: '2026-09-09',
      spend: TODAY_SPEND,
      session: SPEND,
      inheritedEventCount: 0,
    }
    const getSessionSpend = vi.fn(() => new Promise<DeepSeekSessionSpend>(() => {}))
    render(<BalanceBadge
      {...props(
        async () => balance(),
        getSessionSpend,
        undefined,
        undefined,
        undefined,
        undefined,
        (key: string) => key === 'billingTodaySpend' ? projected : undefined,
      )}
    />)
    // The projection value is live: the line renders even though the Remote never settles.
    expect(await screen.findByText('本轮对话花费：¥0.04')).toBeDefined()
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
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
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
    expect(await screen.findByText(`今日 Token：${zh['stat.none']}`)).toBeDefined()
    expect(screen.getByText(`今日花费：${zh['stat.none']}`)).toBeDefined()
  })

  it('shows a placeholder for today\'s spend when it fails to load', async () => {
    const getTodaySpend = vi.fn(async () => { throw new Error('boom') })
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The balance and session spend resolved; today's row has no value yet, and
    // the token count shares that row and that source.
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日 Token：—')).toBeDefined()
    expect(screen.getByText('今日花费：—')).toBeDefined()
  })

  it('shows the session spend as soon as it settles, without waiting for today\'s spend', async () => {
    const getTodaySpend = vi.fn(() => new Promise<DeepSeekTodaySpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The session spend landed; today's spend never settles, so its line
    // keeps the placeholder instead of blanking the other line.
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日花费：—')).toBeDefined()
  })

  it('shows today\'s spend as soon as it settles, without waiting for the session spend', async () => {
    const getSessionSpend = vi.fn(() => new Promise<DeepSeekSessionSpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, async () => TODAY_SPEND)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByText('今日花费：¥0.31')).toBeDefined()
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

  it('fetches the ranking only when the panel opens; the manual refresh forces it', async () => {
    const getTodaySessionsSpend = vi.fn(async (_force?: boolean) => ({ sessions: [] }))
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    await act(async () => {})
    // The closed badge never pays for the all-session ranking.
    expect(getTodaySessionsSpend).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    await act(async () => {})
    expect(getTodaySessionsSpend).toHaveBeenCalledTimes(1)
    expect(getTodaySessionsSpend.mock.calls[0]?.[0]).toBeFalsy()
    fireEvent.click(screen.getByRole('button', { name: zh['action.refresh'] }))
    await act(async () => {})
    expect(getTodaySessionsSpend.mock.calls[1]?.[0]).toBe(true)
  })
})

describe('TurnCostAction', () => {
  const costT: TurnCostActionProps['t'] = makeTranslate(zh)

  function renderCost(
    getTurnCost: (sessionId: SessionId, messageId: string) => Promise<number | undefined>,
    messageId = 'm1',
  ) {
    return render(<TurnCostAction
      messageId={messageId}
      sessionId={'session-1' as SessionId}
      getTurnCost={getTurnCost}
      t={costT}
      useSession={() => false}
    /> as TurnCostActionProps)
  }

  it('renders one plain ¥-amount span after the shared map resolves', async () => {
    const getTurnCost = vi.fn(async () => 0.31)
    renderCost(getTurnCost)
    // Nothing renders until the map resolves.
    expect(screen.queryByText('¥0.31')).toBeNull()
    await waitFor(() => expect(screen.getByText('¥0.31')).toBeDefined())
    // The amount is a single non-interactive span: no button, no icon, and
    // no label word.
    const amount = screen.getByText('¥0.31')
    expect(amount.tagName).toBe('SPAN')
    expect(amount.getAttribute('data-turn-cost')).not.toBeNull()
    expect(amount.querySelector('svg')).toBeNull()
    expect(screen.queryByText(/本轮花费|This turn/)).toBeNull()
    expect(getTurnCost).toHaveBeenCalledWith('session-1', 'm1')
  })

  it('trims trailing zeros to four decimals at most', async () => {
    const getTurnCost = vi.fn(async () => 8.5)
    renderCost(getTurnCost, 'm-format')
    await waitFor(() => expect(screen.getByText('¥8.5')).toBeDefined())
    expect(screen.queryByText('¥8.5000')).toBeNull()
  })

  it('hides when the Turn priced to zero', async () => {
    let resolveFetch!: (value: number | undefined) => void
    const getTurnCost = vi.fn(
      () => new Promise<number | undefined>(resolve => { resolveFetch = resolve }),
    )
    renderCost(getTurnCost, 'm-zero')
    // The component's read runs in a microtask after the effect commits.
    await waitFor(() => expect(getTurnCost).toHaveBeenCalledTimes(1))
    await act(async () => { resolveFetch(0) })
    expect(screen.queryByText(/^¥/)).toBeNull()
  })

  it('hides when the shared map has no row for the message', async () => {
    const getTurnCost = vi.fn(async () => undefined)
    renderCost(getTurnCost, 'm-missing')
    await waitFor(() => expect(getTurnCost).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/^¥/)).toBeNull()
  })

  it('stays hidden when the read fails', async () => {
    let rejectFetch!: (reason: Error) => void
    const getTurnCost = vi.fn(
      () => new Promise<number | undefined>((_, reject) => { rejectFetch = reject }),
    )
    renderCost(getTurnCost, 'm-fail')
    await waitFor(() => expect(getTurnCost).toHaveBeenCalledTimes(1))
    await act(async () => { rejectFetch(new Error('boom')) })
    expect(screen.queryByText(/^¥/)).toBeNull()
  })
})

describe('createTurnCostStore', () => {
  const sid = 'session-1' as SessionId

  it('fetches the session map once for many rows and coalesces concurrent reads', async () => {
    const fetch = vi.fn(async () => ({
      turns: [{ messageId: 'm1', total: 1 }, { messageId: 'm2', total: 2 }],
    }))
    const store = createTurnCostStore(fetch)
    const [first, second] = await Promise.all([store.get(sid, 'm1'), store.get(sid, 'm2')])
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(1)
    // A hit never refetches.
    await expect(store.get(sid, 'm1')).resolves.toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refetches once when a message id is missing (a newly completed Turn)', async () => {
    let calls = 0
    const fetch = vi.fn(async () => {
      calls += 1
      return {
        turns: calls === 1
          ? [{ messageId: 'm1', total: 1 }]
          : [{ messageId: 'm1', total: 1 }, { messageId: 'm2', total: 2 }],
      }
    })
    const store = createTurnCostStore(fetch)
    await expect(store.get(sid, 'm1')).resolves.toBe(1)
    await expect(store.get(sid, 'm2')).resolves.toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('resolves undefined on a failed fetch and recovers on the next read', async () => {
    let fail = true
    const fetch = vi.fn(async () => {
      if (fail) throw new Error('boom')
      return { turns: [{ messageId: 'm1', total: 3 }] }
    })
    const store = createTurnCostStore(fetch)
    await expect(store.get(sid, 'm1')).resolves.toBeUndefined()
    fail = false
    await expect(store.get(sid, 'm1')).resolves.toBe(3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest session map at the limit, and invalidate drops one', async () => {
    const fetch = vi.fn(async () => ({ turns: [{ messageId: 'm1', total: 1 }] }))
    const store = createTurnCostStore(fetch)
    for (let index = 0; index <= TURN_COST_STORE_LIMIT; index += 1) {
      await store.get(`session-${index}` as SessionId, 'm1')
    }
    expect(fetch).toHaveBeenCalledTimes(TURN_COST_STORE_LIMIT + 1)
    // The oldest map was evicted, so reading it again refetches.
    await store.get('session-0' as SessionId, 'm1')
    expect(fetch).toHaveBeenCalledTimes(TURN_COST_STORE_LIMIT + 2)
    store.invalidate('session-0' as SessionId)
    await store.get('session-0' as SessionId, 'm1')
    expect(fetch).toHaveBeenCalledTimes(TURN_COST_STORE_LIMIT + 3)
  })
})
