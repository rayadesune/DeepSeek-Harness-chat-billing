/**
 * DeepSeek account-balance badge, browser half: three session-scoped entries —
 * the header badge, the per-turn cost label, and the composer spend pill.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type BillingKey } from './locales.ts';
export type { BalanceBadgeInjected, BalanceBadgeProps } from './BalanceBadge.tsx';
export type { SpendCardInjected, SpendCardProps } from './SpendCard.tsx';
export type { TurnCostActionInjected, TurnCostActionProps } from './TurnCostAction.tsx';
export { createTurnCostStore, TURN_COST_STORE_LIMIT, type TurnCostStore } from './turnCostStore.ts';
export type { BillingKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** DeepSeek account-balance copy. */
        'billing': BillingKey;
    }
}
/** Services required for locale registration, the Remote face, and the three slot entries. */
export declare const inject: string[];
/**
 * Client plugin body: mount the `billing` Remote, register the dictionaries,
 * and contribute the header badge, the per-turn cost label, and the composer
 * spend pill.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map