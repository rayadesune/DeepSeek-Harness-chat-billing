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

  it('shows the balance and this conversation spend on the trigger', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    // The balance line is the panel headline without its "API" prefix; the spend
    // line is the panel's own label, word for word.
    expect(await screen.findByText('剩余金额：¥110.00')).toBeDefined()
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.queryByText('API 剩余金额：¥110.00')).toBeNull()
    expect(screen.queryByText('剩余额度：¥110.00')).toBeNull()
    expect(screen.queryByText('本轮对话花费：¥0.04')).toBeNull()
  })

  it('labels the trigger spend line exactly as the panel does', () => {
    // One wording, two surfaces: the chip's spend line IS the panel's label, so
    // the dictionaries must not drift apart.
    expect(zh['trigger.balance']).toBe('剩余金额：{amount}')
    expect(en['trigger.balance']).toBe('Balance: {amount}')
    expect(zh['label.amount']).toBe('API 剩余金额：{amount}')
  })

  it('keeps the spend line hidden while the conversation has no priced usage', async () => {
    render(<BalanceBadge {...props(async () => balance(), async () => ({ total: 0, models: [] }))} />)
    expect(await screen.findByText('剩余金额：¥110.00')).toBeDefined()
    expect(screen.queryByText(/^本会话花费：/)).toBeNull()
  })

  it('opens the label box with the amount, today\'s tokens and spend, this session\'s spend, and the breakdown', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(panel().getByText('API 剩余金额：¥110.00')).toBeDefined()
    // 2,000 cache-hit + 200,000 cache-miss + 30,000 output tokens = 232,000.
    expect(panel().getByText('今日 Token：232K tok')).toBeDefined()
    expect(panel().getByText('今日花费：¥0.31')).toBeDefined()
    expect(panel().getByText('本会话花费：¥0.04')).toBeDefined()
    // One priced model only: the whole model row is gone — the name says nothing
    // new in a session that only ever billed one model, and the amount is the
    // 本会话花费 figure above — leaving just its bucket line with the split.
    expect(panel().queryByText('DeepSeek-V4-Flash')).toBeNull()
    expect(panel().queryByText('¥0.04')).toBeNull()
    expect(panel().getByText('未缓存输入 ¥0.02 · 缓存读取 ¥0.01 · 输出 ¥0.01')).toBeDefined()
    expect(panel().getByText('未缓存输入 ¥0.02 · 缓存读取 ¥0.01 · 输出 ¥0.01')).toBeDefined()
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
    // The session line and the per-model breakdown round the same way; these
    // fixtures happen to sit below four decimals already.
    expect(panel().getByText('本会话花费：¥0.04')).toBeDefined()
    expect(panel().getByText('未缓存输入 ¥0.02 · 缓存读取 ¥0.01 · 输出 ¥0.01')).toBeDefined()
  })

  it('rounds the session line, the model rows, and the ranking to three significant digits', async () => {
    // The reported panel: one model at ¥13.8221 whose buckets are ¥0.6036 +
    // ¥10.4422 + ¥2.7763, with today's ranking row at ¥13.8911. All of them are
    // spends, so all of them render short — the same resolution as the day row.
    const spend: DeepSeekSessionSpend = {
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
      {...props(async () => balance(), async () => spend, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    // The trigger's own spend line rounds too.
    expect(await screen.findByText('本会话花费：¥13.8')).toBeDefined()
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('本会话花费：¥13.8')).toBeDefined()
    // One model only: no model row at all, so nothing left to name or round there
    // — its bucket line carries the same three significant digits.
    expect(panel().queryByText('DeepSeek-V41-Flash')).toBeNull()
    expect(panel().queryByText('¥13.8')).toBeNull()
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
    // alignment), in the per-model cost row's typography on the tighter
    // ranking-row rhythm.
    const tokenLine = await panel().findByText('未缓存输入 200K tok · 缓存读取 2K tok · 输出 30K tok')
    const costLine = panel().getByText('未缓存输入 ¥0.2 · 缓存读取 ¥0.01 · 输出 ¥0.1')
    expect(tokenLine.parentElement?.classList.contains(css.dayBucketRow)).toBe(true)
    expect(costLine.parentElement?.classList.contains(css.dayBucketRow)).toBe(true)
    expect(tokenLine.parentElement?.classList.contains(css.costRow)).toBe(false)
    expect(tokenLine.parentElement?.querySelector(`.${css.costBreakdown}`)).not.toBeNull()
    // Token line first, then the cost line: directly under the day row they
    // explain, and above the session row.
    const dayRow = panel().getByText('今日 Token：232K tok')
    const sessionRow = panel().getByText('本会话花费：¥0.04')
    expect(dayRow.parentElement?.nextElementSibling?.textContent).toBe(tokenLine.textContent)
    expect(tokenLine.parentElement?.nextElementSibling?.textContent).toBe(costLine.textContent)
    expect(dayRow.compareDocumentPosition(sessionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('puts this session\'s spend on its own line, under today\'s tokens and spend', async () => {
    render(<BalanceBadge {...props(async () => balance())} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    const tokens = await panel().findByText('今日 Token：232K tok')
    const todaySpend = panel().getByText('今日花费：¥0.31')
    const sessionSpend = panel().getByText('本会话花费：¥0.04')
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
    // figures (bucket lines, a whole ranking row, the three riders), L2 the section
    // and list titles (model name with its row amount, 今日会话花费), L3 the rows
    // that name a figure (今日 Token, 今日花费, 本会话花费). Every member references
    // its level's tokens, so retuning a level cannot leave one row behind.
    const cssText = readFileSync(join(process.cwd(), 'packages/ui-billing/src/client/BalanceBadge.module.css'), 'utf8')
    const levelOf = (selector: string): string => {
      const start = cssText.indexOf(`\n${selector}`)
      if (start < 0) return 'missing'
      const body = cssText.slice(cssText.indexOf('{', start), cssText.indexOf('}', start))
      return /--billing-type-(\d)-/.exec(body)?.[1] ?? 'none'
    }
    for (const [level, selectors] of Object.entries({
      1: ['.costBreakdown', '.rankingIndex', '.rankingDot', '.rankingName', '.rankingAmount', '.rankingMore', '.sessionToday', '.todayHit', '.amountToday'],
      2: ['.modelName', '.tasks', '.rankingTitle'],
      3: ['.amountLabel'],
    })) {
      for (const selector of selectors) expect(`${selector} -> ${levelOf(selector)}`).toBe(`${selector} -> ${level}`)
    }
    for (const declaration of [
      '--billing-type-1-size: 11px', '--billing-type-1-line: 16px', '--billing-type-1-tone: var(--dsw-alias-label-tertiary)',
      '--billing-type-2-size: 12px', '--billing-type-2-line: 18px', '--billing-type-2-tone: var(--dsw-alias-label-secondary)',
      '--billing-type-2-number-tone: var(--dsw-alias-label-tertiary)',
      '--billing-type-3-size: 13px', '--billing-type-3-line: 18px', '--billing-type-3-tone: var(--dsw-alias-label-primary)',
    ]) expect(cssText).toContain(declaration)
    // A level's text and its numbers may differ in tone: a level-two amount takes
    // the level's own number tone (one step below the label's), so the model row
    // reads name-first and any future level-two amount follows the same tone.
    const tasks = cssText.slice(cssText.indexOf('\n.tasks'), cssText.indexOf('}', cssText.indexOf('\n.tasks')))
    expect(tasks).toContain('--billing-type-2-size')
    expect(tasks).toContain('--billing-type-2-number-tone')
    // The riders carry no parentheses: the level-one tone plus the locale string's
    // own leading space are what set them apart from the figure beside them.
    expect(zh['label.sessionSpend.today']).toBe(' {amount}')
    expect(en['label.sessionSpend.today']).toBe(' {amount}')
    expect(zh['label.todayTokens.hit']).toBe(' {percent}%')
    expect(en['label.todayTokens.hit']).toBe(' {percent}%')
    expect(zh['label.amount.todaySpend']).toBe(' {amount}')
    expect(en['label.amount.todaySpend']).toBe(' {amount}')
  })

  it('shows this session\'s share of today in parentheses once the session crossed a day', async () => {
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [
        { sessionId: 'session-other' as SessionId, title: '会话乙', total: 0.29, ownTotal: 0.29 },
        { sessionId: 'session-1' as SessionId, title: '会话甲', total: 0.02, ownTotal: 0.02 },
      ],
    })
    const getDelegatedSpend = async (): Promise<DeepSeekDelegatedSpend> => ({ ...NO_DELEGATION, crossedDay: true })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend, () => null, () => undefined, getDelegatedSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The session started on an earlier Beijing day, so its today share is worth
    // showing — matched by session id, so neither the highest row (¥0.29) nor the
    // total (¥0.31) leaks into it.
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
    const share = await waitFor(() => {
      const rider = document.querySelector(`.${css.sessionToday}`)
      expect(rider?.textContent?.trim()).toBe('¥0.02')
      return rider
    })
    // Level one, no parentheses: the tone and the leading space are the only
    // things separating the rider from the amount beside it.
    expect(share?.textContent).not.toContain('（')
    expect(screen.getByText('今日花费：¥0.31')).toBeDefined()
  })

  it('hides the share for a session that started today', async () => {
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [{ sessionId: 'session-1' as SessionId, title: '会话甲', total: SPEND.total, ownTotal: SPEND.total }],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
    // A conversation that started today billed everything it ever billed today,
    // so a parenthesized share would only repeat the amount beside it.
    expect(document.querySelector(`.${css.sessionToday}`)).toBeNull()
  })

  it('hides the share when a live amount and the cached ranking row merely differ', async () => {
    // The reported case: the session line carries the live, mid-turn figure
    // (¥10.5288, rendered ¥10.5) while the 60-second-cached ranking row still
    // holds ¥10.4929. Comparing the two amounts used to flash a parenthesis for a
    // conversation that started today; the creation day is the only thing that
    // decides now.
    const spend: DeepSeekSessionSpend = { ...SPEND, total: 10.5288 }
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      sessions: [{ sessionId: 'session-1' as SessionId, title: '会话甲', total: 10.4929, ownTotal: 10.4929 }],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => spend, async () => TODAY_SPEND, () => false, getTodaySessionsSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('本会话花费：¥10.5')).toBeDefined()
    expect(panel().getByText('今日花费：¥0.31')).toBeDefined()
    expect(document.querySelector(`.${css.sessionToday}`)).toBeNull()
  })

  it('adds the delegated subagents to the amount and compares merged with merged', async () => {
    const getDelegatedSpend = async (): Promise<DeepSeekDelegatedSpend> => ({
      total: 0.5,
      models: [{ ...SPEND.models[0]!, model: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro', cost: 0.5 }],
      isSubagent: false,
      crossedDay: false,
    })
    const getTodaySessionsSpend = async (): Promise<DeepSeekTodaySessionsSpend> => ({
      // The host merged the same subagents into today's row.
      sessions: [{ sessionId: 'session-1' as SessionId, title: '会话甲', total: 0.54, ownTotal: SPEND.total }],
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend, () => null, () => undefined, getDelegatedSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The conversation: this session's ¥0.04 plus its subagents' ¥0.50 — the
    // trigger's line repeats it (both carry the panel's own label).
    expect(await panel().findByText('本会话花费：¥0.54')).toBeDefined()
    expect(screen.getAllByText('本会话花费：¥0.54')).toHaveLength(2)
    // The session started today, so no share is owed.
    expect(document.querySelector(`.${css.sessionToday}`)).toBeNull()
    // The delegated model arrives as its own breakdown row.
    expect(await panel().findByText('DeepSeek-V4-Pro')).toBeDefined()
    // Two priced models: each row carries its own amount — the only case a model
    // row shows one, since a lone model's amount would repeat 本会话花费 above.
    expect(document.querySelectorAll(`.${css.tasks}`)).toHaveLength(2)
    expect(panel().getByText('¥0.5')).toBeDefined()
  })

  it('hides the share for a session that is itself a delegated subagent', async () => {
    const getDelegatedSpend = async (): Promise<DeepSeekDelegatedSpend> => ({
      total: 0,
      models: [],
      isSubagent: true,
      // Even an old child session shows no share: its spend rides its
      // delegator's row, so there is no row of its own to read.
      crossedDay: true,
    })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, undefined, () => null, () => undefined, getDelegatedSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
    expect(document.querySelector(`.${css.sessionToday}`)).toBeNull()
  })

  it('renders no share while the ranking is unsettled, then the confirmed zero', async () => {
    let resolveSessions!: (value: DeepSeekTodaySessionsSpend) => void
    const getTodaySessionsSpend = vi.fn(
      () => new Promise<DeepSeekTodaySessionsSpend>(resolve => { resolveSessions = resolve }),
    )
    const getDelegatedSpend = async (): Promise<DeepSeekDelegatedSpend> => ({ ...NO_DELEGATION, crossedDay: true })
    render(<BalanceBadge
      {...props(async () => balance(), async () => SPEND, async () => TODAY_SPEND, () => false, getTodaySessionsSpend, () => null, () => undefined, getDelegatedSpend)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
    // An unsettled ranking renders no share (and no placeholder either, since the
    // share itself is what is conditional).
    expect(document.querySelector(`.${css.sessionToday}`)).toBeNull()
    // Settled without a row for this session: the day-crossing session billed
    // nothing today, which is a confirmed ¥0.
    await act(async () => {
      resolveSessions({ sessions: [{ sessionId: 'session-other' as SessionId, title: null, total: 0.29, ownTotal: 0.29 }] })
    })
    await waitFor(() => { expect(document.querySelector(`.${css.sessionToday}`)?.textContent?.trim()).toBe('¥0') })
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
    // The budget covers the five lines — the estimate, the amount rider with the
    // caliber behind it, the line naming what the session amounts include, the
    // line naming the session rider, and the trailing `{version}` (≈7 rendered
    // lines at the bubble's 300px cap).
    expect(zh['info.hint'].length).toBeLessThanOrEqual(176)
    expect(en['info.hint'].length).toBeLessThanOrEqual(450)
  })

  it('names the amount rider, the delegated subagents, and the session rider in the hint', () => {
    // The hint explains what the figure after the API balance measures (today's
    // consumption from the balance series itself, with the caliber that produces
    // it), what the session amounts cover (this session plus the subagent
    // sessions it delegated), and what the figure after 本会话花费 is. Each is its
    // own line, in panel order, and the version stays the last one.
    const lines = zh['info.hint'].split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('估算')
    expect(lines[1]).toBe('API 剩余金额后的数字为今日消费：今日首次查询余额 − 当前余额 + 今日充值（充值按 10 元步进识别）。')
    expect(lines[2]).toBe('金额含本会话委派的子代理会话。')
    expect(lines[3]).toBe('本会话花费后的数字为本会话今日花费。')
    expect(lines[4]).toBe('v{version}')
    const enLines = en['info.hint'].split('\n')
    expect(enLines).toHaveLength(5)
    expect(enLines[1]).toBe('The figure after the API balance is today\'s consumption: the day\'s first queried balance minus the current one, plus today\'s top-ups (identified in ¥10 steps).')
    expect(enLines[2]).toBe('The amounts include the subagent sessions this session delegated.')
    expect(enLines[3]).toBe('The figure after this session\'s amount is its spend today.')
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
    expect(await screen.findByText('本会话花费：¥0.04')).toBeDefined()
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
    expect(panel().getByText('本会话花费：¥0.04')).toBeDefined()
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
    expect(screen.getByText('本会话花费：¥0.04')).toBeDefined()
  })

  it('prefixes USD with the dollar sign', async () => {
    const usd = balance({ lines: [{ currency: 'USD', total: '5.00', granted: '0.00', toppedUp: '5.00' }] })
    render(<BalanceBadge {...props(async () => usd)} />)
    await waitFor(() => { expect(screen.getByText('剩余金额：$5.00')).toBeDefined() })
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
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
    expect(screen.getByText('今日 Token：—')).toBeDefined()
    expect(screen.getByText('今日花费：—')).toBeDefined()
  })

  it('shows the session spend as soon as it settles, without waiting for today\'s spend', async () => {
    const getTodaySpend = vi.fn(() => new Promise<DeepSeekTodaySpend>(() => {}))
    render(<BalanceBadge {...props(async () => balance(), async () => SPEND, getTodaySpend)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek 额度：¥110.00' }))
    // The session spend landed; today's spend never settles, so its line
    // keeps the placeholder instead of blanking the other line.
    expect(await panel().findByText('本会话花费：¥0.04')).toBeDefined()
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
    expect(await panel().findByText('本会话花费：¥0.3')).toBeDefined()
  })

  it('renders the today-session ranking below the model rows, highest first, with the untitled fallback', async () => {
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
