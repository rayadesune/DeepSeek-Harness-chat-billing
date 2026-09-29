import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { HoverCard, IconQuestionOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { formatSpendSignificant, formatTokens, rowTokens } from "./format.js";
import { spendBucketsOf, cacheHitPercentOf, tokenBucketsOf } from "./spendBuckets.js";
import { PLUGIN_VERSION } from "./version.js";
import css from './BalanceBadge.module.css';
/**
 * How many per-session ranking rows the panel shows before the overflow hint.
 */
export const SESSION_RANKING_LIMIT = 10;
/**
 * Today's two bucket detail lines, rendered under the 今日 Token / 今日花费 row:
 * the three buckets' token counts, then their costs — DSH's own bucket wording
 * and row order in both lines, in the panel's own breakdown typography and row
 * rhythm (the pricing-gap notice reuses it). Each line stands on its own (no
 * column alignment between them): the middots keep the natural " · " spacing of
 * every other breakdown line in the panel.
 *
 * Tokens and costs come from the SAME day row set (`todaySpend.models`) the row
 * above is built from: the three token counts add up to the token figure, and
 * the three costs (with `spendBucketsOf`'s residual absorbed into the largest
 * bucket) to the cost figure. Costs render at three significant digits, like the
 * day figure above them, and never finer than four decimals — their last digits
 * move with every request and carry no meaning.
 */
function todayBucketLines(t, spend) {
    const tokens = tokenBucketsOf(spend);
    const costs = spendBucketsOf(spend);
    return {
        tokenLine: [
            `${t('label.bucket.input')} ${t('unit.tokens', { count: formatTokens(tokens.uncachedInput) })}`,
            `${t('label.bucket.cacheRead')} ${t('unit.tokens', { count: formatTokens(tokens.cacheRead) })}`,
            `${t('label.bucket.output')} ${t('unit.tokens', { count: formatTokens(tokens.output) })}`,
        ].join(' · '),
        costLine: [
            t('label.cost.input', { amount: formatSpendSignificant(costs.uncachedInput) }),
            t('label.cost.cacheRead', { amount: formatSpendSignificant(costs.cacheRead) }),
            t('label.cost.output', { amount: formatSpendSignificant(costs.output) }),
        ].join(' · '),
    };
}
/**
 * The hint card's body: every line of `info.hint` as its own row, then the
 * version below them at the metadata weight instead of the prose's.
 *
 * The two levels are restated rather than referenced — the panel defines them
 * as custom properties on `.panel`, and the card is portaled to
 * `document.body`, outside that subtree, so nothing inherits from it. Their
 * values match the panel's own second and first levels exactly, which keeps
 * this notice in the same type family as everything beside it.
 */
function HintCard({ t }) {
    const lines = t('info.hint', { version: PLUGIN_VERSION }).split('\n');
    return (_jsxs("div", { className: css.hint, children: [lines.slice(0, -1).map(line => _jsx("div", { className: css.hintLine, children: line }, line)), _jsx("div", { className: css.hintVersion, children: lines[lines.length - 1] })] }));
}
/** The detail box opened from the badge trigger. */
export function BalancePanel({ amount, balanceDaySpend, todaySpend, sessionsSpend, unavailable, balanceNote, refreshing, onRefresh, t }) {
    // The count is DSH's compact notation plus DSH's own ` tok` unit; the
    // placeholder states stay bare (no ` tok` after a `—`).
    const todayTokens = todaySpend === null
        ? '—'
        : todaySpend.models.length === 0
            ? todaySpend.unpriced === undefined ? t('stat.none') : t('stat.unpricedOnly')
            : t('unit.tokens', {
                count: formatTokens(todaySpend.models.reduce((sum, row) => sum + rowTokens(row), 0)),
            });
    const todayAmount = todaySpend === null
        ? '—'
        : todaySpend.models.length === 0
            // Two empties that look identical in a figure: nothing was measured, or
            // usage was measured and matched no rate. Only the second is actionable,
            // so it must never borrow the first's wording.
            ? todaySpend.unpriced === undefined ? t('stat.none') : t('stat.unpricedOnly')
            : formatSpendSignificant(todaySpend.total);
    // The day's cache-hit share rides the token figure bare — no parentheses, in
    // the same level-one style as the amount rider (see the
    // stylesheet's three type levels) — using DSH's own hit-rate rule (format.ts)
    // over the day's prompt-side buckets, so the number matches what the official
    // token surfaces would print. It shares the placeholder states' own condition:
    // a day that priced nothing has no ratio (and neither `—` nor `暂无消耗记录`
    // grows a figure of its own).
    const todayHit = todaySpend === null || todaySpend.models.length === 0
        ? null
        : cacheHitPercentOf(todaySpend);
    // Today's pricing gap, NAMED: the wire models whose usage has no rate row. A
    // figure that silently omits them invites no doubt — which is exactly the
    // failure being fixed here. Nothing is ever priced by a guessed rate.
    const todayNotices = todaySpend === null || todaySpend.unpriced === undefined
        ? []
        : [t('notice.unpriced', { models: todaySpend.unpriced.models.join(', ') })];
    return (_jsxs("div", { className: css.panel, role: "dialog", "aria-label": t('panel.aria'), children: [(unavailable === true || balanceNote !== undefined) && (_jsx("div", { className: css.dayBucketRow, children: _jsx("span", { className: css.costBreakdown, children: unavailable === true ? t('notice.unavailable') : balanceNote }) })), _jsxs("div", { className: css.amountRow, children: [_jsxs("span", { className: css.amountLabel, children: [t('label.amount', { amount }), balanceDaySpend !== null
                                ? (_jsx("span", { className: css.amountToday, children: t('label.amount.todaySpend', { amount: formatSpendSignificant(balanceDaySpend) }) }))
                                : null] }), _jsxs("span", { className: css.amountActions, children: [_jsx(HoverCard, { openDelayMs: 200, inline: true, anchor: (_jsx("button", { type: "button", className: css.infoButton, "aria-label": t('info.aria'), children: _jsx(IconQuestionOutlineRegular, { size: 14, className: css.inlineIcon }) })), content: _jsx(HintCard, { t: t }) }), _jsx("button", { type: "button", className: css.refreshButton, onClick: onRefresh, "aria-label": t('action.refresh'), "data-refreshing": refreshing || undefined, children: _jsx(IconRefreshOutlineRegular, { size: 14, className: refreshing ? css.spinning : css.inlineIcon }) })] })] }), _jsxs("div", { className: css.spendRow, children: [_jsxs("span", { className: css.amountLabel, children: [t('label.todayTokens', { count: todayTokens }), todayHit !== null
                                ? (_jsx("span", { className: css.todayHit, children: t('label.todayTokens.hit', { percent: todayHit }) }))
                                : null] }), _jsx("span", { className: css.amountLabel, children: t('label.todaySpend', { amount: todayAmount }) })] }), todaySpend !== null && todaySpend.models.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: css.dayBucketRow, children: _jsx("span", { className: css.costBreakdown, children: todayBucketLines(t, todaySpend).tokenLine }) }), _jsx("div", { className: css.dayBucketRow, children: _jsx("span", { className: css.costBreakdown, children: todayBucketLines(t, todaySpend).costLine }) })] })), todayNotices.length > 0 && todayNotices.map(notice => (_jsx("div", { className: css.dayBucketRow, children: _jsx("span", { className: css.costBreakdown, children: notice }) }, notice))), sessionsSpend !== null && sessionsSpend.sessions.length > 0 && (_jsxs("div", { className: css.ranking, children: [_jsx("div", { className: css.rankingTitle, children: t('label.sessionRanking') }), sessionsSpend.sessions.slice(0, SESSION_RANKING_LIMIT).map((row, index) => (_jsxs("div", { className: css.rankingRow, children: [_jsx("span", { className: css.rankingIndex, children: index + 1 }), _jsx("span", { className: css.rankingDot, "aria-hidden": true, children: ' · ' }), _jsx("span", { className: css.rankingName, title: row.title ?? undefined, children: row.title ?? t('stat.untitled') }), _jsx("span", { className: css.rankingAmount, children: formatSpendSignificant(row.total) })] }, row.sessionId))), sessionsSpend.sessions.length > SESSION_RANKING_LIMIT && (_jsx("div", { className: css.rankingMore, children: t('label.sessionRanking.more', { count: sessionsSpend.sessions.length - SESSION_RANKING_LIMIT }) }))] }))] }));
}
//# sourceMappingURL=BalancePanel.js.map