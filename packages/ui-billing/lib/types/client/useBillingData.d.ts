import type { RefObject } from 'react';
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types';
import type { BalanceBadgeProps } from './BalanceBadge.tsx';
/** Debounce for the turn-settled recompute: a burst of turns prices once. */
export declare const TURN_SETTLE_DEBOUNCE_MS = 2000;
/**
 * Balance poll cadence while the page is visible: five minutes, the
 * `balanceinfo` program's own interval.
 *
 * The day's consumption is measured from the FIRST balance queried on the local
 * calendar day (see balanceDay.ts), so the sampling cadence IS the figure's
 * resolution: with a poll, a page left open across midnight takes the new day's
 * baseline within one interval, and a top-up is seen within one interval
 * instead of only at the next mount. A hidden page stops polling and refreshes
 * once when it comes back, so a backgrounded tab costs nothing.
 */
export declare const BALANCE_POLL_MS = 300000;
/** The data surface the trigger and the panel render from. */
export interface BillingData {
    balance: DeepSeekBalance | null;
    /**
     * Today's consumption measured from the balance series ITSELF (the
     * `balanceDay.ts` caliber): the day's first queried balance minus the
     * amount on screen, plus the day's top-ups. Derived synchronously from
     * `balance` — the host is never asked for it, because only this browser
     * knows which balances it has seen today. `null` until the day holds a
     * sample for the amount's currency.
     */
    balanceDaySpend: number | null;
    /**
     * The WHOLE conversation's billed spend: this session's own spend (live, from
     * the pushed projection or the `getSessionSpend` fallback) plus the subagent
     * sessions it delegated (the last `getDelegatedSpend` read), so the amount a
     * user reads is the conversation's, not just its own log's. No longer
     * rendered here — the badge's line and its panel are account-level, and the
     * conversation's amount is the composer pill's — but the reads producing it
     * stay (see the hook's note below).
     */
    spend: DeepSeekSessionSpend | null;
    todaySpend: DeepSeekTodaySpend | null;
    sessionsSpend: DeepSeekTodaySessionsSpend | null;
    /** Whether the current session is itself a delegated subagent child. */
    isSubagent: boolean;
    /**
     * Whether the current session started on an EARLIER Beijing day. `false`
     * until the delegated read settles and for every session created today. It
     * decided the panel's today share, which went away with the session row; it
     * rides along with the rest of the session-level group.
     */
    crossedDay: boolean;
    /** Balance fetch failure while no value is present yet. */
    error: string | null;
    /**
     * Whether a read the user is waiting on is in flight. It follows the group
     * the change actually re-ran: a session switch covers this session's own two
     * reads, a manual refresh (which re-runs both groups) covers every read. The
     * account-level reads never make a switch spin.
     */
    refreshing: boolean;
    open: boolean;
    rootRef: RefObject<HTMLDivElement>;
    refresh: () => void;
    toggleOpen: () => void;
}
/**
 * Start the badge's data lifecycle for one session. The reads are split by what
 * they depend on, because only one half of them varies by session:
 *
 * - **Session level** (`getSessionSpend`, `getDelegatedSpend`) — re-read on
 *   mount, on a session switch, on a manual refresh, and when a turn settles.
 *   Nothing the badge renders reads their result any more (its second line and
 *   its panel are account-level; the conversation's own amount is the composer
 *   pill's), but the group stays: it is one cached host pass, and dropping it
 *   would also take the session switch's spinner with it.
 * - **Account level** (`getBalance`, `getTodaySpend`, plus the ranking while
 *   the panel is open) — re-read on mount, on a manual refresh, and when a turn
 *   settles, never on a session switch: neither answer depends on which session
 *   is on screen, and re-fetching them on every switch is what made the header
 *   spin for as long as the day's scan took.
 *
 * The session's own part is also driven live by the host-pushed
 * `billingTodaySpend` projection (zero Remote calls), with `getSessionSpend` as
 * the bootstrap/fallback when the projection key is absent; the balance is
 * additionally polled every {@link BALANCE_POLL_MS} while the page is visible,
 * because the day's consumption is measured from the first balance each local
 * day queried.
 *
 * A settled turn and the manual refresh read with `force`, a plain read does
 * not: the host serves a plain read the value on hand while it refreshes behind
 * it, so a settled turn that read plainly would report the day's pre-turn figure
 * one turn late. Opening the panel re-reads today's spend too — that is the
 * moment the reader asks for the day row, and a switch alone never re-reads it.
 * @param props - the badge's injected face and session runtime share.
 */
export declare function useBillingData({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection, }: Pick<BalanceBadgeProps, 'getBalance' | 'getCachedBalance' | 'getBalanceDaySpend' | 'getSessionSpend' | 'getTodaySpend' | 'getTodaySessionsSpend' | 'getDelegatedSpend' | 'sessionId' | 'useSession' | 'useProjection'>): BillingData;
//# sourceMappingURL=useBillingData.d.ts.map