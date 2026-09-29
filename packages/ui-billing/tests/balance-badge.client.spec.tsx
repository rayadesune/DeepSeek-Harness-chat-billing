// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekBalance, DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BalanceBadge, BALANCE_POLL_MS, SESSION_RANKING_LIMIT, type BalanceBadgeProps } from '../src/client/BalanceBadge.tsx'
import { formatCacheHitPercent, formatSpend, formatSpendSignificant, formatTokens } from '../src/client/format.ts'
import { cacheHitPercentOf } from '../src/client/spendBuckets.ts'
import css from '../src/client/BalanceBadge.module.css'
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

/**
 * The OPEN detail panel, as a query scope. The trigger repeats both of the
 * panel's labels (the chip and the box read identically by design), so every
 * assertion about a panel row goes through this scope instead of the whole
 * screen.
 */
function panel(): ReturnType<typeof within> {
  return within(screen.getByRole('dialog'))
}

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
/** A session that delegated nothing priced and STARTED TODAY: the badge's own-spend-only baseline. */
const NO_DELEGATION: DeepSeekDelegatedSpend = { total: 0, models: [], isSubagent: false, crossedDay: false }
const defaultGetDelegatedSpend = async (): Promise<DeepSeekDelegatedSpend> => NO_DELEGATION

function props(
  getBalance: (force?: boolean) => Promise<DeepSeekBalance>,
  getSessionSpend: () => Promise<DeepSeekSessionSpend> = async () => SPEND,
  getTodaySpend: () => Promise<DeepSeekTodaySpend> = async () => TODAY_SPEND,
  useSession: (selector: (snapshot: { running: boolean }) => boolean) => boolean = () => false,
  getTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend> = defaultGetTodaySessionsSpend,
  getCachedBalance: () => DeepSeekBalance | null = () => null,
  useProjection: (key: string, selector?: (value: unknown) => unknown) => unknown = () => undefined,
  getDelegatedSpend: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend> = defaultGetDelegatedSpend,
  getBalanceDaySpend: (balance: DeepSeekBalance) => number | null = () => null,
): BalanceBadgeProps {
  return {
    getBalance,
    getCachedBalance,
    getSessionSpend,
    getTodaySpend,
    getTodaySessionsSpend,
    getDelegatedSpend,
    getBalanceDaySpend,
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
    expect(await screen.findByText('剩余金额：¥110.00')).toBeDefined()
  })

  it('shows the balance and today\'s spend on the trigger', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    // The balance line is the panel headline without its "API" prefix; the spend
    // line is the panel's own today label, word for word.
    expect(await screen.findByText('剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
    expect(screen.queryByText('API 剩余金额：¥110.00')).toBeNull()
    expect(screen.queryByText('剩余额度：¥110.00')).toBeNull()
    // The conversation's own amount is the composer pill's now, not the badge's.
    expect(screen.queryByText(/本会话花费/)).toBeNull()
  })

  it('labels the trigger spend line exactly as the panel does', () => {
    // One wording, two surfaces: the chip's spend line IS the panel's today
    // label, so the dictionaries must not drift apart.
    expect(zh['trigger.balance']).toBe('剩余金额：{amount}')
    expect(en['trigger.balance']).toBe('Balance: {amount}')
    expect(zh['label.amount']).toBe('API 剩余金额：{amount}')
    expect(zh['label.todaySpend']).toBe('今日花费：{amount}')
    expect(en['label.todaySpend']).toBe('Today spend: {amount}')
  })

  it('keeps the spend line hidden while today has no priced usage', async () => {
    render(<BalanceBadge {...props(async () => balance(), undefined, async () => ({ total: 0, models: [] }))} />)
    expect(await screen.findByText('剩余金额：¥110.00')).toBeDefined()
    expect(screen.queryByText(/^今日花费：/)).toBeNull()
  })

  it('shows the line for a conversation with no priced usage of its own', async () => {
    // The second line is ACCOUNT-level: it reports the day, so a session that
    // priced nothing still shows what today's other sessions cost.
    render(<BalanceBadge {...props(async () => balance(), async () => ({ total: 0, models: [] }))} />)
    expect(await screen.findByText('今日花费：¥0.31')).toBeDefined()
  })

  it('opens the label box with the amount, today\'s tokens and spend, and today\'s bucket lines', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(panel().getByText('API 剩余金额：¥110.00')).toBeDefined()
    // 2,000 cache-hit + 200,000 cache-miss + 30,000 output tokens = 232,000.
    expect(panel().getByText('今日 Token：232K tok')).toBeDefined()
    // The trigger repeats the panel's line from the SAME state, so the string
    // is on screen twice while the box is open.
    expect(screen.getAllByText('今日花费：¥0.31')).toHaveLength(2)
    // No session row and no per-model block anywhere in the panel: this
    // conversation's amount is the composer pill's.
    expect(panel().queryByText(/本会话花费/)).toBeNull()
    expect(panel().queryByText('DeepSeek-V4-Flash')).toBeNull()
    expect(panel().queryByText('¥0.04')).toBeNull()
    // Today's two bucket lines: the tokens, then their costs.
    expect(panel().getByText('未缓存输入 200K tok · 缓存读取 2K tok · 输出 30K tok')).toBeDefined()
    expect(panel().getByText('未缓存输入 ¥0.2 · 缓存读取 ¥0.01 · 输出 ¥0.1')).toBeDefined()
  })

  it('shows today\'s consumption from the balance series after the amount', async () => {
    // The API-arithmetic caliber (balanceDay.ts, mirroring the balanceinfo
    // program): today's first queried balance minus the current one, plus the
    // day's top-ups. It rides the headline amount as a level-one rider, bare —
    // no wording and no parentheses (the info hint names it).
    const getBalanceDaySpend = vi.fn(() => 9.58)
    render(<BalanceBadge
      {...props(async () => balance(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, getBalanceDaySpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const amountRow = await panel().findByText('API 剩余金额：¥110.00')
    const rider = panel().getByText('¥9.58')
    // Inside the amount's own label, in the riders' own class: the tone plus the
    // locale string's leading space are what set it apart from the figure.
    expect(amountRow.contains(rider)).toBe(true)
    expect(rider.className).toBe(css.amountToday)
    expect(rider.textContent).toBe(' ¥9.58')
    // Measured against the amount on screen, not a remembered one.
    expect(getBalanceDaySpend).toHaveBeenLastCalledWith(balance())
  })

  it('renders no consumption rider before today\'s first balance sample', async () => {
    // `null` means today holds no sample for the amount's currency yet: nothing
    // measured renders NOTHING rather than a ¥0 that would read as a figure.
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(document.querySelector(`.${css.amountToday}`)).toBeNull()
  })

  it('renders spend amounts at three significant digits', () => {
    // Every spend figure rounds to three significant digits (their last decimals
    // move with every request) — the day's amount, its bucket costs, the session
    // line, the per-model rows, and the ranking all format through the same
    // helper. Only the balance line keeps `formatSpend`'s up-to-four decimals.
    expect(formatSpendSignificant(9.5806)).toBe('¥9.58')
    expect(formatSpendSignificant(0.5068)).toBe('¥0.507')
    expect(formatSpendSignificant(6.9414)).toBe('¥6.94')
    expect(formatSpendSignificant(2.1324)).toBe('¥2.13')
    expect(formatSpendSignificant(13.8221)).toBe('¥13.8')
    expect(formatSpendSignificant(10.4422)).toBe('¥10.4')
    expect(formatSpendSignificant(0.31)).toBe('¥0.31')
    expect(formatSpendSignificant(0.2)).toBe('¥0.2')
    expect(formatSpendSignificant(1234.5)).toBe('¥1230')
    expect(formatSpendSignificant(0)).toBe('¥0')
    // Never finer than the panel's own four decimals: a microscopic bucket shows
    // `¥0` (the string would otherwise widen its column past the token cell).
    expect(formatSpendSignificant(0.00002)).toBe('¥0')
    expect(formatSpendSignificant(0.0000099)).toBe('¥0')
    expect(formatSpendSignificant(0.000123)).toBe('¥0.0001')
    // The balance keeps the plain four-decimal renderer.
    expect(formatSpend(0.5068)).toBe('¥0.5068')
  })

  it('keeps a whole amount of zero intact in the four-decimal renderer', () => {
    // The trim is anchored to the decimal part: a pattern that also swallowed an
    // integer `0` rendered `0` as a bare `¥`, because every digit of `0.0000` is
    // a trailing zero. Zero is a figure, not an empty state.
    expect(formatSpend(0)).toBe('¥0')
    expect(formatSpend(0.5)).toBe('¥0.5')
    expect(formatSpend(12.5)).toBe('¥12.5')
    expect(formatSpend(123.4567)).toBe('¥123.4567')
    expect(formatSpend(1.0000)).toBe('¥1')
  })

  it('shows the day row and its detail lines with the three-digit amounts', async () => {
    // The numbers a real day reported: 2.3M + 328M + 986K tokens costing
    // ¥0.5068 + ¥6.9414 + ¥2.1324 = ¥9.5806.
    const day: DeepSeekTodaySpend = {
      total: 9.5806,
      models: [{
        model: 'deepseek-flash',
        displayName: 'DeepSeek-V41-Flash',
        cost: 9.5806,
        peakCost: 9.5806,
        offPeakCost: 0,
        cacheHitInputTokens: 328_000_000,
        cacheMissInputTokens: 2_300_000,
        outputTokens: 986_000,
        cacheHitInputCost: 6.9414,
        cacheMissInputCost: 0.5068,
        outputCost: 2.1324,
      }],
    }
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => day)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('今日花费：¥9.58')).toBeDefined()
    expect(panel().getByText('今日 Token：331M tok')).toBeDefined()
    // 328M of the day's 330.3M prompt-side tokens came from cache: 99.3%, which
    // the official rule prints as an integer — the day's hit share rides the
    // token figure in the session row's own parenthesized style.
    expect(panel().getByText('99%')).toBeDefined()
    expect(panel().getByText('未缓存输入 2.3M tok · 缓存读取 328M tok · 输出 986K tok')).toBeDefined()
    expect(panel().getByText('未缓存输入 ¥0.507 · 缓存读取 ¥6.94 · 输出 ¥2.13')).toBeDefined()
  })

  it('rounds today\'s figure, its bucket costs, and the ranking to three significant digits', async () => {
    // The reported panel: a day at ¥13.8221 whose buckets are ¥0.6036 +
    // ¥10.4422 + ¥2.7763, with today's ranking row at ¥13.8911. All of them are
    // spends, so all of them render short — the same resolution as the day row.
    const day: DeepSeekTodaySpend = {
      total: 13.8221,
      models: [{
        model: 'deepseek-flash',
        displayName: 'DeepSeek-V41-Flash',
        cost: 13.8221,
        peakCost: 13.8221,
        offPeakCost: 0,
        cacheHitInputTokens: 328_000_000,
        cacheMissInputTokens: 2_300_000,
        outputTokens: 986_000,
        cacheHitInputCost: 10.4422,
        cacheMissInputCost: 0.6036,
        outputCost: 2.7763,
      }],
    }
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [{ sessionId: 'session-2' as SessionId, title: '今日会话花费', total: 13.8911, ownTotal: 13.8911 }],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => day, () => false, getTodaySessionsSpend)}
    />)
    // The trigger's spend line is the same figure, rounded the same way.
    expect(await screen.findByText('今日花费：¥13.8')).toBeDefined()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('今日花费：¥13.8')).toBeDefined()
    expect(panel().getByText('未缓存输入 ¥0.604 · 缓存读取 ¥10.4 · 输出 ¥2.78')).toBeDefined()
    expect(panel().getByText('¥13.9')).toBeDefined()
    // The balance is not a spend: it keeps its four-decimal renderer.
    expect(panel().getByText('API 剩余金额：¥110.00')).toBeDefined()
  })

  it('explains today\'s figures with the two bucket detail lines under them', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // TODAY_SPEND's rows: 200,000 cache-miss + 2,000 cache-hit + 30,000 output
    // tokens, costing ¥0.2 + ¥0.01 + ¥0.1 — the day row's own 232K tok / ¥0.31.
    // Each line stands on its own with its natural " · " spacing (no column
    // alignment), in the panel's breakdown typography on the tighter
    // ranking-row rhythm.
    const tokenLine = await panel().findByText('未缓存输入 200K tok · 缓存读取 2K tok · 输出 30K tok')
    const costLine = panel().getByText('未缓存输入 ¥0.2 · 缓存读取 ¥0.01 · 输出 ¥0.1')
    expect(tokenLine.parentElement?.classList.contains(css.dayBucketRow)).toBe(true)
    expect(costLine.parentElement?.classList.contains(css.dayBucketRow)).toBe(true)
    expect(tokenLine.parentElement?.querySelector(`.${css.costBreakdown}`)).not.toBeNull()
    // Token line first, then the cost line: directly under the day row they
    // explain, and above the ranking.
    const dayRow = panel().getByText('今日 Token：232K tok')
    expect(dayRow.parentElement?.nextElementSibling?.textContent).toBe(tokenLine.textContent)
    expect(tokenLine.parentElement?.nextElementSibling?.textContent).toBe(costLine.textContent)
  })

  it('renders no bucket detail lines for a day without priced usage', async () => {
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => ({ total: 0, models: [] }))} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText(`今日 Token：${zh['stat.none']}`)).toBeDefined()
    // No bucket line: its own shape is a three-bucket TOKEN line. No share
    // either: a day that billed no prompt input has no ratio to print.
    expect(panel().queryByText(/tok · /)).toBeNull()
    expect(document.querySelector(`.${css.todayHit}`)).toBeNull()
  })

  it('names today\'s unpriced usage instead of claiming there was none', async () => {
    const today: DeepSeekTodaySpend = {
      total: 0,
      models: [],
      unpriced: { events: 2, tokens: 3_500, models: ['mimo-v2.7-flash'] },
    }
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => today)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The empty state must not claim "no usage": usage WAS recorded, it simply
    // matched no rate — the MiMo-V2.6 gap, where a plain ¥0 read as "nothing
    // happened" and nothing invited the reader to doubt it.
    expect(await panel().findByText(`今日 Token：${zh['stat.unpricedOnly']}`)).toBeDefined()
    expect(panel().getByText(`今日花费：${zh['stat.unpricedOnly']}`)).toBeDefined()
    // Named, because "some usage may be missing" is only actionable with a model.
    const notice = panel().getByText('未计价用量：mimo-v2.7-flash（无匹配费率）')
    expect(notice.classList.contains(css.costBreakdown)).toBe(true)
  })

  it('keeps priced usage normal and lists unpriced models beside it', async () => {
    const today: DeepSeekTodaySpend = {
      total: 3.52,
      models: [{
        model: 'mimo-v2.5',
        displayName: 'mimo-v2.5',
        cost: 3.52,
        peakCost: 3.52,
        offPeakCost: 0,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 1_500_000,
        outputTokens: 1_000_000,
        cacheHitInputCost: 1.5,
        cacheMissInputCost: 1.5,
        outputCost: 2,
      }],
      unpriced: { events: 1, tokens: 2_500_000, models: ['deepseek-chat'] },
    }
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => today)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The priced part reads as an ordinary figure; the unpriced part is named
    // rather than folded into it at some guessed rate.
    expect(await panel().findByText('今日花费：¥3.52')).toBeDefined()
    expect(panel().getByText('未计价用量：deepseek-chat（无匹配费率）')).toBeDefined()
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

  it('renders the cache-hit share in DSH\'s own percentage rule', () => {
    // ui-chat's rule (packages/client/ui-chat/src/client/chat/token-format.ts),
    // rule for rule: an integer percentage, but never a partial hit rounded up
    // to a full one — the decimals grow just far enough to stay below 100, so a
    // 99% day stays `99` while 199/200 prints `99.5` and 1999/2000 prints
    // `99.95`. No prompt input has no percentage at all.
    expect(formatCacheHitPercent(0, 100)).toBe('0')
    expect(formatCacheHitPercent(1, 2)).toBe('50')
    expect(formatCacheHitPercent(99, 100)).toBe('99')
    expect(formatCacheHitPercent(199, 200)).toBe('99.5')
    expect(formatCacheHitPercent(1999, 2000)).toBe('99.95')
    // A FULL hit is the one case that prints 100; the one-decimal variant drops
    // a redundant trailing zero instead of printing `50.0` (DSH's own case).
    expect(formatCacheHitPercent(100, 100)).toBe('100')
    expect(formatCacheHitPercent(1, 2, 1)).toBe('50')
    expect(formatCacheHitPercent(0, 0)).toBeNull()
    // The ratio is over prompt-side tokens: output never enters the denominator.
    expect(cacheHitPercentOf(todaySpendWithTokens(199, 1, 1_000_000))).toBe('99.5')
  })

  it('shows the day\'s cache-hit share after the token figure', async () => {
    const todaySpend = todaySpendWithTokens(199, 1, 20_000)
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, async () => todaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const row = await panel().findByText('今日 Token：20.2K tok')
    // The share rides the figure itself — bare percentage in the very style the
    // session row's today amount uses, so the two riders read as one family.
    const share = panel().getByText('99.5%')
    expect(row.contains(share)).toBe(true)
    expect(share.className).toBe(css.todayHit)
  })

  it('defines the panel\'s three type levels and binds every text element to one', () => {
    // The panel's typography is exactly three levels, defined once as custom
    // properties on `.panel` (see the stylesheet's own note) — L1 the detail
    // figures (bucket lines, a whole ranking row, the two riders), L2 the one
    // list title (今日会话花费), L3 the rows that name a figure (今日 Token,
    // 今日花费). Every member references its level's tokens, so retuning a level
    // cannot leave one row behind.
    const cssText = readFileSync(join(process.cwd(), 'packages/ui-billing/src/client/BalanceBadge.module.css'), 'utf8')
    const levelOf = (selector: string): string => {
      const start = cssText.indexOf(`\n${selector}`)
      if (start < 0) return 'missing'
      const body = cssText.slice(cssText.indexOf('{', start), cssText.indexOf('}', start))
      return /--billing-type-(\d)-/.exec(body)?.[1] ?? 'none'
    }
    for (const [level, selectors] of Object.entries({
      1: ['.costBreakdown', '.rankingIndex', '.rankingDot', '.rankingName', '.rankingAmount', '.rankingMore', '.todayHit', '.amountToday'],
      2: ['.rankingTitle'],
      3: ['.amountLabel'],
    })) {
      for (const selector of selectors) expect(`${selector} -> ${levelOf(selector)}`).toBe(`${selector} -> ${level}`)
    }
    for (const declaration of [
      '--billing-type-1-size: 11px', '--billing-type-1-line: 16px', '--billing-type-1-tone: var(--dsw-alias-label-tertiary)',
      '--billing-type-2-size: 12px', '--billing-type-2-line: 18px', '--billing-type-2-tone: var(--dsw-alias-label-secondary)',
      '--billing-type-3-size: 13px', '--billing-type-3-line: 18px', '--billing-type-3-tone: var(--dsw-alias-label-primary)',
    ]) expect(cssText).toContain(declaration)
    // The riders carry no parentheses: the level-one tone plus the locale string's
    // own leading space are what set them apart from the figure beside them.
    expect(zh['label.todayTokens.hit']).toBe(' {percent}%')
    expect(en['label.todayTokens.hit']).toBe(' {percent}%')
    expect(zh['label.amount.todaySpend']).toBe(' {amount}')
    expect(en['label.amount.todaySpend']).toBe(' {amount}')
  })

  it('renders an info button with the spend disclaimer', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await screen.findByRole('button', { name: zh['info.aria'] })).toBeDefined()
  })

  it('opens the spend hint after the dwell, one row per line with the version below', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const info = await screen.findByRole('button', { name: zh['info.aria'] })
    const lines = zh['info.hint'].replace('{version}', PLUGIN_VERSION).split('\n')
    // A dwell, not an instant: crossing the row towards the refresh button
    // must not flash the notice open.
    expect(screen.queryByText(lines[0])).toBeNull()
    fireEvent.pointerEnter(info)
    expect(await screen.findByText(lines[0])).toBeDefined()
    for (const line of lines) expect(screen.getByText(line)).toBeDefined()
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe(`v${packageVersion}`)
    expect(PLUGIN_VERSION).toBe(packageVersion)
    // Each line is its own row, and the build stamp reads at the metadata level
    // rather than riding the prose: a version is not a caliber.
    expect(screen.getByText(lines[0]).className).toBe(css.hintLine)
    expect(screen.getByText(lines[3]).className).toBe(css.hintVersion)
  })

  it('keeps the notice readable by resting it clear of the panel', async () => {
    // Why this is a hover card and not a tooltip: a four-line notice has to be
    // moved onto and read. The primitive portals the card to the body itself,
    // which is also what puts it out of reach of the panel's `backdrop-filter`
    // — that filter would otherwise become the containing block for the fixed
    // card and drag it off-screen, exactly as it did to the bubble this
    // replaced. jsdom has no layout, so the positioning itself needs a browser;
    // what is observable here is the portaling and the pointer contract.
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const info = await screen.findByRole('button', { name: zh['info.aria'] })
    const firstLine = zh['info.hint'].split('\n')[0]
    fireEvent.pointerEnter(info)
    const line = await screen.findByText(firstLine)
    // Outside the panel's subtree entirely — nothing of it to inherit, either.
    expect(screen.getByRole('dialog').contains(line)).toBe(false)
    expect(document.body.contains(line)).toBe(true)
    // Leaving the anchor arms the grace close instead of firing it, so the
    // pointer survives the trip into the card and can select its text.
    const card = line.parentElement
    fireEvent.pointerLeave(info)
    fireEvent.pointerEnter(card!)
    expect(screen.queryByText(firstLine)).not.toBeNull()
    // Escape is the keyboard way out of the same card.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(firstLine)).toBeNull()
  })

  it('holds the spend hint to a tooltip-sized label in both dictionaries', () => {
    // The hint card is 300px wide and floats over the transcript, and nothing
    // in it scrolls: an over-long notice grows a slab that covers the
    // conversation behind it, so the rate schedule lives in the READMEs. The
    // budget covers the four lines — the estimate, the amount rider with the
    // caliber behind it, the line naming what a conversation's amount includes,
    // and the trailing `{version}` (≈6 rendered lines at the card's 300px cap).
    expect(zh['info.hint'].length).toBeLessThanOrEqual(176)
    expect(en['info.hint'].length).toBeLessThanOrEqual(450)
  })

  it('names the amount rider and the delegated subagents in the hint', () => {
    // The hint explains what the figure after the API balance measures (today's
    // consumption from the balance series itself, with the caliber that produces
    // it) and what a conversation's amount covers (its own spend plus the
    // subagent sessions it delegated — the ranking rows and the composer pill
    // both merge them). Each is its own line, in panel order, and the version
    // stays the last one.
    const lines = zh['info.hint'].split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('估算')
    expect(lines[1]).toBe('API 剩余金额后的数字为今日消费：今日首次查询余额 − 当前余额 + 今日充值（充值按 10 元步进识别）。')
    expect(lines[2]).toBe('会话花费含其委派的子代理会话。')
    expect(lines[3]).toBe('v{version}')
    const enLines = en['info.hint'].split('\n')
    expect(enLines).toHaveLength(4)
    expect(enLines[1]).toBe('The figure after the API balance is today\'s consumption: the day\'s first queried balance minus the current one, plus today\'s top-ups (identified in ¥10 steps).')
    expect(enLines[2]).toBe('A conversation\'s spend includes the subagent sessions it delegated.')
  })

  it('renders the unavailable word when the fetch rejects', async () => {
    render(<BalanceBadge {...props(async () => { throw new Error('no key') })} />)
    expect(await screen.findByText(zh['state.unavailable'])).toBeDefined()
  })

  it('opens the panel from the unavailable chip, carrying the error and the refresh action', async () => {
    const getBalance = vi.fn()
      .mockRejectedValueOnce(new Error('no key'))
      .mockResolvedValueOnce(balance())
    render(<BalanceBadge {...props(getBalance)} />)
    // The chip's accessible name IS the failure, so the one control on screen
    // says what went wrong rather than just that something did.
    fireEvent.click(await screen.findByRole('button', { name: 'no key' }))
    // The card opens with the headline the panel owns (`—`, the total being
    // unknown) and the Remote's own message in full.
    expect(panel().getByText('API 剩余金额：—')).toBeDefined()
    // The row is the short actionable sentence, NOT the Remote's own message:
    // that text stays on the chip's accessible name (asserted above) and in the
    // host log, and would read as transport noise inside the card.
    expect(panel().getByText(zh['notice.unavailable'])).toBeDefined()
    expect(panel().queryByText('no key')).toBeNull()
    // The refresh action lives in the panel, so a reader who opened the card
    // retries from there; a plain read does not force.
    fireEvent.click(panel().getByRole('button', { name: zh['action.refresh'] }))
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(2) })
    expect(getBalance.mock.calls[1]?.[0]).toBe(true)
    // The recovered amount replaces the chip and the card's headline.
    await waitFor(() => { expect(panel().getByText('API 剩余金额：¥110.00')).toBeDefined() })
    expect(screen.queryByText(zh['state.unavailable'])).toBeNull()
  })

  it('keeps the two unavailable rows short, localized, and free of transport text', () => {
    // One wording, two surfaces: the row's prefix is the chip's own word. Both
    // rows stay short — no placeholders, since the Remote's English message is
    // deliberately not rendered.
    expect(zh['notice.unavailable']).toContain(zh['state.unavailable'])
    expect(en['notice.unavailable']).toContain(en['state.unavailable'])
    for (const text of [zh['notice.unavailable'], en['notice.unavailable'], zh['notice.none'], en['notice.none']]) {
      expect(text).not.toContain('{')
      expect(text.length).toBeLessThanOrEqual(40)
    }
  })

  it('opens the panel with the day\'s spend for an API key that reports no balance', async () => {
    // The API answered (no failure): it simply names no spendable balance. The
    // chip keeps the ordinary label with a `—` amount — nothing "failed" — and
    // the card still reports the account-level day, which is read from the
    // session logs and owes the balance read nothing.
    render(<BalanceBadge {...props(async () => balance({ isAvailable: false, lines: [] }))} />)
    const trigger = await screen.findByRole('button', { name: 'DeepSeek 额度：—' })
    expect(screen.getByText('剩余金额：—')).toBeDefined()
    // Today's spend is independent of the balance and stays on the chip.
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
    fireEvent.click(trigger)
    expect(panel().getByText('API 剩余金额：—')).toBeDefined()
    expect(panel().getByText(zh['notice.none'])).toBeDefined()
    expect(panel().getByText('今日花费：¥0.31')).toBeDefined()
    expect(panel().getByText('今日 Token：232K tok')).toBeDefined()
    // No failure wording: nothing was rejected.
    expect(screen.queryByText(zh['state.unavailable'])).toBeNull()
  })

  it('keeps the chip\'s spend line when the balance read is rejected', async () => {
    // The failure branch is not spend-blind: the day's figure is account-level,
    // so a rejected balance still shows what today cost on the chip and in the
    // card.
    render(<BalanceBadge {...props(async () => { throw new Error('no key') })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'no key' }))
    // Chip and panel both repeat the same account-level line, exactly as they
    // do for a healthy balance.
    expect(screen.getAllByText('今日花费：¥0.31')).toHaveLength(2)
    expect(panel().getByText('今日花费：¥0.31')).toBeDefined()
    expect(panel().getByText('API 剩余金额：—')).toBeDefined()
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
    // The previous value must stay on screen during the refetch (panel scope:
    // the trigger repeats the same line).
    expect(panel().getByText('API 剩余金额：¥110.00')).toBeDefined()
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(panel().getByText('API 剩余金额：¥9.00')).toBeDefined() })
    // The mount reads the TTL-served snapshot; the manual refresh forces.
    expect(getBalance.mock.calls[0]?.[0]).toBe(false)
    expect(getBalance.mock.calls[1]?.[0]).toBe(true)
  })

  it('renders a cached balance immediately on mount and revalidates in the background', async () => {
    const getBalance = vi.fn(async () => balance())
    const getCachedBalance = vi.fn(() => balance())
    render(<BalanceBadge {...props(getBalance, undefined, undefined, undefined, undefined, getCachedBalance)} />)
    // On screen before the revalidation settles: no blank badge on a session switch.
    expect(screen.getByText('剩余金额：¥110.00')).toBeDefined()
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(1) })
    expect(getBalance).toHaveBeenCalledWith(false)
    expect(getCachedBalance).toHaveBeenCalled()
  })

  it('keeps today\'s value when a refresh rejects', async () => {
    const getSessionSpend = vi.fn()
      .mockResolvedValueOnce(SPEND)
      .mockRejectedValueOnce(new Error('boom'))
    const getTodaySpend = vi.fn()
      .mockResolvedValueOnce(TODAY_SPEND)
      .mockResolvedValueOnce(TODAY_SPEND)
      .mockRejectedValueOnce(new Error('boom'))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    fireEvent.click(await screen.findByRole('button', { name: zh['action.refresh'] }))
    await waitFor(() => { expect(getSessionSpend).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(getTodaySpend).toHaveBeenCalledTimes(3) })
    // A failed refetch keeps the previous value instead of blanking it.
    expect(panel().getByText('今日花费：¥0.31')).toBeDefined()
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
    expect(screen.getByText('剩余金额：¥110.00')).toBeDefined()
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

  it('re-reads only this session on a session switch, leaving the account-level reads alone', async () => {
    const getBalance = vi.fn(async () => balance())
    const getSessionSpend = vi.fn(async () => SPEND)
    const getTodaySpend = vi.fn(async () => TODAY_SPEND)
    // One props object: fresh function identities per render would re-trigger
    // the effects for a reason other than the session switch under test.
    const base = props(getBalance, getSessionSpend, getTodaySpend)
    const { rerender } = render(<BalanceBadge {...base} />)
    await waitFor(() => { expect(getBalance).toHaveBeenCalledTimes(1) })
    expect(getSessionSpend).toHaveBeenCalledTimes(1)
    expect(getTodaySpend).toHaveBeenCalledTimes(1)

    // Another conversation: this session's own reads re-run, while the balance
    // and today's spend do not — neither answer varies by session, and
    // re-reading them (waiting on the day's whole-session scan) is what held
    // the header spinner on every switch.
    rerender(<BalanceBadge {...base} sessionId={'session-2' as SessionId} />)
    await waitFor(() => { expect(getSessionSpend).toHaveBeenCalledTimes(2) })
    expect(getBalance).toHaveBeenCalledTimes(1)
    expect(getTodaySpend).toHaveBeenCalledTimes(1)
  })

  it('polls the balance every five minutes while the page is visible', async () => {
    // The day's consumption is measured from the FIRST balance queried on the
    // local day, so the sampling cadence IS that figure's resolution: a page left
    // open across midnight takes the new day's baseline within one interval
    // (balanceinfo's own five-minute poll), and a top-up surfaces within one
    // interval instead of only at the next mount.
    vi.useFakeTimers()
    const getBalance = vi.fn(async () => balance())
    render(<BalanceBadge {...props(getBalance)} />)
    // Flush the mount effect's microtask chain (no timers involved).
    await act(async () => {})
    expect(getBalance).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(BALANCE_POLL_MS) })
    expect(getBalance).toHaveBeenCalledTimes(2)
    // The poll rides the CACHED path (no `force`): the host's own 15-second TTL
    // still merges everything inside its window.
    expect(getBalance).toHaveBeenLastCalledWith()
    await act(async () => { vi.advanceTimersByTime(BALANCE_POLL_MS) })
    expect(getBalance).toHaveBeenCalledTimes(3)
  })

  it('stops polling while the page is hidden and refreshes once when it returns', async () => {
    // A backgrounded tab costs nothing, and a tab that slept through midnight
    // re-baselines the new day on the refresh its return triggers.
    vi.useFakeTimers()
    const getBalance = vi.fn(async () => balance())
    render(<BalanceBadge {...props(getBalance)} />)
    await act(async () => {})
    expect(getBalance).toHaveBeenCalledTimes(1)

    let hidden = true
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(BALANCE_POLL_MS * 3) })
    expect(getBalance).toHaveBeenCalledTimes(1)

    hidden = false
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    expect(getBalance).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(BALANCE_POLL_MS) })
    expect(getBalance).toHaveBeenCalledTimes(3)
    Reflect.deleteProperty(document, 'hidden')
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

  it('passes force to getTodaySpend on the manual refresh, not on mount or a panel open', async () => {
    const getTodaySpend = vi.fn(async (_force?: boolean) => TODAY_SPEND)
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    await act(async () => {})
    // The mount read is a plain (cached) read — no force.
    expect(getTodaySpend.mock.calls[0]?.[0]).toBeFalsy()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    await act(async () => {})
    // Opening the panel re-reads the day row, through the cached path too.
    expect(getTodaySpend.mock.calls[1]?.[0]).toBeFalsy()
    fireEvent.click(screen.getByRole('button', { name: zh['action.refresh'] }))
    await act(async () => {})
    // The manual refresh bypasses the host-side cache.
    expect(getTodaySpend.mock.calls[2]?.[0]).toBe(true)
  })

  it('forces the day reads when a turn settles, so the figure is not a turn behind', async () => {
    vi.useFakeTimers()
    let running = false
    const getBalance = vi.fn(async () => balance())
    const getSessionSpend = vi.fn(async () => SPEND)
    const getTodaySpend = vi.fn(async (_force?: boolean) => TODAY_SPEND)
    const getDelegatedSpend = vi.fn(async (_sessionId: SessionId, _force?: boolean) => NO_DELEGATION)
    const base = props(getBalance, getSessionSpend, getTodaySpend, () => running, undefined, undefined, undefined, getDelegatedSpend)
    const { rerender } = render(<BalanceBadge {...base} />)
    await act(async () => {})
    // The mount reads are plain (cached) reads.
    expect(getTodaySpend.mock.calls[0]?.[0]).toBeFalsy()
    expect(getDelegatedSpend.mock.calls[0]?.[1]).toBeFalsy()

    running = true
    rerender(<BalanceBadge {...base} />)
    running = false
    rerender(<BalanceBadge {...base} />)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    // The settle asks for the post-turn value: a plain read would be answered
    // from the value on hand with a refresh running behind it — one turn late.
    expect(getTodaySpend.mock.calls[1]?.[0]).toBe(true)
    expect(getDelegatedSpend.mock.calls[1]?.[1]).toBe(true)
  })

  it('re-reads today\'s spend when the panel opens, so an idle switch does not leave the day row behind', async () => {
    const getTodaySpend = vi.fn(async () => TODAY_SPEND)
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    await act(async () => {})
    expect(getTodaySpend).toHaveBeenCalledTimes(1)

    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    await act(async () => {})
    expect(getTodaySpend).toHaveBeenCalledTimes(2)
    // Opening is not a refresh: it takes the cached path.
    expect(getTodaySpend.mock.calls[1]?.[0]).toBeFalsy()
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
    expect(screen.getByText('剩余金额：¥110.00')).toBeDefined()

    // A turn settles but both recomputes reject: the previous values stay.
    running = true
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    getSessionSpend.mockRejectedValueOnce(new Error('boom'))
    getTodaySpend.mockRejectedValueOnce(new Error('boom'))
    running = false
    rerender(<BalanceBadge {...props(getBalance, getSessionSpend, getTodaySpend, () => running)} />)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(getTodaySpend.mock.calls.length).toBe(2)
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
  })

  it('prefixes USD with the dollar sign', async () => {
    const usd = balance({ lines: [{ currency: 'USD', total: '5.00', granted: '0.00', toppedUp: '5.00' }] })
    render(<BalanceBadge {...props(async () => usd)} />)
    await waitFor(() => { expect(screen.getByText('剩余金额：$5.00')).toBeDefined() })
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
    // The balance resolved; today's row has no value yet, and the token count
    // shares that row and that source.
    expect(await panel().findByText('API 剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('今日 Token：—')).toBeDefined()
    expect(screen.getByText('今日花费：—')).toBeDefined()
  })

  it('shows today\'s spend as soon as it settles, without waiting for the session read', async () => {
    const getSessionSpend = vi.fn(() => new Promise<DeepSeekSessionSpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), getSessionSpend, async () => TODAY_SPEND)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // Twice: the trigger's line and the panel's row, both from the same state.
    expect(await screen.findAllByText('今日花费：¥0.31')).toHaveLength(2)
  })

  it('trims trailing zeros in today\'s amount', async () => {
    const trimmed: DeepSeekTodaySpend = {
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
    render(<BalanceBadge {...props(async () => balance(), undefined, async () => trimmed)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('今日花费：¥0.3')).toBeDefined()
  })

  it('renders the today-session ranking below today\'s bucket lines, highest first, with the untitled fallback', async () => {
    const getTodaySessionsSpend = async () => ({
      sessions: [
        { sessionId: 'session-a' as SessionId, title: '会话甲', total: 0.31, ownTotal: 0.31 },
        { sessionId: 'session-b' as SessionId, title: null, total: 0.12, ownTotal: 0.12 },
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
      ownTotal: 1 - index / 100,
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
    expect(await panel().findByText('API 剩余金额：¥110.00')).toBeDefined()
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
