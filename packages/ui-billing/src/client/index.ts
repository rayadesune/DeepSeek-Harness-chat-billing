/** DeepSeek account-balance badge, browser half: one session-header utility entry. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import billingRemote from '@deepseek-ai/dsh-llm-billing/remote'
import type {} from '@deepseek-ai/dsh-llm-billing/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BalanceBadge, type BalanceBadgeInjected } from './BalanceBadge.tsx'
import { en, NS, zh, type BillingKey } from './locales.ts'

export type { BalanceBadgeInjected, BalanceBadgeProps } from './BalanceBadge.tsx'
export type { BillingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DeepSeek account-balance copy. */
    'billing': BillingKey
  }
}

/** Services required for locale registration, the Remote face, and the header slot. */
export const inject = ['slots', 'locale', 'remote']

/** The mounted `billing` namespace surface, selected from the generated Remote map. */
type BillingNamespace = TypertRemoteNamespaceMap['billing']

/**
 * Client plugin body: mount the `billing` Remote, register the dictionaries,
 * and contribute the header utility badge.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // Mount the Remote owned by this plugin; the host half is `dsh-llm-billing`.
  await ctx.remote.$mount(billingRemote)
  // The mounted namespace is read through the explicit service lookup. The
  // property access `ctx.remote.billing` would require `remote.billing` in this
  // fiber's inject list, which deadlocks: this apply mounts that namespace, so
  // it cannot also wait for it before running.
  const billing = ctx.get('remote.billing') as BillingNamespace | undefined
  if (billing === undefined) {
    throw new Error('ui-billing: billing Remote namespace did not mount')
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-billing: dictionaries')

  const injected = (): BalanceBadgeInjected => ({
    getBalance: async () => {
      const result = await billing.getBalance()
      if (!result.ok) {
        throw new Error(`billing.getBalance failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    getSessionSpend: async (sessionId) => {
      const result = await billing.getSessionSpend(sessionId)
      if (!result.ok) {
        throw new Error(`billing.getSessionSpend failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    getTodaySpend: async () => {
      const result = await billing.getTodaySpend()
      if (!result.ok) {
        throw new Error(`billing.getTodaySpend failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  ctx.slots.inject(
    'conversation.session.header.utilities',
    () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'billing-balance',
      order: 30,
      locale: NS,
      inject: injected,
    }, BalanceBadge),
  )
}
