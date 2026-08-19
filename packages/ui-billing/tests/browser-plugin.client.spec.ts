/**
 * ui-billing plugin halves: the browser entry's dictionary and header-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { BalanceBadge } from '../src/client/BalanceBadge.tsx'
import type { BalanceBadgeInjected } from '../src/client/BalanceBadge.tsx'
import { apply as applyNode } from '../src/index.ts'
import * as BillingInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const BALANCE = {
  isAvailable: true,
  lines: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
}

const SPEND = {
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

const TODAY_SPEND = {
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

type BalanceResult =
  | { readonly ok: true; readonly value: typeof BALANCE }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type SpendResult =
  | { readonly ok: true; readonly value: typeof SPEND }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type TodaySpendResult =
  | { readonly ok: true; readonly value: typeof TODAY_SPEND }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Slot ledger reader: entry ids currently registered in the header utilities list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.utilities')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the header list. */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  getBalance: ReturnType<typeof vi.fn>
  getSessionSpend: ReturnType<typeof vi.fn>
  getTodaySpend: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('sessions', {})
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  // The `remote` Service gives the associate mechanism a target; the generated
  // namespace lives as the sibling `remote.billing` service.
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
    $mount = vi.fn().mockResolvedValue(async () => {})
  }
  new RemoteService(ctx)
  const getBalance = vi.fn<() => Promise<BalanceResult>>()
    .mockResolvedValue({ ok: true, value: BALANCE })
  const getSessionSpend = vi.fn<(sessionId: SessionId) => Promise<SpendResult>>()
    .mockResolvedValue({ ok: true, value: SPEND })
  const getTodaySpend = vi.fn<() => Promise<TodaySpendResult>>()
    .mockResolvedValue({ ok: true, value: TODAY_SPEND })
  ctx.provide('remote.billing', { getBalance, getSessionSpend, getTodaySpend })
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, getBalance, getSessionSpend, getTodaySpend }
}

describe('ui-billing browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote'])
  })

  it('registers the header utility, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).toContain('billing-balance')
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    expect(entry.component).toBe(BalanceBadge)
    expect(entry.locale).toBe(NS)
    await fiber.dispose()
    expect(headerEntryIds(ctx)).not.toContain('billing-balance')
  })

  it('injects a getBalance face that unwraps the Remote result and reports failures', async () => {
    const { ctx, getBalance } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getBalance()).resolves.toEqual(BALANCE)
    expect(getBalance).toHaveBeenCalledOnce()
    getBalance.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'no key' } })
    await expect(injected.getBalance()).rejects.toThrow('billing.getBalance failed: internal: no key')
    await ctx.fiber.dispose()
  })

  it('injects a getSessionSpend face that forwards the session id, unwraps, and reports failures', async () => {
    const { ctx, getSessionSpend } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getSessionSpend('session-1' as SessionId)).resolves.toEqual(SPEND)
    expect(getSessionSpend).toHaveBeenCalledWith('session-1')
    getSessionSpend.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'unknown session' } })
    await expect(injected.getSessionSpend('session-2' as SessionId))
      .rejects.toThrow('billing.getSessionSpend failed: not_found: unknown session')
    await ctx.fiber.dispose()
  })

  it('injects a getTodaySpend face that unwraps the Remote result and reports failures', async () => {
    const { ctx, getTodaySpend } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getTodaySpend()).resolves.toEqual(TODAY_SPEND)
    expect(getTodaySpend).toHaveBeenCalledOnce()
    getTodaySpend.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'no key' } })
    await expect(injected.getTodaySpend()).rejects.toThrow('billing.getTodaySpend failed: internal: no key')
    await ctx.fiber.dispose()
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('state.unavailable')).toBe(zh['state.unavailable'])
    ctx.locale.setLocale('en')
    expect(translate('state.unavailable')).toBe(en['state.unavailable'])
    await fiber.dispose()
    expect(translate('state.unavailable')).not.toBe(en['state.unavailable'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-billing node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('ui-billing invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(BillingInvariant)
    await fiber.await()
    expect(BillingInvariant.name).toBe('client-ui-billing-invariant')
    expect(BillingInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
