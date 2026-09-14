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
import {
  isSubagentSession,
  TodaySpendCache,
  TodaySpendScanner,
  topLevelSessionOf,
  type SessionLineage,
  type TodaySpendScannerDeps,
} from '../src/today-spend.ts'

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

  it('adopts the remembered fold for an unchanged revision instead of losing the session', async () => {
    const inspect = vi.fn(async () => ({ meta: {}, events: [titleEvent('冷会话', 0), pricedEvent(DAY_TIME, 1)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
    }))
    const first = await scanner.scanDetail(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(first.aggregate.total).toBeCloseTo(13.60, 10)
    expect(first.sessions[0]?.title).toBe('冷会话')
    // The second pass re-reads nothing, yet the unchanged session keeps
    // contributing its whole spend AND its folded title: a revision gate is a
    // cache, not a way to drop sessions from the day.
    const second = await scanner.scanDetail(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(second.aggregate).toEqual(first.aggregate)
    expect(second.sessions).toEqual(first.sessions)
  })

  it('refreshes the remembered fold when the revision changes', async () => {
    let revision = SessionPersistenceRevision('r-a')
    let events = [pricedEvent(DAY_TIME, 0)]
    const inspect = vi.fn(async () => ({ meta: {}, events }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-a' as SessionId }, revision }],
        inspect,
      }),
    }))
    await expect(scanner.scan(DAY_KEY)).resolves.toMatchObject({ total: 13.60 })
    expect(inspect).toHaveBeenCalledTimes(1)
    // The log grew (a new revision) and the next pass re-prices it.
    events = [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)]
    revision = SessionPersistenceRevision('r-b')
    await expect(scanner.scan(DAY_KEY)).resolves.toMatchObject({ total: 27.20 })
    expect(inspect).toHaveBeenCalledTimes(2)
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

  it('truncates at the event cap and remembers nothing from the partial pass', async () => {
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
    // The partial fold is not remembered under the revision: the next scan
    // re-reads rather than adopting a half-priced session.
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
  const rowFor = (dayKey: string, total: number): BillingUnitState => ({
    dayKey,
    spend: {
      total,
      models: [{ model: FLASH, displayName: 'DeepSeek-V4-Flash', cost: total, peakCost: 0, offPeakCost: total, cacheHitInputTokens: 0, cacheMissInputTokens: 100000, outputTokens: 20000, cacheHitInputCost: 0, cacheMissInputCost: total, outputCost: 0 }],
    },
  })
  /** A cached row whose own latest priced day is NOT the queried day. */
  const coldElsewhere = rowFor('2026-08-19', 1)
  /** A cached row whose own latest priced day IS the queried day. */
  const coldToday = rowFor(DAY_KEY, 1)
  const liveState = rowFor(DAY_KEY, 2)

  it('reads live cells eagerly and answers a cold session from its cache row without reading the log', async () => {
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 7, values: { [BILLING_UNIT_KEY]: coldElsewhere } }))
    const inspect = vi.fn(async () => { throw new Error('must not be read') })
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({ list: () => [{ id: 'live' as SessionId, events: [] }] }),
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId, version: 3, createdAt: 1 }, revision: SessionPersistenceRevision('r-a') },
          { header: { id: 'live' as SessionId }, revision: SessionPersistenceRevision('r-live') },
        ],
        inspect,
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'live' ? liveState : undefined,
      }),
      projectionCache: () => ({ cachedSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // The live cell counts; the cold row's day is not the queried one, so it
    // contributes nothing AND its log is never read.
    expect(spend.total).toBeCloseTo(2, 10)
    expect(cachedSnapshot).toHaveBeenCalledTimes(1)
    expect(cachedSnapshot).toHaveBeenCalledWith({ id: 'cold-a', version: 3, createdAt: 1 }, 0, [BILLING_UNIT_KEY])
    expect(inspect).not.toHaveBeenCalled()
  })

  it('reads the log when the cached row is the queried day (the row may trail the log)', async () => {
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 7, values: { [BILLING_UNIT_KEY]: coldToday } }))
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME, 0)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ cachedSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeCloseTo(13.60, 10)
    expect(cachedSnapshot).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('reuses resolved cold values for unchanged revisions', async () => {
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 7, values: { [BILLING_UNIT_KEY]: coldElsewhere } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ cachedSnapshot }),
    }))
    await scanner.scan(DAY_KEY)
    await scanner.scan(DAY_KEY)
    expect(cachedSnapshot).toHaveBeenCalledTimes(1)
  })

  it('re-resolves a cold session whose revision changed', async () => {
    let revision = SessionPersistenceRevision('r-a')
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 7, values: { [BILLING_UNIT_KEY]: coldElsewhere } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-a' as SessionId }, revision }],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ cachedSnapshot }),
    }))
    await scanner.scan(DAY_KEY)
    expect(cachedSnapshot).toHaveBeenCalledTimes(1)
    revision = SessionPersistenceRevision('r-b')
    await scanner.scan(DAY_KEY)
    expect(cachedSnapshot).toHaveBeenCalledTimes(2)
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

  it('reads a live fork child\'s own-event cell (the unit skips the inherited prefix)', async () => {
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
        // The cell is already boundary-aware: it excludes the child's
        // inherited prefix, so the scanner adopts it as-is.
        stateOf: (session) => session.id === 'child'
          ? { dayKey: DAY_KEY, spend: { total: 13.60, models: [] } }
          : { dayKey: DAY_KEY, spend: { total: 27.20, models: [] } },
      }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeCloseTo(27.20 + 13.60, 10)
  })

  it('resolves a cold fork child through inspect, skipping the projection cache', async () => {
    const cachedSnapshot = vi.fn(() => ({
      asOfSeq: 7,
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
      projectionCache: () => ({ cachedSnapshot }),
    }))
    const spend = await scanner.scan(DAY_KEY)
    // The seeded session never rides the cached row: it folds its own events.
    expect(cachedSnapshot).not.toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(spend.total).toBeCloseTo(13.60, 10)
  })

  it('falls back to the local fold when the cache read fails', async () => {
    const cachedSnapshot = vi.fn(() => { throw new Error('cache row poisoned') })
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
      projectionCache: () => ({ cachedSnapshot }),
      logger: { warn },
    }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('negative-caches an unreadable session so the next scan does not re-read it', async () => {
    const warn = vi.fn()
    const inspect = vi.fn(async () => { throw new Error('corrupt log') })
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-bad' as SessionId }, revision: SessionPersistenceRevision('r-bad') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      logger: { warn },
    }))
    await scanner.scan(DAY_KEY)
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('retries a failed session once its revision changes', async () => {
    let revision = SessionPersistenceRevision('r-bad')
    const inspect = vi.fn(async () => { throw new Error('corrupt log') })
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [{ header: { id: 'cold-bad' as SessionId }, revision }],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      logger: { warn: () => {} },
    }))
    await scanner.scan(DAY_KEY)
    revision = SessionPersistenceRevision('r-bad-2')
    await scanner.scan(DAY_KEY)
    expect(inspect).toHaveBeenCalledTimes(2)
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
    // The cached row has no usable billing value, so the cold session resolves
    // through inspect, which folds its title alongside the billing unit.
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 3, values: {} }))
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
      projectionCache: () => ({ cachedSnapshot }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    // Sorted descending: cold-a 13.60 first, live-a 0.5 second; live-b has no cell.
    expect(sessions.map(row => row.sessionId)).toEqual(['cold-a', 'live-a'])
    expect(sessions[0]?.title).toBe('冷会话')
    expect(sessions[1]?.title).toBe('直播会话')
  })

  it('reports a fork child row from its own-event cell on the projection path', async () => {
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
          // Boundary-aware cell: the inherited prefix is already excluded.
          ? { dayKey: DAY_KEY, spend: { total: 13.60, models: [] } }
          : { dayKey: DAY_KEY, spend: { total: 27.20, models: [] } },
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions.find(row => row.sessionId === 'parent')?.total).toBeCloseTo(27.20, 10)
    expect(sessions.find(row => row.sessionId === 'child')?.total).toBeCloseTo(13.60, 10)
  })

  it('reports a null title for cold sessions served from the projection cache', async () => {
    const cachedSnapshot = vi.fn(() => ({ asOfSeq: 3, values: { [BILLING_UNIT_KEY]: { ...coldState, dayKey: '2026-08-19' } } }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect: async () => { throw new Error('must not be read') },
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({ cachedSnapshot }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    // The row's own day is not the queried day: it contributes no row at all,
    // and the log is never read (title therefore unavailable).
    expect(sessions).toHaveLength(0)
  })

  it('reports the cached row as a titled-null row when its day is the queried day', async () => {
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(DAY_TIME, 0)] }))
    const scanner = new TodaySpendScanner(deps({
      persistence: () => ({
        listSnapshots: async () => [
          { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
        ],
        inspect,
      }),
      projections: () => ({ stateOf: () => undefined }),
      projectionCache: () => ({
        cachedSnapshot: () => ({ asOfSeq: 3, values: { [BILLING_UNIT_KEY]: coldState } }),
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('cold-a')
    expect(sessions[0]?.title).toBeNull()
    expect(sessions[0]?.total).toBeCloseTo(13.60, 10)
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})

describe('subagent lineage', () => {
  it('marks a session as a subagent child on either durable marker', () => {
    expect(isSubagentSession({ origin: 'subagent' })).toBe(true)
    expect(isSubagentSession({ delegationDepth: 1 })).toBe(true)
    expect(isSubagentSession({ origin: 'subagent', parentSession: 'p' as SessionId, delegationDepth: 2 })).toBe(true)
    // A user fork names a parent too, but is a session of its own.
    expect(isSubagentSession({ parentSession: 'p' as SessionId })).toBe(false)
    expect(isSubagentSession({ delegationDepth: 0 })).toBe(false)
    expect(isSubagentSession(undefined)).toBe(false)
  })

  it('walks a delegation chain to its root and terminates on a malformed cycle', () => {
    const lineage = new Map<SessionId, SessionLineage>([
      ['root' as SessionId, {}],
      ['mid' as SessionId, { origin: 'subagent', parentSession: 'root' as SessionId, delegationDepth: 1 }],
      ['leaf' as SessionId, { origin: 'subagent', parentSession: 'mid' as SessionId, delegationDepth: 2 }],
      ['lost' as SessionId, { origin: 'subagent', parentSession: 'unlisted' as SessionId }],
      // A corrupt log could claim a delegation cycle: the walk stops at the
      // ancestor whose parent it already visited instead of spinning.
      ['a' as SessionId, { origin: 'subagent', parentSession: 'b' as SessionId }],
      ['b' as SessionId, { origin: 'subagent', parentSession: 'a' as SessionId }],
    ])
    expect(topLevelSessionOf('root' as SessionId, lineage)).toBe('root')
    expect(topLevelSessionOf('leaf' as SessionId, lineage)).toBe('root')
    // An unlisted parent is still authoritative: the row is attributed to the
    // id the child's own header names.
    expect(topLevelSessionOf('lost' as SessionId, lineage)).toBe('unlisted')
    expect(topLevelSessionOf('a' as SessionId, lineage)).toBe('b')
  })
})

describe('TodaySpendScanner subagent roll-up (events path)', () => {
  /** One subagent child's durable header slice, as `childSessionMeta` stamps it. */
  function subagentHeader(parent: SessionId, delegationDepth = 1) {
    return { parentSession: parent, origin: 'subagent' as const, delegationDepth }
  }

  it('merges a subagent child into its parent row and leaves the day aggregate untouched', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [titleEvent('父会话', 0), pricedEvent(DAY_TIME, 1)] },
          {
            id: 'child' as SessionId,
            events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)],
            header: subagentHeader('parent' as SessionId),
          },
        ],
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    // One row for the conversation: the child is not a session the user opened.
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('parent')
    expect(sessions[0]?.title).toBe('父会话')
    // The conversation's day: the parent's ¥13.60 plus the child's ¥27.20.
    expect(sessions[0]?.total).toBeCloseTo(40.80, 10)
    // `ownTotal` stays the parent's own spend — the panel's parenthesized share
    // compares against the session's own amount, not the delegation tree's.
    expect(sessions[0]?.ownTotal).toBeCloseTo(13.60, 10)
    // Regrouping rows moves no money: the aggregate still prices both sessions.
    await expect(scanner.scan(DAY_KEY)).resolves.toMatchObject({ total: 40.80 })
  })

  it('merges a nested delegation into the root row and keeps an unread parent attributed by id', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          // The delegating session priced nothing itself today; its folded title
          // still labels the merged row.
          { id: 'root' as SessionId, events: [titleEvent('根会话', 0)], header: {} },
          { id: 'mid' as SessionId, events: [pricedEvent(DAY_TIME, 0)], header: subagentHeader('root' as SessionId) },
          { id: 'leaf' as SessionId, events: [pricedEvent(DAY_TIME, 0)], header: subagentHeader('mid' as SessionId, 2) },
          { id: 'orphan' as SessionId, events: [pricedEvent(DAY_TIME, 0)], header: subagentHeader('gone' as SessionId) },
        ],
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions.map(row => row.sessionId)).toEqual(['root', 'gone'])
    const root = sessions.find(row => row.sessionId === 'root')
    expect(root?.title).toBe('根会话')
    expect(root?.total).toBeCloseTo(27.20, 10)
    expect(root?.ownTotal).toBe(0)
    // The parent session is not part of this scan, so the child's row is
    // attributed to the id its header names, with no title to show.
    const orphan = sessions.find(row => row.sessionId === 'gone')
    expect(orphan?.title).toBeNull()
    expect(orphan?.total).toBeCloseTo(13.60, 10)
    expect(orphan?.ownTotal).toBe(0)
  })

  it('keeps a user fork as a row of its own (only subagent children merge)', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'source' as SessionId, events: [titleEvent('来源会话', 0), pricedEvent(DAY_TIME, 0)] },
          {
            id: 'fork' as SessionId,
            events: [pricedEvent(DAY_TIME, 0), pricedEvent(DAY_TIME, 1)],
            // Fork lineage names a parent, but neither subagent marker is set:
            // a session the user forked stays its own conversation.
            header: { isSeeded: true, parentSession: 'source' as SessionId },
          },
        ],
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions.map(row => row.sessionId)).toEqual(['fork', 'source'])
    expect(sessions[0]?.total).toBeCloseTo(27.20, 10)
    expect(sessions[0]?.ownTotal).toBeCloseTo(27.20, 10)
    expect(sessions[1]?.total).toBeCloseTo(13.60, 10)
  })
})

describe('TodaySpendScanner subagent roll-up (projection path)', () => {
  it('merges a cold subagent child into its live parent\'s eager cell', async () => {
    const scanner = new TodaySpendScanner(deps({
      sessions: () => ({
        list: () => [
          { id: 'parent' as SessionId, events: [titleEvent('父会话')], header: {} },
        ],
      }),
      persistence: () => ({
        listSnapshots: async () => [
          {
            header: {
              id: 'child' as SessionId,
              parentSession: 'parent' as SessionId,
              origin: 'subagent' as const,
              delegationDepth: 1,
            },
            revision: SessionPersistenceRevision('r-child'),
          },
        ],
        inspect: async () => ({ meta: { origin: 'subagent' as const }, events: [pricedEvent(DAY_TIME, 0)] }),
      }),
      projections: () => ({
        stateOf: (session) => session.id === 'parent'
          ? { dayKey: DAY_KEY, spend: { total: 2, models: [] } }
          : undefined,
      }),
    }))
    const { sessions } = await scanner.scanSessions(DAY_KEY)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe('parent')
    expect(sessions[0]?.title).toBe('父会话')
    expect(sessions[0]?.total).toBeCloseTo(15.60, 10)
    expect(sessions[0]?.ownTotal).toBeCloseTo(2, 10)
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

  it('accepts the 0.1.5-alpha.1 handle read shape ({ eventState, events })', async () => {
    // Since DSH commit 9b78f99dec the handle read returns a result wrapper;
    // the scanner must unwrap it exactly like the older bare-array shape.
    const closed: { id: SessionId }[] = []
    const service = {
      list: vi.fn(async () => [
        { header: { id: 'cold-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
      ]),
      open: vi.fn(async (id: SessionId) => ({
        header: { id },
        inheritedEventCount: 0,
        read: vi.fn(async () => ({
          eventState: 'shared-frozen',
          events: [pricedEvent(DAY_TIME, 0), pricedEvent(OTHER_DAY, 1)],
        })),
        close: async () => { closed.push({ id }) },
      })),
    }
    const scanner = new TodaySpendScanner(deps({ persistence: () => service }))
    const spend = await scanner.scan(DAY_KEY)
    expect(spend.total).toBeCloseTo(13.60, 10)
    expect(spend.models).toHaveLength(1)
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
