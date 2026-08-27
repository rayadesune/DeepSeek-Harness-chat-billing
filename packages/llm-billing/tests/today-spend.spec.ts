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
import { resolveBilling } from '../src/billing.ts'
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
    let now = Date.parse('2026-08-20T04:00:00Z')
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
