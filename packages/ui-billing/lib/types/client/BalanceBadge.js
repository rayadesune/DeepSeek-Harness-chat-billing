import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatSpendSignificant, primaryLine } from "./format.js";
import { BalancePanel } from "./BalancePanel.js";
import { BalanceTrigger } from "./BalanceTrigger.js";
import { useBillingData } from "./useBillingData.js";
import css from './BalanceBadge.module.css';
export { SESSION_RANKING_LIMIT } from "./BalancePanel.js";
export { BALANCE_POLL_MS, TURN_SETTLE_DEBOUNCE_MS } from "./useBillingData.js";
/**
 * Render the billing badge in the session-header utilities row: the trigger
 * shows the remaining balance and today's billed spend, and opens the detail
 * panel (amount, today's tokens and spend with their bucket lines, ranking,
 * refresh, disclaimer).
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null until the first balance fetch settles.
 */
export function BalanceBadge({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection, t }) {
    const { balance, balanceDaySpend, todaySpend, sessionsSpend, error, refreshing, open, rootRef, refresh, toggleOpen, } = useBillingData({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection });
    // The amount, the chip's spend line, and both failure shapes are decided
    // BEFORE the render branches: a settled balance without a line, a rejected
    // fetch, and a healthy balance then differ only in what they show, not in how
    // the panel is reached. Today's spend is account-level and does not depend on
    // the balance read, so it stays visible — chip line and panel row alike —
    // whenever the balance itself cannot be reported.
    const line = balance === null ? undefined : primaryLine(balance);
    const amount = line === undefined ? '—' : `${line.symbol}${line.total}`;
    // The panel's own label, so the chip and the box agree word for word — the
    // same `todaySpend` state feeds both, so they cannot disagree either. Today
    // is account-level: the line hides only while the day priced nothing, so a
    // conversation that spent nothing today still reports the day's other
    // sessions.
    const spendLine = todaySpend !== null && todaySpend.models.length > 0
        ? t('label.todaySpend', { amount: formatSpendSignificant(todaySpend.total) })
        : undefined;
    // Two distinct shapes, and the panel says which: a rejected read is a FAILURE
    // with a message worth reading in full and its own chip word, while a
    // reachable API that simply reports no spendable balance has no failure to
    // name and keeps the ordinary `剩余金额：—` label. Both reach the same card,
    // and both keep the `—` headline the provider's own empty line produces.
    const failure = error ?? undefined;
    const noBalanceNote = balance !== null && failure === undefined && (!balance.isAvailable || line === undefined)
        ? t('notice.none')
        : undefined;
    if (balance === null || failure !== undefined || noBalanceNote !== undefined) {
        // Nothing renders before the first fetch settles without a failure to show.
        if (balance === null && failure === undefined)
            return null;
        return (_jsxs("div", { ref: rootRef, className: css.root, children: [_jsx(BalanceTrigger, { amount: amount, spendLine: spendLine, error: failure, open: open, onToggle: toggleOpen, t: t }), open
                    ? (_jsx(BalancePanel, { amount: amount, unavailable: failure !== undefined, balanceNote: noBalanceNote, balanceDaySpend: null, todaySpend: todaySpend, sessionsSpend: sessionsSpend, refreshing: refreshing, onRefresh: refresh, t: t }))
                    : null] }));
    }
    return (_jsxs("div", { ref: rootRef, className: css.root, children: [_jsx(BalanceTrigger, { amount: amount, spendLine: spendLine, open: open, onToggle: toggleOpen, t: t }), open
                ? (_jsx(BalancePanel, { amount: amount, balanceDaySpend: balanceDaySpend, todaySpend: todaySpend, sessionsSpend: sessionsSpend, refreshing: refreshing, onRefresh: refresh, t: t }))
                : null] }));
}
//# sourceMappingURL=BalanceBadge.js.map