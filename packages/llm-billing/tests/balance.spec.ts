/**
 * Account-balance capability: the wire parser, the transport, and the Remote
 * gateway binding. Fetch is exercised through a mocked global fetch, so the
 * suite stays keyless and deterministic.
 */
import { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from '../src/balance.ts'
import { apply as applyBilling } from '../src/index.ts'
import type { DeepSeekBalance } from '../src/types.ts'

const VALID_WIRE = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
}

const VALID_PUBLIC: DeepSeekBalance = {
  isAvailable: true,
  lines: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
}

const VALID_SPEND = {
  total: 0.31,
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    cost: 0.31,
    peakCost: 0.31,
    offPeakCost: 0,
    cacheHitInputTokens: 1000,
    cacheMissInputTokens: 100000,
    outputTokens: 20000,
    cacheHitInputCost: 0.01,
    cacheMissInputCost: 0.20,
    outputCost: 0.10,
  }],
}

const VALID_TODAY_SPEND = {
  total: 0.62,
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    cost: 0.62,
    peakCost: 0.31,
    offPeakCost: 0.31,
    cacheHitInputTokens: 2000,
    cacheMissInputTokens: 200000,
    outputTokens: 40000,
    cacheHitInputCost: 0.02,
    cacheMissInputCost: 0.40,
    outputCost: 0.20,
  }],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseDeepSeekBalance', () => {
  it('maps the wire response to the public snapshot', () => {
    expect(parseDeepSeekBalance(VALID_WIRE)).toEqual(VALID_PUBLIC)
  })

  it('keeps every currency line', () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' },
        { currency: 'USD', total_balance: '2.00', granted_balance: '1.00', topped_up_balance: '1.00' },
      ],
    })).toMatchObject({ lines: [{ currency: 'CNY' }, { currency: 'USD' }] })
  })

  it('rejects a non-object body', () => {
    expect(() => parseDeepSeekBalance(null)).toThrow(LlmError)
  })

  it('rejects a body missing is_available or balance_infos', () => {
    expect(() => parseDeepSeekBalance({ is_available: true })).toThrow(LlmError)
    expect(() => parseDeepSeekBalance({ balance_infos: [] })).toThrow(LlmError)
  })

  it('rejects a malformed balance line', () => {
    expect(() => parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '1.00', granted_balance: '0.00' }],
    })).toThrow(LlmError)
  })
})

describe('fetchDeepSeekBalance', () => {
  it('fetches /user/balance with the resolved bearer token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, VALID_WIRE))
    await expect(fetchDeepSeekBalance('https://api.deepseek.com', 'secret')).resolves.toEqual(VALID_PUBLIC)
    expect(spy).toHaveBeenCalledWith(
      'https://api.deepseek.com/user/balance',
      expect.objectContaining({
        method: 'GET',
        // The header matcher is the assertion; objectContaining is any-typed.
        headers: expect.objectContaining({ authorization: 'Bearer secret' }), // oxlint-disable-line typescript/no-unsafe-assignment
      }),
    )
  })

  it('maps an HTTP status to the provider error code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, {}))
    await expect(fetchDeepSeekBalance('https://api.deepseek.com', 'bad')).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('wraps a network failure as TRANSPORT', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'))
    await expect(fetchDeepSeekBalance('https://api.deepseek.com', 'key')).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('rejects a non-JSON body as TRANSPORT', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }))
    await expect(fetchDeepSeekBalance('https://api.deepseek.com', 'key')).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('reports caller cancellation as ABORTED', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('aborted'))
    await expect(fetchDeepSeekBalance('https://api.deepseek.com', 'key', controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })
})

describe('DeepSeekBalanceGateway', () => {
  const options = {
    fetchBalance: async () => VALID_PUBLIC,
    fetchSessionSpend: async () => VALID_SPEND,
    fetchTodaySpend: async () => VALID_TODAY_SPEND,
    fetchTodaySessionsSpend: async () => ({ sessions: [] }),
    fetchTurnSpend: async () => ({ total: 0 }),
    fetchTurnSpends: async () => ({ turns: [] }),
  }

  it('registers under the billing namespace and exports getBalance, getSessionSpend, and getTodaySpend', () => {
    const ctx = new Context()
    const gateway = new DeepSeekBalanceGateway(ctx, options)
    expect(gateway.typertRemote.namespace).toBe('billing')
    const methods = remoteMethods(gateway).map(marker => marker.exportName ?? marker.method)
    expect(methods).toContain('getBalance')
    expect(methods).toContain('getSessionSpend')
    expect(methods).toContain('getTodaySpend')
    expect(ctx.get('billing')).toBeDefined()
  })

  it('delegates to the bound fetch thunks', async () => {
    const ctx = new Context()
    const gateway = new DeepSeekBalanceGateway(ctx, options)
    await expect(gateway.getBalance()).resolves.toEqual(VALID_PUBLIC)
    await expect(gateway.getBalance(true)).resolves.toEqual(VALID_PUBLIC)
    await expect(gateway.getSessionSpend('session-1' as SessionId)).resolves.toEqual(VALID_SPEND)
    await expect(gateway.getTodaySpend()).resolves.toEqual(VALID_TODAY_SPEND)
    await expect(gateway.getTodaySpend(true)).resolves.toEqual(VALID_TODAY_SPEND)
    await expect(gateway.getSessionTurnSpends('session-1' as SessionId)).resolves.toEqual({ turns: [] })
  })

  it('is root-visible when constructed inside a plugin fiber', async () => {
    const root = new Context()
    const fiber = root.plugin({
      name: 'llm-deepseek-sim',
      apply: (pluginCtx: Context) => {
        new DeepSeekBalanceGateway(pluginCtx, options)
      },
    })
    await fiber.await()
    expect(root.get('billing')).toBeDefined()
    await root.fiber.dispose()
  })
})

describe('apply / balance cache', () => {
  it('reuses one snapshot inside the TTL, coalesces misses, and refetches only on force', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(200, VALID_WIRE))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: 'key' }) } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const first = await gateway.getBalance()
    const second = await gateway.getBalance()
    // The TTL-served read returns the same settled snapshot: one provider call.
    expect(second).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
    // Concurrent forced misses coalesce into the same request.
    const [a, b] = await Promise.all([gateway.getBalance(true), gateway.getBalance(true)])
    expect(a).toEqual(b)
    expect(spy).toHaveBeenCalledTimes(2)
    await gateway.getBalance(true)
    expect(spy).toHaveBeenCalledTimes(3)
    await ctx.fiber.dispose()
  })
})

describe('apply / today spend', () => {
  /** One today-priced flash event: now falls on today's Beijing calendar day. */
  function pricedEvent(index: number): SessionEvent {
    return {
      type: 'assistant/message',
      seq: index,
      time: Date.now(),
      data: {
        turn: 0,
        step: index,
        message: {
          id: `m${index}` as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 },
      },
    } as unknown as SessionEvent
  }

  it('serves the aggregate and the ranking from one shared scan', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { list: () => [] } as never)
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(0)] }))
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [
        { header: { id: 'session-a' as SessionId }, revision: SessionPersistenceRevision('r-a') },
      ],
      inspect,
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const spend = await gateway.getTodaySpend()
    const ranking = await gateway.getTodaySessionsSpend()
    expect(spend.total).toBeGreaterThan(0)
    expect(ranking.sessions).toHaveLength(1)
    // One scan served both reads: the cold session was inspected once.
    expect(inspect).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('serves a conversation\'s delegated subtree from the same cached scan', async () => {
    const ctx = new Context()
    const sessions = [
      // Born three days ago: its spend can span more than today.
      { id: 'session-parent' as SessionId, events: [pricedEvent(0)], header: { createdAt: Date.now() - 3 * 86_400_000 } },
      // No resolvable creation instant: an unproven crossing reads as `false`.
      {
        id: 'session-child' as SessionId,
        events: [pricedEvent(0)],
        header: { parentSession: 'session-parent' as SessionId, origin: 'subagent', delegationDepth: 1 },
      },
    ]
    ctx.provide('sessions', {
      list: () => sessions,
      get: (id: SessionId) => sessions.find(session => session.id === id),
    } as never)
    const inspect = vi.fn()
    ctx.provide('sessionPersistence', { listSnapshots: async () => [], inspect } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const own = await gateway.getSessionSpend('session-parent' as SessionId)
    const delegated = await gateway.getDelegatedSpend('session-parent' as SessionId)
    // The child's own billed samples, which the parent's log cannot price.
    expect(delegated.total).toBeGreaterThan(0)
    expect(delegated.total).toBeCloseTo(own.total, 10)
    expect(delegated.isSubagent).toBe(false)
    // The parent was created three days ago, so its spend can span today.
    expect(delegated.crossedDay).toBe(true)
    expect(delegated.models.map(row => row.model)).toEqual(['deepseek-v4-flash'])
    // The child is itself a delegated session, delegated nothing onward, and
    // carries no resolvable creation instant — no proven crossing.
    await expect(gateway.getDelegatedSpend('session-child' as SessionId)).resolves.toMatchObject({
      total: 0,
      isSubagent: true,
      crossedDay: false,
    })
    await ctx.fiber.dispose()
  })

  it('aggregates today\'s spend across a very large session log without exceeding the call stack', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { list: () => [] } as never)
    const bigEvents = Array.from({ length: 200_000 }, (_, index) => pricedEvent(index))
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [
        { header: { id: 'session-big' }, revision: SessionPersistenceRevision('r-big') },
      ],
      inspect: async () => ({ meta: {}, events: bigEvents }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    await expect(gateway.getTodaySpend()).resolves.toMatchObject({
      total: expect.any(Number), // oxlint-disable-line typescript/no-unsafe-assignment
      models: [{ model: 'deepseek-v4-flash' }],
    })
    await ctx.fiber.dispose()
  })

  it('skips a session that fails to inspect instead of failing the whole day', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { list: () => [] } as never)
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [
        { header: { id: 'session-ok' }, revision: SessionPersistenceRevision('r-ok') },
        { header: { id: 'session-bad' }, revision: SessionPersistenceRevision('r-bad') },
      ],
      inspect: async (id: SessionId) => {
        if (id === 'session-bad' as SessionId) throw new Error('corrupt log')
        return { meta: {}, events: [pricedEvent(0)] }
      },
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    await expect(gateway.getTodaySpend()).resolves.toMatchObject({
      total: expect.any(Number), // oxlint-disable-line typescript/no-unsafe-assignment
    })
    await ctx.fiber.dispose()
  })

  it('counts live sessions first and does not double-count them through persistence', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      list: () => [{ id: 'session-live', events: [pricedEvent(0)] }],
    } as never)
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [
        { header: { id: 'session-live' }, revision: SessionPersistenceRevision('r-live') },
      ],
      inspect: async () => { throw new Error('must not be read') },
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    await expect(gateway.getTodaySpend()).resolves.toMatchObject({
      total: expect.any(Number), // oxlint-disable-line typescript/no-unsafe-assignment
    })
    await ctx.fiber.dispose()
  })

  it('serves the 60s cache within the window; force recomputes but the revision gate holds', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { list: () => [] } as never)
    const inspect = vi.fn(async () => ({ meta: {}, events: [pricedEvent(0)] }))
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [
        { header: { id: 'session-a' }, revision: SessionPersistenceRevision('r-a') },
      ],
      inspect,
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    await gateway.getTodaySpend()
    await gateway.getTodaySpend()
    expect(inspect).toHaveBeenCalledTimes(1)
    // Force bypasses the time window; the revision gate is a correctness cache,
    // so an unchanged log still costs nothing.
    await gateway.getTodaySpend(true)
    expect(inspect).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })
})

describe('apply / session spend cache', () => {
  /** One today-priced flash event: now falls on today's Beijing calendar day. */
  function pricedEvent(index: number): SessionEvent {
    return {
      type: 'assistant/message',
      seq: index,
      time: Date.now(),
      data: {
        turn: 0,
        step: index,
        message: {
          id: `m${index}` as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 },
      },
    } as unknown as SessionEvent
  }

  it('serves the same cached spend while the log length is unchanged', async () => {
    const ctx = new Context()
    const events = [pricedEvent(0)]
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({ meta: {}, events }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const first = await gateway.getSessionSpend('session-cache' as SessionId)
    const second = await gateway.getSessionSpend('session-cache' as SessionId)
    // The cache returns the same resolved value — no re-pricing happened.
    expect(second).toBe(first)
    await ctx.fiber.dispose()
  })

  it('prices only the appended tail when the log grows', async () => {
    const ctx = new Context()
    const events = [pricedEvent(0)]
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({ meta: {}, events }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const first = await gateway.getSessionSpend('session-cache' as SessionId)
    events.push(pricedEvent(1))
    const second = await gateway.getSessionSpend('session-cache' as SessionId)
    expect(second.total).toBeCloseTo(first.total * 2, 10)
    expect(second).not.toBe(first)
    await ctx.fiber.dispose()
  })

  it('computes a fresh spend for a session it has never priced', async () => {
    const ctx = new Context()
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({ meta: {}, events: [pricedEvent(0)] }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const a = await gateway.getSessionSpend('session-a' as SessionId)
    const b = await gateway.getSessionSpend('session-b' as SessionId)
    expect(b.total).toBeCloseTo(a.total, 10)
    expect(b).not.toBe(a)
    await ctx.fiber.dispose()
  })

  it('serves every completed Turn\'s cost in one call and folds only the appended tail', async () => {
    /** One priced assistant message of the given Turn. */
    const message = (seq: number, turn: number): SessionEvent => ({
      type: 'assistant/message',
      seq,
      time: Date.now(),
      data: {
        turn,
        step: 0,
        message: {
          id: `m${seq}` as never,
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 50 },
      },
    } as unknown as SessionEvent)
    /** Turn brackets around one priced assistant message. */
    const turn = (start: number): SessionEvent[] => [
      { type: 'turn/start', seq: start, time: Date.now(), data: { turn: start, step: 0 } },
      message(start + 1, start),
      { type: 'turn/end', seq: start + 2, time: Date.now(), data: { turn: start, step: 0, reason: { kind: 'done' } } },
    ] as unknown as SessionEvent[]
    const ctx = new Context()
    const events: SessionEvent[] = turn(0)
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({ meta: {}, events }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const first = await gateway.getSessionTurnSpends('session-turns' as SessionId)
    expect(first.turns).toHaveLength(1)
    expect(first.turns[0]?.messageId).toBe('m1')
    events.push(...turn(3))
    const second = await gateway.getSessionTurnSpends('session-turns' as SessionId)
    // The first Turn is not re-priced; the appended one joins the map.
    expect(second.turns.map(row => row.messageId)).toEqual(['m1', 'm4'])
    expect(second.turns[1]?.total).toBeCloseTo(second.turns[0]!.total, 10)
    await ctx.fiber.dispose()
  })

  it('bills a forked child session from its own events only', async () => {
    const ctx = new Context()
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({
        meta: { seedLength: 2 },
        events: [pricedEvent(0), pricedEvent(1), pricedEvent(2)],
      }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const spend = await gateway.getSessionSpend('session-fork' as SessionId)
    // One own event instead of three: the two inherited copies are skipped.
    expect(spend.models[0]?.cacheHitInputTokens).toBe(100)
    await ctx.fiber.dispose()
  })

  it('prices only the appended own tail for a growing fork child', async () => {
    const ctx = new Context()
    const events = [pricedEvent(0), pricedEvent(1), pricedEvent(2)]
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      inspect: async () => ({ meta: { seedLength: 2 }, events }),
    } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const first = await gateway.getSessionSpend('session-fork' as SessionId)
    events.push(pricedEvent(3))
    const second = await gateway.getSessionSpend('session-fork' as SessionId)
    expect(second.total).toBeCloseTo(first.total * 2, 10)
    await ctx.fiber.dispose()
  })

  it('reads a 0.1.2-alpha.4+ live session through snapshotEvents instead of Session.events', async () => {
    const ctx = new Context()
    // The newer Session exposes no `events` property; only snapshotEvents.
    ctx.provide('sessions', {
      get: () => ({
        id: 'session-live',
        snapshotEvents: () => [pricedEvent(0), pricedEvent(1)],
        inheritedEventCount: 0,
      }),
    } as never)
    ctx.provide('sessionPersistence', { listSnapshots: async () => [], inspect: async () => { throw new Error('must not be read') } } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const spend = await gateway.getSessionSpend('session-live' as SessionId)
    expect(spend.models[0]?.cacheHitInputTokens).toBe(200)
    await ctx.fiber.dispose()
  })

  it('bills a 0.1.2-alpha.4+ live fork child from its own events only (inheritedEventCount)', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      get: () => ({
        id: 'session-new-fork',
        snapshotEvents: () => [pricedEvent(0), pricedEvent(1), pricedEvent(2)],
        inheritedEventCount: 2,
      }),
    } as never)
    ctx.provide('sessionPersistence', { listSnapshots: async () => [], inspect: async () => { throw new Error('must not be read') } } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const spend = await gateway.getSessionSpend('session-new-fork' as SessionId)
    // One own event instead of three: the two inherited copies are skipped.
    expect(spend.models[0]?.cacheHitInputTokens).toBe(100)
    await ctx.fiber.dispose()
  })

  it('aggregates today\'s spend for a 0.1.2-alpha.4+ live session on the events path', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      list: () => [{
        id: 'session-new-live',
        snapshotEvents: () => [pricedEvent(0), pricedEvent(1)],
        inheritedEventCount: 0,
      }],
    } as never)
    ctx.provide('sessionPersistence', { listSnapshots: async () => [], inspect: async () => { throw new Error('must not be read') } } as never)
    applyBilling(ctx, {})
    const gateway = ctx.get('billing') as unknown as DeepSeekBalanceGateway
    const spend = await gateway.getTodaySpend()
    expect(spend.models[0]?.cacheHitInputTokens).toBe(200)
    await ctx.fiber.dispose()
  })
})
