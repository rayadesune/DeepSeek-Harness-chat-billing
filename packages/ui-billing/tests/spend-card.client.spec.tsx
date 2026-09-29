// @vitest-environment jsdom
/**
 * The composer spend card: the three-bucket sum that feeds it, the pill it
 * renders in the composer's stat row, and the card it opens. The card is
 * asserted against the same row wording DSH's own token-usage dialog uses,
 * because the two cards are meant to read as one family. The amount itself is
 * asserted as the CONVERSATION's — this session's own spend plus the delegated
 * subagent subtotal, merged exactly as the header badge merges them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SpendCard, type SpendCardProps } from '../src/client/SpendCard.tsx'
import { hasBilledSpend, spendBucketsOf } from '../src/client/spendBuckets.ts'
import { TURN_SETTLE_DEBOUNCE_MS } from '../src/client/useBillingData.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SpendCardProps['t'] = makeTranslate(zh)

/** One priced model row with the three billing buckets set independently. */
function row(over: Partial<DeepSeekTodaySpend['models'][number]> = {}): DeepSeekTodaySpend['models'][number] {
  return {
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    cost: 0.04,
    peakCost: 0.04,
    offPeakCost: 0,
    cacheHitInputTokens: 1_000,
    cacheMissInputTokens: 100_000,
    outputTokens: 20_000,
    cacheHitInputCost: 0.01,
    cacheMissInputCost: 0.02,
    outputCost: 0.01,
    ...over,
  }
}

/** A spend value with the given rows and a total that matches them. */
function spend(rows: DeepSeekTodaySpend['models'], total?: number): DeepSeekTodaySpend {
  return {
    total: total ?? rows.reduce((sum, entry) => sum + entry.cost, 0),
    models: rows,
  }
}

/** The shape the host pushes through `billingTodaySpend` (only what the card reads). */
interface Projection {
  session: DeepSeekTodaySpend
}

/** An empty delegated subtotal: merging it leaves the session's own amount as it is. */
const NO_DELEGATED: DeepSeekDelegatedSpend = { total: 0, models: [], isSubagent: false, crossedDay: false }

/** The two runtime seats a case may want to drive instead of stubbing. */
interface Seats {
  getDelegatedSpend?: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend>
  useSession?: (selector: (snapshot: { running: boolean }) => boolean) => boolean
}

/** Render props: a projection value plus the Remote face and the session seat. */
function props(
  projected: Projection | undefined,
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend> = async () => spend([row()]),
  seats: Seats = {},
): SpendCardProps {
  return {
    sessionId: 'session-1',
    useProjection: () => projected,
    useSession: seats.useSession ?? (selector => selector({ running: false })),
    getSessionSpend,
    getDelegatedSpend: seats.getDelegatedSpend ?? (async () => NO_DELEGATED),
    t,
  } as unknown as SpendCardProps
}

/** The projection value the host pushes for a session priced at `spend()`. */
function projection(value: DeepSeekTodaySpend): Projection {
  return { session: value }
}

describe('spendBucketsOf', () => {
  it('sums each billing bucket across every priced model row', () => {
    const value = spendBucketsOf(spend([
      row(),
      row({
        model: 'mimo-v2.5',
        displayName: 'MiMo-V2.5',
        cost: 0.35,
        cacheHitInputCost: 0.05,
        cacheMissInputCost: 0.2,
        outputCost: 0.1,
      }),
    ]))
    // The one number the host reports that the card cannot derive — the total —
    // is what the three rows are reconciled against.
    expect(value.total).toBeCloseTo(0.39, 10)
    expect(value.uncachedInput).toBeCloseTo(0.22, 10)
    expect(value.cacheRead).toBeCloseTo(0.06, 10)
    expect(value.output).toBeCloseTo(0.11, 10)
  })

  it('counts cache writes as uncached input, so the rows still add up to the total', () => {
    // DeepSeek has no separate cache-write rate: the host bills a write at the
    // miss rate, so the row must carry it rather than hide it.
    const value = spendBucketsOf(spend([row({ cacheMissInputCost: 0.02, cost: 0.04 })]))
    expect(value.uncachedInput).toBeCloseTo(0.02, 10)
    expect(value.uncachedInput + value.cacheRead + value.output).toBeCloseTo(value.total, 10)
  })

  it('absorbs the float residual into the largest bucket so the rows match the header', () => {
    // Each amount renders at four decimals; the row sums must still equal the
    // total the header prints, so the residual lands on the largest bucket.
    const value = spendBucketsOf(spend([row({ cacheMissInputCost: 0.1, cacheHitInputCost: 0.2, outputCost: 0 })], 0.3))
    expect(value.uncachedInput + value.cacheRead + value.output).toBeCloseTo(0.3, 12)
  })

  it('reports no billed spend for an empty session', () => {
    expect(hasBilledSpend(spend([]))).toBe(false)
    expect(hasBilledSpend(spend([row()]))).toBe(true)
  })
})

describe('SpendCard', () => {
  it('renders the pill from the pushed projection without touching the Remote', () => {
    const getSessionSpend = vi.fn(async () => spend([row()]))
    render(<SpendCard {...props(projection(spend([row()])), getSessionSpend)} />)
    expect(screen.getByRole('button', { name: '本轮对话花费：¥0.04' })).toBeDefined()
    expect(getSessionSpend).not.toHaveBeenCalled()
  })

  it('falls back to the Remote when no projection value is served', async () => {
    const getSessionSpend = vi.fn(async () => spend([row()]))
    render(<SpendCard {...props(undefined, getSessionSpend)} />)
    expect(await screen.findByRole('button', { name: '本轮对话花费：¥0.04' })).toBeDefined()
    expect(getSessionSpend).toHaveBeenCalledWith('session-1')
  })

  it('shows no row at all for a session that priced nothing', () => {
    const { container } = render(<SpendCard {...props(projection(spend([])))} />)
    expect(container.innerHTML).toBe('')
  })

  it('adds the delegated subagent subtotal to the pill and the card', async () => {
    // The conversation amount is this session's own spend PLUS the sessions it
    // delegated — the same merge the header badge's second line makes, so the
    // pill and the badge cannot disagree.
    const delegated = spend([row({
      model: 'mimo-v2.5',
      displayName: 'MiMo-V2.5',
      cost: 0.35,
      cacheMissInputCost: 0.3,
      cacheHitInputCost: 0.03,
      outputCost: 0.02,
    })])
    render(<SpendCard {...props(projection(spend([row()])), undefined, { getDelegatedSpend: async () => delegated })} />)
    const pill = await screen.findByRole('button', { name: '本轮对话花费：¥0.39' })
    fireEvent.click(pill)
    const dialog = screen.getByRole('dialog', { name: '花费金额' })
    expect(dialog.textContent).toContain('¥0.39')
    // The bucket rows are the merged ones: own (0.02 / 0.01 / 0.01) plus
    // delegated (0.30 / 0.03 / 0.02), so they still add up to the heading.
    const values = [...dialog.querySelectorAll('dd')].map(node => node.textContent)
    expect(values).toEqual(['¥0.32', '¥0.04', '¥0.03'])
  })

  it('shows the session\'s own amount until the delegated subtotal lands, then updates it', async () => {
    let settle: ((value: DeepSeekDelegatedSpend) => void) | undefined
    const pending = new Promise<DeepSeekDelegatedSpend>((resolve) => { settle = resolve })
    render(<SpendCard {...props(projection(spend([row()])), undefined, { getDelegatedSpend: () => pending })} />)
    // An unsettled subtotal reads as absent, not as zero: the own amount shows.
    expect(screen.getByRole('button', { name: '本轮对话花费：¥0.04' })).toBeDefined()
    await act(async () => { settle!(spend([row({ cost: 0.35, cacheMissInputCost: 0.3, cacheHitInputCost: 0.03, outputCost: 0.02 })])) })
    expect(await screen.findByRole('button', { name: '本轮对话花费：¥0.39' })).toBeDefined()
  })

  it('shows the row when the session priced nothing itself but delegated a priced subagent', async () => {
    // The hidden rule runs on the MERGED amount: testing the session's own rows
    // would hide a conversation whose money was all burned by its subagents.
    render(<SpendCard {...props(projection(spend([])), undefined, { getDelegatedSpend: async () => spend([row()]) })} />)
    expect(await screen.findByRole('button', { name: '本轮对话花费：¥0.04' })).toBeDefined()
  })

  it('renders nothing when the session\'s own spend is unknown, even with a delegated subtotal', async () => {
    // `own === null` is "unknown", not "zero": with no own amount to attach a
    // subtotal to, the entry stays hidden (the badge's own ladder does the same).
    const getSessionSpend = vi.fn(async (): Promise<DeepSeekSessionSpend> => { throw new Error('boom') })
    const { container } = render(
      <SpendCard {...props(undefined, getSessionSpend, { getDelegatedSpend: async () => spend([row()]) })} />,
    )
    await waitFor(() => { expect(getSessionSpend).toHaveBeenCalled() })
    expect(container.innerHTML).toBe('')
  })

  it('forces the delegated subtotal when a turn settles, and re-reads the fallback plainly', async () => {
    vi.useFakeTimers()
    try {
      const getSessionSpend = vi.fn(async () => spend([row()]))
      const getDelegatedSpend = vi.fn(async () => NO_DELEGATED)
      let running = true
      const useSession = (selector: (snapshot: { running: boolean }) => boolean): boolean => selector({ running })
      const seats = { getDelegatedSpend, useSession }
      const view = render(<SpendCard {...props(undefined, getSessionSpend, seats)} />)
      await act(async () => { await Promise.resolve() })
      // The mount read is plain (the host serves what it holds).
      expect(getDelegatedSpend).toHaveBeenCalledTimes(1)
      expect(getDelegatedSpend).toHaveBeenLastCalledWith('session-1')
      // The turn settles: the edge arms the debounce, so nothing reads yet.
      running = false
      view.rerender(<SpendCard {...props(undefined, getSessionSpend, seats)} />)
      expect(getDelegatedSpend).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(TURN_SETTLE_DEBOUNCE_MS) })
      // The settle read FORCES: the turn just priced its own usage, so a cached
      // answer would be the pre-turn figure.
      expect(getDelegatedSpend).toHaveBeenLastCalledWith('session-1', true)
      expect(getDelegatedSpend).toHaveBeenCalledTimes(2)
      // No projection is served here, so the fallback state is the live source
      // and is re-read in the same beat (plainly, as the badge's settle read is).
      expect(getSessionSpend).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the card with the heading, the total, and the three bucket rows', () => {
    render(<SpendCard {...props(projection(spend([row()])))} />)
    fireEvent.click(screen.getByRole('button', { name: '本轮对话花费：¥0.04' }))
    const dialog = screen.getByRole('dialog', { name: '花费金额' })
    expect(dialog).toBeDefined()
    // The heading pairs the section name with the same total the pill shows.
    expect(dialog.textContent).toContain('花费金额')
    expect(dialog.textContent).toContain('¥0.04')
    // Row labels are DSH's own token-card wording, in the token card's order.
    expect(dialog.textContent).toContain('未缓存输入')
    expect(dialog.textContent).toContain('缓存读取')
    expect(dialog.textContent).toContain('输出')
    expect(dialog.textContent).toContain('¥0.02')
    expect(dialog.textContent).toContain('¥0.01')
  })

  it('renders the rows in the token card\'s order, under one heading', () => {
    render(<SpendCard {...props(projection(spend([row()])))} />)
    fireEvent.click(screen.getByRole('button', { name: '本轮对话花费：¥0.04' }))
    const labels = [...screen.getByRole('dialog').querySelectorAll('dt')].map(node => node.textContent)
    expect(labels).toEqual(['未缓存输入', '缓存读取', '输出'])
    const values = [...screen.getByRole('dialog').querySelectorAll('dd')].map(node => node.textContent)
    expect(values).toEqual(['¥0.02', '¥0.01', '¥0.01'])
  })

  it('closes on Escape', async () => {
    render(<SpendCard {...props(projection(spend([row()])))} />)
    fireEvent.click(screen.getByRole('button', { name: '本轮对话花费：¥0.04' }))
    expect(screen.getByRole('dialog', { name: '花费金额' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('keeps the card aria-labelled by its heading in both dictionaries', () => {
    render(<SpendCard {...props(projection(spend([row()])))} />)
    expect(screen.getByRole('button', { name: zh['card.aria'].replace('{amount}', '¥0.04') })).toBeDefined()
  })
})
