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

const ESTIMATE = {
  balance: { isAvailable: true, lines: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }] },
  models: [{
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek-V4-Flash',
    tasksRemaining: 12,
    sessionCount: 2,
    totalTokens: 2000,
    avgTokensPerTask: 1000,
  }],
}

type EstimateResult =
  | { readonly ok: true; readonly value: typeof ESTIMATE }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Slot ledger reader: entry ids currently registered in the header utilities list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.utilities')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the header list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']>; getEstimate: ReturnType<typeof vi.fn> }> {
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
  const getEstimate = vi.fn<() => Promise<EstimateResult>>()
    .mockResolvedValue({ ok: true, value: ESTIMATE })
  ctx.provide('remote.billing', { getEstimate })
  ctx.provide('modelDirectories', {
    directoryFor: () => ({
      store: { getSnapshot: () => ({ current: { model: 'deepseek-v4-flash', provider: 'deepseek-official' } }) },
      load: vi.fn().mockResolvedValue(undefined),
    }),
  })
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, getEstimate }
}

describe('ui-billing browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'modelDirectories'])
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

  it('injects a getEstimate face that unwraps the Remote result and reports failures', async () => {
    const { ctx, getEstimate } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    await expect(injected.getEstimate()).resolves.toEqual(ESTIMATE)
    expect(getEstimate).toHaveBeenCalledOnce()
    getEstimate.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'no key' } })
    await expect(injected.getEstimate()).rejects.toThrow('billing.getEstimate failed: internal: no key')
    await ctx.fiber.dispose()
  })

  it('injects a getCurrentModel face that reads the session directory', async () => {
    const { ctx } = await bench()
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]!
    const injected = (entry.inject as unknown as () => BalanceBadgeInjected)()
    expect(injected.getCurrentModel('session-1' as SessionId)).toBe('deepseek-v4-flash')
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
