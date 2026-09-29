import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/** Trigger props: the rendered strings come precomputed from the parent. */
export interface BalanceTriggerProps {
    /** Primary line amount, e.g. `¥123.45`; `—` when the provider reports none. */
    amount: string;
    /** Secondary today-spend line; absent while today prices no usage. */
    spendLine: string | undefined;
    /**
     * The settled balance failure, when there is one. It REPLACES the amount line
     * with the localized unavailable word — the chip can only say the balance is
     * unavailable, never a figure it does not have. Carried rather than dropped:
     * it becomes the trigger's accessible name, while the panel this same press
     * opens shows the message in full. A balance the provider reports without a
     * line has no failure to name (`undefined` here) and keeps the ordinary
     * `trigger.balance` label with its `—` amount.
     */
    error?: string | undefined;
    /** Whether the detail panel is open (chevron + aria-expanded). */
    open: boolean;
    /** Toggle the panel. */
    onToggle: () => void;
    t: PropsLocale<typeof NS>['t'];
}
/**
 * The badge button: balance line, spend line, and the open-state chevron. With
 * an `error` the primary line is the localized unavailable word instead of an
 * amount, the spend line drops (nothing account-level is known without a
 * balance fetch), and the accessible name is the error itself — the chip stays
 * the same button either way, so a failed fetch opens the same panel rather
 * than offering nothing to press.
 */
export declare function BalanceTrigger({ amount, spendLine, error, open, onToggle, t }: BalanceTriggerProps): import("react").JSX.Element;
//# sourceMappingURL=BalanceTrigger.d.ts.map