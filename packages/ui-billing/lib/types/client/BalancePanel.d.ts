/**
 * Session-header billing detail panel: the API-remaining row carrying today's
 * consumption measured from the balance series (see balanceDay.ts), today's
 * billed token count (the day's cache-hit share following it) and today's
 * spend across every session with the three TODAY
 * BUCKET modules under them (two lines: the buckets' token counts, then their
 * costs), the pricing-gap notice that names the wire models
 * today's fold could not price, the ranking of today's sessions (one row per
 * conversation — the host has already merged each subagent session's spend into
 * the session that delegated it), a refresh action, and the spend disclaimer.
 * Pure view — no state, no effects; refreshing keeps the last values visible
 * rather than blanking them.
 *
 * The CONVERSATION's own spend is deliberately absent: it belongs to the
 * composer spend pill, so every figure here is account-level — the day's, not
 * this session's.
 */
import type { DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/**
 * How many per-session ranking rows the panel shows before the overflow hint.
 */
export declare const SESSION_RANKING_LIMIT = 10;
/** Panel props: precomputed amount plus the same spend values the badge holds. */
export interface BalancePanelProps {
    /** Primary balance line, e.g. `¥123.45`; `—` when the provider reports none. */
    amount: string;
    /**
     * Today's consumption measured from the balance series itself (the
     * `balanceDay.ts` caliber), riding the amount; `null` before today's first
     * sample for the amount's currency, which renders no rider at all.
     */
    balanceDaySpend: number | null;
    todaySpend: DeepSeekTodaySpend | null;
    sessionsSpend: DeepSeekTodaySessionsSpend | null;
    /**
     * Whether the balance read failed. The panel's first row is then the short
     * actionable `notice.unavailable`; the Remote's verbatim message is NOT
     * rendered here (it is English transport prose, and the chip's accessible
     * name already carries it).
     */
    unavailable?: boolean | undefined;
    /**
     * The other empty balance: the API answered and named no spendable balance.
     * A complete sentence of its own (`notice.none`), not a message to wrap, and
     * it renders as the same first row — this is the only reason the headline
     * above it reads `—`.
     */
    balanceNote?: string | undefined;
    refreshing: boolean;
    onRefresh: () => void;
    t: PropsLocale<typeof NS>['t'];
}
/** The detail box opened from the badge trigger. */
export declare function BalancePanel({ amount, balanceDaySpend, todaySpend, sessionsSpend, unavailable, balanceNote, refreshing, onRefresh, t }: BalancePanelProps): import("react").JSX.Element;
//# sourceMappingURL=BalancePanel.d.ts.map