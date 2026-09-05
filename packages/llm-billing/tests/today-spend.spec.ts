/**
 * Today-spend read path: the 60s Beijing-day cache (TTL, cross-day
 * invalidation, force bypass, in-flight coalescing, no caching of failures)
 * and the revision-gated scanner on both strategies — the events path (day
 * filter, cap, unchanged-revision skip) and the projection path (eager cells
 * for live sessions, cache ladder / detached fold for cold sessions).
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { describe, expect, it, vi } from 'vitest'
import { computeTodaySpend, resolveBilling } from '../src/billing.ts'
import { billingTodaySpendDefinition, BILLING_UNIT_KEY, type BillingUnitState } from '../src/projection.ts'
import { TodaySpendCache, TodaySpendScanner, type TodaySpendScannerDeps } from '../src/today-spend.ts'

const FLASH = 'deepseek-v4-flash'
const CATALOG = [{ id: FLASH, name: 'DeepSeek-V4-Flash' }]
const BILLING = resolveBilling(undefined)
const UNIT = billingTodaySpendDefinition(BILLING, CATALOG)

// 2026-08-20 02:00Z is 10:00 Beijing on 2026-08-20 (weekday, peak hour).
const DAY_KEY = '2026-08-20'
const DAY_TIME = Date.parse('2026-08-20T02:00:00Z')
const OTHER_DAY = Date.parse('2026-08-19T12:00:00Z')

function pricedEvent(time: number, seq = 0): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 0,
      step: seq,
      message: {
        id: `m${seq}` as never,
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'deepseek-official', model: FLASH },
      },
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 500_000 } satisfies TokenUsage,
    },
  } as unknown as SessionEvent
}

function deps(over: Partial<TodaySpendScannerDeps> = {}): TodaySpendScannerDeps {
  return {
    sessions: () => undefined,
    persistence: () => undefined,
    projections: () => undefined,
    projectionCache: () => undefined,
    unit: UNIT,
    maxEvents: 100,
    logger: { warn: () => {} },
    billing: BILLING,
    catalog: CATALOG,
    ...over,
  }
}

describe('TodaySpendCache', () => {
  it('serves the cached value within the TTL window and recomputes after it elapses', async () => {
    let now = Date.parse('2026-08-20T04:00:00Z')
    let scans = 0
    const cache = new TodaySpendCache(async () => {
      scans += 1
      return { total: scans, models: [] }
    }, 60_000, () => new Date(now))

    await expect(cache.get()).resolves.toEqual({ total: 1, models: [] })
    await expect(cache.get()).resolves.toEqual({ total: 1, models: [] })
    expect(scans).toBe(1)

    now += 61_000
    await expect(cache.get()).resolves.toEqual({ total: 2, models: [] })
    expect(scans).toBe(2)
  })

  it('invalidates automatically when the Beijing day changes', async () => {
    let now = Date.parse('2026-08-20T04:00:00Z')
    let scans = 0
    const cache = new TodaySpendCache(async () => {
      scans += 1
      return { total: scans, models: [] }
    }, 60_000, () => new Date(now))

    await cache.get()
    // 2026-08-20 16:30Z is already 2026-08-21 in Beijing, inside the TTL window.
    now = Date.parse('2026-08-20T16:30:00Z')
    await cache.get()
    expect(scans).toBe(2)
  })

  it('force bypasses the time window; the day key still gates', async () => {
    const now = Date.parse('2026-08-20T04:00:00Z')
    let scans = 0
    const cache = new TodaySpendCache(async () => {
      scans += 1
      return { total: scans, models: [] }
    }, 60_000, () => new Date(now))

    await cache.get()
    await cache.get(true)
    await cache.get(true)
    expect(scans).toBe(3)
  })

  it('coalesces concurrent misses into one scan', async () => {
    let scans = 0
    const cache = new TodaySpendCache(async () => {
      scans += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return { total: scans, models: [] }
    })
    const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(scans).toBe(1)
    expect(a).toEqual(b)
    expect(c).toEqual(a)
  })

  it('does not cache a failed scan', async () => {
    let scans = 0
    const cache = new TodaySpendCache(async () => {
      scans += 1
      if (scans === 1) throw new Error('boom')
      return { total: scans, models: [] }
    })
    await expect(cache.get()).rejects.toThrow('boom')
    await expect(cache.get()).resolves.toEqual({ total: 2, models: [] })
    expect(scans).toBe(2)
  })
})

describe('TodaySpendScanner events path', () => {
  it('collects only today\'s events across live and persisted sessions', async () => {
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME, 0), pricedEvent(OTHER_DAY, 1)] }))
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'live' as SessionId, events: [pricedEvent(DAY_TIME, 2)] }] }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
          { header: { id: 'live' as SessionId }, revision: SessionPersistenceRevision('r-live') },
        ],
        inspect,
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models).toHaveLength(1)
    // Live event + the persisted today event; the persisted other-day event is ignored.
    expect(spend.models[0]?.cacheHitInputTokens).toBe(2_000_000)
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledWith('cold-a')
  })

  it('skips persisted sessions whose revision is unchanged since the last scan', async () => {
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
    }))
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('re-inspects a persisted session whose revision changed', async () => {
    let revision = SessionPersistenceRevision('r-a')
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-a' as SessionId }, revision }],
        inspect,
      }),
    }))
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
    revision = SessionPersistenceRevision('r-b')
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('truncates at the event cap and does not advance the revision watermark', async () => {
    const warn = vi.fn()
    const inspect = vi.fn(async () => ({
      meta: {},
      events: Array.from({ length: 5 }, (_, index) => pricedEvent(DAY_TIME, index)),
    }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
      maxEvents: 3,
      logger: { warn },
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(3_000_000)
    expect(warn).toHaveBeenCalled()
    // The truncated pass must not record the revision: the next scan re-reads.
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('skips a session that fails to inspect instead of failing the day', async () => {
    const warn = vi.fn()
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-ok' as SessionId }, revision: SessionPersistenceRevision('r-ok') },
          { header: { id: 'cold-bad' as SessionId }, revision: SessionPersistenceRevision('r-bad') },
        ],
        inspect: async (id: SessionId) => {
          if (id === 'cold-bad' as SessionId) throw new Error('corrupt log')
          return { meta: {}, events: [pricedEvent(DAY_TIME)] }
        },
      }),
      logger: { warn },
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
  })

  it('prices the same spend as computeTodaySpend on the same log (single-pass parity)', async () => {
    const events = [pricedEvent(DAY_TIME, 0), pricedEvent(OTHER_DAY, 1), pricedEvent(DAY_TIME, 2)]
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => ({ meta: {}, events }),
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    const reference = computeTodaySpend(events, BILLING, CATALOG, new Date(`${DAY_KEY}T00:00:00Z`))
    expect(spend).toEqual(reference)
  })

  it('skips a live fork child\'s inherited prefix and prices its own events once', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)] },
          {
            id: 'child' as SessionId,
            events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
            header: { seedLength: 2 },
          },
        ],
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // The parent's two events plus the child's own one — the two copied
    // events are skipped instead of billed a second time.
    expect(spend.models[0]?.cacheHitInputTokens).toBe(3_000_000)
  })

  it('skips a cold fork child\'s inherited prefix (snapshot header seedLength)', async () => {
    const inspect = vi.fn(async () => ({
      meta: { seedLength: 2 },
      events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
    }))
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'parent' as SessionId, events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)] }] }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'child' as SessionId, seedLength: 2 }, revision: SessionPersistenceRevision('r-child') },
        ],
        inspect,
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(3_000_000)
  })

  it('rejects a 0.1.2-alpha.4+ live session without snapshotEvents instead of silently skipping it', async () => {
    // The newer Session exposes no `events` anymore; without the snapshot
    // reader the scanner must fail loudly rather than report zero spend.
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'new-shape' as SessionId }] }),
    }))
    await expect(scanner.scan(DAY_KEY)).rejects.toThrow(/snapshotEvents/)
  })

  it('reads a 0.1.2-alpha.4+ live session through snapshotEvents', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [{
          id: 'live' as SessionId,
          snapshotEvents: () => [pricedEvent(DAY_TIME, 0), pricedEvent(OTHER_DAY, 1)],
          inheritedEventCount: 0,
          header: { isSeeded: false },
        }],
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(1_000_000)
  })

  it('skips a 0.1.2-alpha.4+ live fork child\'s inherited prefix (inheritedEventCount)', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, snapshotEvents: () => [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)], inheritedEventCount: 0 },
          {
            id: 'child' as SessionId,
            snapshotEvents: () => [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
            inheritedEventCount: 2,
            header: { isSeeded: true },
          },
        ],
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(3_000_000)
  })

  it('skips a 0.1.2-alpha.4+ cold fork child via inspect.inheritedEventCount (isSeeded snapshot, ladder skipped)', async () => {
    const coldSnapshot = vi.fn(async () => ({ values: {} }))
    const inspect = vi.fn(async () => ({
      meta: { isSeeded: true },
      inheritedEventCount: 2,
      events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
    }))
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'parent' as SessionId, events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)] }] }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'child' as SessionId, isSeeded: true }, revision: SessionPersistenceRevision('r-child') },
        ],
        inspect,
      }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // 0.1.2-alpha.4 snapshots no longer carry the cut; the seeded flag must
    // still bypass the ladder (its row covers inherited events) and the
    // detached fold must use the inspect result's inherited count.
    expect(coldSnapshot).not.toHaveBeenCalled()
    expect(spend.models[0]?.cacheHitInputTokens).toBe(3_000_000)
  })

  it('resolves many pending cold sessions with bounded concurrency', async () => {
    const ids = Array.from({ length: 40 }, (_, index) => `cold-${index}` as SessionId)
    let inFlight = 0
    let peak = 0
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => ids.map(id => ({ header: { id }, revision: SessionPersistenceRevision(`r-${id}`) })),
        inspect: async () => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise(resolve => setTimeout(resolve, 1))
          inFlight -= 1
          return { meta: {}, events: [pricedEvent(DAY_TIME)] }
        },
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(peak).toBeLessThanOrEqual(8)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(40_000_000)
  })
})

describe('TodaySpendScanner projection path', () => {
  const coldState: BillingUnitState = {
    dayKey: DAY_KEY,
    spend: { total: 1, models: [{ model: FLASH, displayName: 'DeepSeek-V4-Flash', cost: 1, peakCost: 0, offPeakCost: 1, cacheHitInputTokens: 0, cacheMissInputTokens: 100000, outputTokens: 20000, cacheHitInputCost: 0, cacheMissInputCost: 1, outputCost: 0 }] },
  }
  const liveState: BillingUnitState = {
    dayKey: DAY_KEY,
    spend: { total: 2, models: [{ model: FLASH, displayName: 'DeepSeek-V4-Flash', cost: 2, peakCost: 2, offPeakCost: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 200000, outputTokens: 20000, cacheHitInputCost: 0, cacheMissInputCost: 2, outputCost: 0 }] },
  }

  it('reads live sessions from eager cells and cold sessions through the cache ladder', async () => {
    const coldSnapshot = vi.fn(async () => ({ values: { [BILLING_UNIT_KEY]: coldState } }))
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'live' as SessionId, events: [] }] }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
          { header: { id: 'live' as SessionId }, revision: SessionPersistenceRevision('r-live') },
        ],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'live' ? liveState : undefined,
      }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeCloseTo(3, 10)
    expect(coldSnapshot).toHaveBeenCalledTimes(1)
    expect(coldSnapshot).toHaveBeenCalledWith('cold-a')
  })

  it('reuses resolved cold values for unchanged revisions', async () => {
    const coldSnapshot = vi.fn(async () => ({ values: { [BILLING_UNIT_KEY]: coldState } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    await scanner.scan(DAY_KEY)
    await scanner.scan(DAY_KEY)
    expect(coldSnapshot).toHaveBeenCalledTimes(1)
  })

  it('re-resolves a cold session whose revision changed', async () => {
    let revision = SessionPersistenceRevision('r-a')
    const coldSnapshot = vi.fn(async () => ({ values: { [BILLING_UNIT_KEY]: coldState } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-a' as SessionId }, revision }],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    await scanner.scan(DAY_KEY)
    expect(coldSnapshot).toHaveBeenCalledTimes(1)
    revision = SessionPersistenceRevision('r-b')
    await scanner.scan(DAY_KEY)
    expect(coldSnapshot).toHaveBeenCalledTimes(2)
  })

  it('folds locally from inspect when the projection cache is absent', async () => {
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME, 0)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => undefined,
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeGreaterThan(0)
    expect(inspect).toHaveBeenCalledTimes(1)
    // The revision gate holds: the second scan skips the cold session.
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('bypasses the eager cell for a live fork child and prices its own events', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)] },
          {
            id: 'child' as SessionId,
            events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
            header: { seedLength: 2 },
          },
        ],
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'child'
          // The child's eager cell would cover its inherited prefix too.
          ? { dayKey: DAY_KEY, spend: { total: 999, models: [] } }
          : { dayKey: DAY_KEY, spend: { total: 27.20, models: [] } },
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // Parent's cell (two events) plus the child's own event, not the junk cell.
    expect(spend.total).toBeCloseTo(27.20 + 13.60, 10)
  })

  it('resolves a cold fork child through inspect, skipping the projection cache', async () => {
    const coldSnapshot = vi.fn(async () => ({
      values: { [BILLING_UNIT_KEY]: { dayKey: DAY_KEY, spend: { total: 555, models: [] } } },
    }))
    const inspect = vi.fn(async () => ({
      meta: { seedLength: 2 },
      events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
    }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'child' as SessionId, seedLength: 2 }, revision: SessionPersistenceRevision('r-child') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // The seeded session never rides the cached row: it folds its own events.
    expect(coldSnapshot).not.toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(spend.total).toBeCloseTo(13.60, 10)
  })

  it('falls back to the local fold when the cache ladder read fails', async () => {
    const coldSnapshot = vi.fn(async () => { throw new Error('cache row poisoned') })
    const warn = vi.fn()
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME, 0)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ coldSnapshot }),
      logger: { warn },
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})

/** One `session/title` log event (structural; the npm SessionEvent union predates it). */
function titleEvent(title: string, seq = 0, time = 0): SessionEvent {
  return {
    type: 'session/title',
    seq,
    time,
    data: { title, source: { kind: 'user' }, messageSeqs: [] },
  } as unknown as SessionEvent
}

describe('TodaySpendScanner scanSessions (events path)', () => {
  it('aggregates today\'s spend per session, folds titles, sorts descending, and omits zero rows', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          // A title event from another day still titles the row; only today's
          // spend counts.
          { id: 'live-a' as SessionId, events: [titleEvent('会话甲', 0, OTHER_DAY), pricedEvent(DAY_TIME, 1), pricedEvent(OTHER_DAY, 2)] },
          { id: 'live-b' as SessionId, events: [pricedEvent(DAY_TIME, 3)] },
          { id: 'live-zero' as SessionId, events: [pricedEvent(OTHER_DAY, 4)] },
        ],
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionId).toBe('live-a')
    expect(sessions[0]?.title).toBe('会话甲')
    expect(sessions[0]?.total).toBeCloseTo(13.60, 10)
    expect(sessions[1]?.sessionId).toBe('live-b')
    expect(sessions[1]?.title).toBeNull()
    expect(sessions[1]?.total).toBeCloseTo(13.60, 10)
  })

  it('counts only today\'s spend for a session spanning days', async () => {
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => ({ meta: {}, events: [pricedEvent(OTHER_DAY, 0), pricedEvent(DAY_TIME, 1), pricedEvent(OTHER_DAY, 2)] }),
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('cold-a')
    expect(sessions[0]?.total).toBeCloseTo(13.60, 10)
  })

  it('reports a fork child row from its own spend only', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [titleEvent('父会话', 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)] },
          {
            id: 'child' as SessionId,
            events: [titleEvent('父会话', 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2), pricedEvent(DAY_TIME, 3)],
            header: { seedLength: 3 },
          },
        ],
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions.find(row => row.sessionId === 'parent')?.total).toBeCloseTo(27.20, 10)
    expect(sessions.find(row => row.sessionId === 'child')?.total).toBeCloseTo(13.60, 10)
  })

  it('reflects a renamed title once the log changes (revision gate)', async () => {
    let events = [titleEvent('旧名'), pricedEvent(DAY_TIME, 1)]
    let revision = SessionPersistenceRevision('r-a')
    const inspect = vi.fn(async () => ({ meta: {}, events }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-a' as SessionId }, revision }],
        inspect,
      }),
    }))
    const first = await scanner.scanSessions(DAY_KEY)
    expect(first.sessions[0]?.title).toBe('旧名')
    // The rename commits a later session/title event and bumps the revision.
    events = [titleEvent('旧名', 0, OTHER_DAY), pricedEvent(DAY_TIME, 1), titleEvent('新名字', 2, DAY_TIME)]
    revision = SessionPersistenceRevision('r-b')
    const second = await scanner.scanSessions(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(second.sessions[0]?.title).toBe('新名字')
    expect(second.sessions[0]?.total).toBeCloseTo(13.60, 10)
  })
})

describe('TodaySpendScanner scanSessions (projection path)', () => {
  const liveState: BillingUnitState = {
    dayKey: DAY_KEY,
    spend: { total: 0.5, models: [] },
  }
  const coldState: BillingUnitState = {
    dayKey: DAY_KEY,
    spend: { total: 13.60, models: [] },
  }

  it('uses eager cells for live sessions and resolved cold rows, with titles folded from each log', async () => {
    // The cache ladder misses (empty values), so the cold session resolves
    // through inspect, which folds its title alongside the billing unit.
    const coldSnapshot = vi.fn(async () => ({ values: {} }))
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'live-a' as SessionId, events: [titleEvent('直播会话')] },
          { id: 'live-b' as SessionId, events: [] },
        ],
      }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => ({ meta: {}, events: [titleEvent('冷会话'), pricedEvent(DAY_TIME, 1)] }),
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'live-a' ? liveState : undefined,
      }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    // Sorted descending: cold-a 13.60 first, live-a 0.5 second; live-b has no cell.
    expect(sessions.map(row => row.sessionId)).toEqual(['cold-a', 'live-a'])
    expect(sessions[0]?.title).toBe('冷会话')
    expect(sessions[1]?.title).toBe('直播会话')
  })

  it('reports a fork child row from its own-events fold on the projection path', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)] },
          {
            id: 'child' as SessionId,
            events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
            header: { seedLength: 2 },
          },
        ],
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'child'
          // The child's eager cell would cover its inherited prefix too.
          ? { dayKey: DAY_KEY, spend: { total: 999, models: [] } }
          : { dayKey: DAY_KEY, spend: { total: 27.20, models: [] } },
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions.find(row => row.sessionId === 'parent')?.total).toBeCloseTo(27.20, 10)
    expect(sessions.find(row => row.sessionId === 'child')?.total).toBeCloseTo(13.60, 10)
  })

  it('reports a null title for cold sessions served from the projection cache', async () => {
    const coldSnapshot = vi.fn(async () => ({ values: { [BILLING_UNIT_KEY]: coldState } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ coldSnapshot }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('cold-a')
    expect(sessions[0]?.title).toBeNull()
    expect(sessions[0]?.total).toBeCloseTo(13.60, 10)
  })
})

describe('TodaySpendScanner persistence handle family (0.1.2-alpha.5+)', () => {
  /** One handle-family persistence mock: list + open returning a scripted read handle. */
  function handlePersistence(events: readonly SessionEvent[], over: {
    inheritedEventCount?: number
    isSeeded?: boolean
  } = {}) {
    const reads: { id: SessionId }[] = []
    const closed: { id: SessionId }[] = []
    const read = vi.fn(async () => events)
    const service = {
      list: vi.fn(async () => [{
        header: { id: 'cold-a' as SessionId, isSeeded: over.isSeeded ?? false },
        revision: SessionPersistenceRevision('r-a'),
      }]),
      open: vi.fn(async (id: SessionId, _access: 'read') => {
        reads.push({ id })
        return {
          header: { id, isSeeded: over.isSeeded ?? false },
          inheritedEventCount: over.inheritedEventCount ?? 0,
          read,
          close: async () => { closed.push({ id }) },
        }
      }),
    }
    return { service, reads, closed, read }
  }

  it('reads and closes the handle for one cold session on the events path', async () => {
    const { service, reads, closed, read } = handlePersistence([
      pricedEvent(DAY_TIME, 0),
      pricedEvent(OTHER_DAY, 1),
    ])
    const scanner = new TodaySpendScanner(deps({
      persistence: () => service,
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(1_000_000)
    expect(service.list).toHaveBeenCalledTimes(1)
    expect(service.open).toHaveBeenCalledWith('cold-a', 'read')
    expect(read).toHaveBeenCalledTimes(1)
    expect(reads).toHaveLength(1)
    expect(closed).toHaveLength(1)
  })

  it('prices only a handle-family fork child\'s own events (inheritedEventCount boundary)', async () => {
    // The handle carries the exact inherited cut; the child's log opens with
    // two inherited events that the source session already billed.
    const { service } = handlePersistence(
      [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1), pricedEvent(DAY_TIME, 2)],
      { isSeeded: true, inheritedEventCount: 2 },
    )
    const scanner = new TodaySpendScanner(deps({
      persistence: () => service,
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.models).toHaveLength(1)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(1_000_000)
  })

  it('closes the handle even when the read rejects, and skips the broken session', async () => {
    const warn = vi.fn()
    const closed: { id: SessionId }[] = []
    const service = {
      list: vi.fn(async () => [
        { header: { id: 'cold-bad' as SessionId }, revision: SessionPersistenceRevision('r-bad') },
      ]),
      open: vi.fn(async (id: SessionId) => ({
        header: { id },
        inheritedEventCount: 0,
        read: vi.fn(async () => { throw new Error('corrupt log') }),
        close: async () => { closed.push({ id }) },
      })),
    }
    const scanner = new TodaySpendScanner(deps({
      persistence: () => service,
      logger: { warn },
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBe(0)
    expect(warn).toHaveBeenCalled()
    expect(closed).toHaveLength(1)
  })

  it('resolves a cold session through the handle ladder on the projection path', async () => {
    const { service, closed, read } = handlePersistence([pricedEvent(DAY_TIME, 0)])
    const scanner = new TodaySpendScanner(deps({
      persistence: () => service,
      projections: () => ({ stateOf: () => undefined }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('cold-a')
    expect(sessions[0]?.total).toBeCloseTo(13.60, 10)
    expect(read).toHaveBeenCalledTimes(1)
    expect(closed).toHaveLength(1)
  })
})
