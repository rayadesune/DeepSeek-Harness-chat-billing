import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Composer spend pill: the billing mark (this package's own ring-and-sparkle
 * glyph, reduced for the composer's 14px tier) plus the amount, in the
 * composer's stat row, opening this conversation's billed-cost card. The card
 * reproduces DSH's own token-usage dialog skin row for row (same surface,
 * radius, elevation, title rule, and right-aligned tabular amounts) with the
 * spend's three billing buckets where that card shows its token buckets:
 * uncached input, cache read, output.
 *
 * The amounts ride the host-pushed `billingTodaySpend` projection, so the pill
 * is live with zero Remote calls; `billing/getSessionSpend` is the fallback for
 * an assembly whose projection registry is absent (the same ladder the header
 * badge walks in `useBillingData`), and `billing/getDelegatedSpend` adds the
 * subagent sessions this conversation delegated — the same own+delegated merge
 * that badge's second line makes, so the pill and the badge never disagree.
 * @module @rayadesu/dsh-client-ui-billing/SpendCard
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatSpendSignificant } from "./format.js";
import { BillingMarkIcon } from "./icons.js";
import { spendBucketsOf } from "./spendBuckets.js";
import { sumSpends } from "./spends.js";
import { TURN_SETTLE_DEBOUNCE_MS } from "./useBillingData.js";
import { MEASURE_STYLE, useCardDialog } from "./useCardDialog.js";
import css from './SpendCard.module.css';
/** One row of the card's detail grid (a dt/dd pair of the same dl). */
function Row({ label, value }) {
    return (_jsxs(_Fragment, { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value })] }));
}
/**
 * Render the composer spend pill, and the cost card it opens.
 *
 * The pill is an inline flex item of DSH's composer stat row, so it sits beside
 * the built-in time/token pills (see SpendCard.module.css); its glyph, tone,
 * typography, and hover fill are copied from those pills. The amount is this
 * conversation's billed spend — this session's own spend plus the subagent
 * sessions it delegated — and a session that priced nothing anywhere renders no
 * entry at all.
 * @param props - the session identity, the runtime hooks, the Remote face, and the locale seat.
 * @returns the pill plus its portaled card, or null when there is nothing to show.
 */
export function SpendCard({ sessionId, useSession, useProjection, getSessionSpend, getDelegatedSpend, t }) {
    const { open, setOpen, rootRef, panelRef, pos } = useCardDialog();
    const projected = useProjection('billingTodaySpend');
    // Fallback path only: with the projection composed, this state never fills.
    const [fallback, setFallback] = useState(null);
    // The last settled subagent subtotal; `null` until one lands, and a failed
    // read keeps the previous value instead of dropping the amount back to this
    // session's own spend alone.
    const [delegated, setDelegated] = useState(null);
    // The turn-settled effect below reads whether the projection is composed
    // without subscribing to it: a projection value landing mid-debounce must not
    // re-run that effect and cancel the armed settle read.
    const projectedRef = useRef(projected);
    projectedRef.current = projected;
    useEffect(() => {
        if (projected !== undefined)
            return;
        let current = true;
        void Promise.resolve()
            .then(() => getSessionSpend(sessionId))
            .then((value) => { if (current)
            setFallback(value); }, () => { if (current)
            setFallback(null); });
        return () => { current = false; };
    }, [getSessionSpend, projected, sessionId]);
    // The delegated subtotal is a session-level read, like the badge's: on mount
    // and on a session switch. It reads plainly (no `force`) — the host serves
    // what it holds and refreshes behind the answer — while the turn-settled
    // effect below forces.
    useEffect(() => {
        let current = true;
        void Promise.resolve()
            .then(() => getDelegatedSpend(sessionId))
            .then((value) => { if (current)
            setDelegated(value); }, () => { });
        return () => { current = false; };
    }, [getDelegatedSpend, sessionId]);
    // The running flag is the "turn settled" signal, exactly as it is for the
    // badge: it flips true when a prompt turn starts and false when the turn
    // ends. The settle read FORCES, because the turn just priced its own usage —
    // a cached answer is the pre-turn figure, which would leave the pill one turn
    // behind the badge's own line. The debounce matches the badge's, so a burst of
    // turns (an agent continuing across turns) prices once.
    const running = useSession(snapshot => snapshot.running);
    // The last running state already priced, so this effect skips the initial
    // mount (the mount effect already fetched).
    const pricedRunningRef = useRef(running);
    useEffect(() => {
        if (running === pricedRunningRef.current)
            return;
        pricedRunningRef.current = running;
        // A turn starting only arms the edge; the settle (running → false) prices.
        if (running)
            return;
        let current = true;
        const timer = setTimeout(() => {
            void Promise.resolve()
                .then(() => getDelegatedSpend(sessionId, true))
                .then((value) => { if (current)
                setDelegated(value); }, () => { });
            // A projection-less assembly is served by the fallback state, which no
            // push updates: re-read it in the same beat (the badge's own settle read
            // of `getSessionSpend` is plain too).
            if (projectedRef.current === undefined) {
                void Promise.resolve()
                    .then(() => getSessionSpend(sessionId))
                    .then((value) => { if (current)
                    setFallback(value); }, () => { });
            }
        }, TURN_SETTLE_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            current = false;
        };
    }, [getDelegatedSpend, getSessionSpend, sessionId, running]);
    // This session's own billed spend: the pushed projection wins over the Remote
    // snapshot when present, because it is already current for this session and
    // costs no round trip.
    const own = projected === undefined ? fallback : projected.session;
    // What the pill and the card show is the CONVERSATION: the own part above
    // plus the subagent sessions it delegated, merged exactly as the badge merges
    // them (`useBillingData`). An own amount of `null` stays null even with a
    // subtotal in hand — there is no own spend to attach one to — and an absent
    // subtotal leaves the own amount as it is.
    const spend = own === null ? null : delegated === null ? own : sumSpends(own, delegated);
    // Hooks stay above the early return: a session that later prices something
    // must not mount a different hook sequence than one that never did.
    const buckets = useMemo(() => (spend === null ? null : spendBucketsOf(spend)), [spend]);
    // No priced row means nothing was billed here (no DeepSeek/MiMo usage, or the
    // Remote failed): no pill, no card. The test is on the MERGED amount, so a
    // session that priced nothing itself but delegated a subagent that did still
    // shows. A model row that priced to zero still shows, so "priced ¥0" never
    // reads as "not priced yet".
    if (buckets === null || spend === null || spend.models.length === 0)
        return null;
    const totalText = formatSpendSignificant(buckets.total);
    return (_jsx("div", { className: css.root, "data-spend-card": true, children: _jsxs("span", { ref: rootRef, className: css.anchor, children: [_jsxs("button", { type: "button", className: css.pill, "aria-haspopup": "dialog", "aria-expanded": open, "aria-label": t('card.aria', { amount: totalText }), onClick: () => { setOpen(!open); }, children: [_jsx(BillingMarkIcon, { size: 14 }), _jsx("span", { className: css.label, children: totalText })] }), open && createPortal(_jsxs("div", { ref: panelRef, className: css.panel, role: "dialog", "aria-label": t('card.title'), style: pos ?? MEASURE_STYLE, children: [_jsxs("div", { className: css.title, children: [_jsxs("span", { className: css.titleLabel, children: [_jsx(BillingMarkIcon, { size: 14 }), t('card.title')] }), _jsx("span", { className: css.titleValue, children: totalText })] }), _jsx("div", { className: css.titleRule, "aria-hidden": true }), _jsxs("dl", { className: css.details, "data-spend-buckets": true, children: [_jsx(Row, { label: t('label.bucket.input'), value: formatSpendSignificant(buckets.uncachedInput) }), _jsx(Row, { label: t('label.bucket.cacheRead'), value: formatSpendSignificant(buckets.cacheRead) }), _jsx(Row, { label: t('label.bucket.output'), value: formatSpendSignificant(buckets.output) })] })] }), document.body)] }) }));
}
//# sourceMappingURL=SpendCard.js.map