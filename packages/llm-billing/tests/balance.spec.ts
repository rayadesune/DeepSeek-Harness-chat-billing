/**
 * Account-balance capability: the wire parser, the transport, and the Remote
 * gateway binding. Fetch is exercised through a mocked global fetch, so the
 * suite stays keyless and deterministic.
 */
import { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekBalanceGateway, fetchDeepSeekBalance, parseDeepSeekBalance } from '../src/balance.ts'
import type { DeepSeekBalance, DeepSeekBillingEstimate } from '../src/types.ts'

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

const VALID_ESTIMATE: DeepSeekBillingEstimate = {
  balance: VALID_PUBLIC,
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    tasksRemaining: 12,
    sessionCount: 2,
    totalTokens: 2000,
    avgTokensPerTask: 1000,
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
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
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
    fetchEstimate: async () => VALID_ESTIMATE,
  }

  it('registers under the billing namespace and exports getBalance and getEstimate', () => {
    const ctx = new Context()
    const gateway = new DeepSeekBalanceGateway(ctx, options)
    expect(gateway.typertRemote.namespace).toBe('billing')
    const methods = remoteMethods(gateway).map(marker => marker.exportName ?? marker.method)
    expect(methods).toContain('getBalance')
    expect(methods).toContain('getEstimate')
    expect(ctx.get('billing')).toBeDefined()
  })

  it('delegates to the bound fetch thunks', async () => {
    const ctx = new Context()
    const gateway = new DeepSeekBalanceGateway(ctx, options)
    await expect(gateway.getBalance()).resolves.toEqual(VALID_PUBLIC)
    await expect(gateway.getEstimate()).resolves.toEqual(VALID_ESTIMATE)
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
