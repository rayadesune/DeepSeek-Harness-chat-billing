/** DeepSeek account-balance badge, browser half: one session-header utility entry. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import billingRemote from '@rayadesu/dsh-llm-billing/remote'
import type {} from '@rayadesu/dsh-llm-billing/remote'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BalanceBadge, type BalanceBadgeInjected } from './BalanceBadge.tsx'
import { TurnCostAction, type TurnCostActionInjected } from './TurnCostAction.tsx'
import { en, NS, zh, type BillingKey } from './locales.ts'

export type { BalanceBadgeInjected, BalanceBadgeProps } from './BalanceBadge.tsx'
export type { TurnCostActionInjected, TurnCostActionProps } from './TurnCostAction.tsx'
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

/** Unwrap one Remote result into its value, reporting the endpoint on failure. */
function unwrap<T>(endpoint: string, result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

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

  // The injected face is built ONCE so its function identities stay stable:
  // the badge's fetch effects list these functions as dependencies, so a
  // per-call rebuild would re-trigger the mount fetch on every render that
  // re-invokes the slot's injector.
  const injected: BalanceBadgeInjected = {
    getBalance: async () => unwrap('billing.getBalance', await billing.getBalance()),
    getSessionSpend: async (sessionId) => unwrap('billing.getSessionSpend', await billing.getSessionSpend(sessionId)),
    getTodaySpend: async (force) => unwrap('billing.getTodaySpend', await billing.getTodaySpend(force)),
    getTodaySessionsSpend: async (force) => unwrap('billing.getTodaySessionsSpend', await billing.getTodaySessionsSpend(force)),
    getTurnSpend: async (sessionId, messageId) => unwrap('billing.getTurnSpend', await billing.getTurnSpend(sessionId, messageId)),
  }

  ctx.slots.inject(
    'conversation.session.header.utilities',
    () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'billing-balance',
      order: 30,
      locale: NS,
      inject: () => injected,
    }, BalanceBadge),
  )

  // The per-turn cost amount rides ui-chat's assistant-actions list slot (the
  // same strip ui-message-feedback uses), so it coexists with every other
  // entry; the actions row renders once per completed Turn, for its closing
  // assistant message. The DOM therefore stays between copy and branch — the
  // label's own CSS `order: 1` sorts it visually after every order-0 sibling
  // (copy, branch, usage pills, clock), landing at the line end.
  // The amount is a plain static span: no interaction, no icon, no label
  // text, so the entry needs no aria or portal behavior.
  const turnCostInjected: TurnCostActionInjected = {
    getTurnSpend: injected.getTurnSpend,
  }
  ctx.slots.inject(
    'conversation.chat.assistant-actions',
    () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'billing-turn-cost',
      order: 20,
      locale: NS,
      inject: () => turnCostInjected,
    }, TurnCostAction),
  )
}
