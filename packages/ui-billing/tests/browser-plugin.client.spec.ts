// @vitest-environment jsdom
/**
 * ui-billing plugin halves: the browser entry's dictionary and header-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// The published client faces are DSH ModuleLoader bundles. The setup shim
// (tests/module-loader.setup.ts) executes their factories and records the
// exports under window.__DSH_BUNDLE_EXPORTS__; importing the renderer bundle
// first registers the ui-renderer SlotRegistry that the locale bundle binds.
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import '@deepseek-ai/dsh-client-ui-renderer/client'
import '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { BalanceBadge, type BalanceBadgeInjected } from '../src/client/BalanceBadge.tsx'
import { TurnCostAction } from '../src/client/TurnCostAction.tsx'
import { apply as applyNode } from '../src/index.ts'
import * as BillingInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

// Faces captured from the shimmed ModuleLoader registrations. SlotRegistry
// lives in the ui-renderer bundle (the renderer registry over the pure
// ui-slots core); the locale plugin ships in the dsh-client-locale bundle.
const bundleExports = window.__DSH_BUNDLE_EXPORTS__!
const { SlotRegistry } = bundleExports['@deepseek-ai/dsh-client-ui-renderer'] as
  typeof import('@deepseek-ai/dsh-client-ui-renderer/client')
const { apply: applyLocale, inject: localeInject } = bundleExports['@deepseek-ai/dsh-client-locale'] as
  typeof import('@deepseek-ai/dsh-client-locale/client')

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

const TODAY_SESSIONS = {
  sessions: [
    { sessionId: 'session-1' as SessionId, title: '会话甲', total: 0.31 },
    { sessionId: 'session-2' as SessionId, title: null, total: 0.12 },
  ],
}

const TURN_SPEND = { total: 0.31 }

type BalanceResult =
  | { readonly ok: true; readonly value: typeof BALANCE }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type SpendResult =
  | { readonly ok: true; readonly value: typeof SPEND }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type TodaySpendResult =
  | { readonly ok: true; readonly value: typeof TODAY_SPEND }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type TodaySessionsResult =
  | { readonly ok: true; readonly value: typeof TODAY_SESSIONS }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type TurnSpendResult =
  | { readonly ok: true; readonly value: typeof TURN_SPEND }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Slot ledger reader: entry ids currently registered in the header utilities list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.utilities')
    .map(entry => entry.options.id)
}

/** Slot ledger reader: entry ids currently registered in the assistant-actions strip. */
function actionsEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.chat.assistant-actions')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares both lists. */
async function bench(): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  getBalance: ReturnType<typeof vi.fn>
  getSessionSpend: ReturnType<typeof vi.fn>
  getTodaySpend: ReturnType<typeof vi.fn>
  getTodaySessionsSpend: ReturnType<typeof vi.fn>
  getTurnSpend: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
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
  const getTodaySessionsSpend = vi.fn<() => Promise<TodaySessionsResult>>()
    .mockResolvedValue({ ok: true, value: TODAY_SESSIONS })
  const getTurnSpend = vi.fn<(sessionId: SessionId, messageId: string) => Promise<TurnSpendResult>>()
    .mockResolvedValue({ ok: true, value: TURN_SPEND })
  ctx.provide('remote.billing', { getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getTurnSpend })
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getTurnSpend }
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

  it('injects a getTodaySpend face that unwraps the Remote result, forwards force, and reports failures', async () => {
    const { ctx, getTodaySpend } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getTodaySpend()).resolves.toEqual(TODAY_SPEND)
    expect(getTodaySpend).toHaveBeenCalledWith(undefined)
    await expect(injected.getTodaySpend(true)).resolves.toEqual(TODAY_SPEND)
    expect(getTodaySpend).toHaveBeenLastCalledWith(true)
    getTodaySpend.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'no key' } })
    await expect(injected.getTodaySpend()).rejects.toThrow('billing.getTodaySpend failed: internal: no key')
    await ctx.fiber.dispose()
  })

  it('injects a getTodaySessionsSpend face that forwards force, unwraps, and reports failures', async () => {
    const { ctx, getTodaySessionsSpend } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getTodaySessionsSpend()).resolves.toEqual(TODAY_SESSIONS)
    expect(getTodaySessionsSpend).toHaveBeenCalledWith(undefined)
    await expect(injected.getTodaySessionsSpend(true)).resolves.toEqual(TODAY_SESSIONS)
    expect(getTodaySessionsSpend).toHaveBeenLastCalledWith(true)
    getTodaySessionsSpend.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'no key' } })
    await expect(injected.getTodaySessionsSpend()).rejects
      .toThrow('billing.getTodaySessionsSpend failed: internal: no key')
    await ctx.fiber.dispose()
  })

  it('injects a getTurnSpend face that forwards the session and message ids and reports failures', async () => {
    const { ctx, getTurnSpend } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getTurnSpend('session-1' as SessionId, 'm1')).resolves.toEqual(TURN_SPEND)
    expect(getTurnSpend).toHaveBeenCalledWith('session-1', 'm1')
    getTurnSpend.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'unknown session' } })
    await expect(injected.getTurnSpend('session-2' as SessionId, 'm2'))
      .rejects.toThrow('billing.getTurnSpend failed: not_found: unknown session')
    await ctx.fiber.dispose()
  })

  it('registers the per-turn cost entry in the assistant-actions strip, and teardown removes it', async () => {
    const { ctx, fiber } = await bench()
    expect(actionsEntryIds(ctx)).toContain('billing-turn-cost')
    const entry = ctx.slots.entries('conversation.chat.assistant-actions')[0]!
    expect(entry.component).toBe(TurnCostAction)
    expect(entry.options.order).toBe(20)
    await fiber.dispose()
    expect(actionsEntryIds(ctx)).not.toContain('billing-turn-cost')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    ctx.locale.setLocale('zh')
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
