import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Session-header billing trigger: the balance plus today's spend line. Pure
 * view over the data hook's values — no state, no effects. The balance line
 * uses the trigger's own `trigger.balance` (the panel headline without its
 * "API" prefix, since the chip is narrow); the spend line arrives precomputed
 * from the parent carrying the PANEL's `label.todaySpend`.
 */
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './BalanceBadge.module.css';
/**
 * The badge button: balance line, spend line, and the open-state chevron. With
 * an `error` the primary line is the localized unavailable word instead of an
 * amount, the spend line drops (nothing account-level is known without a
 * balance fetch), and the accessible name is the error itself — the chip stays
 * the same button either way, so a failed fetch opens the same panel rather
 * than offering nothing to press.
 */
export function BalanceTrigger({ amount, spendLine, error, open, onToggle, t }) {
    return (_jsxs("button", { type: "button", className: css.trigger, "aria-expanded": open, "aria-label": error === undefined ? t('badge.aria', { amount }) : error, onClick: onToggle, children: [_jsxs("span", { className: css.triggerLines, children: [_jsx("span", { className: error === undefined ? css.linePrimary : css.unavailable, children: error === undefined ? t('trigger.balance', { amount }) : t('state.unavailable') }), spendLine !== undefined && _jsx("span", { className: css.lineSecondary, children: spendLine })] }), _jsx(IconChevronDownOutlineRegular, { size: 14, className: open ? css.chevronOpen : undefined })] }));
}
//# sourceMappingURL=BalanceTrigger.js.map