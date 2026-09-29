/**
 * Session-header billing trigger: the balance plus today's spend line. Pure
 * view over the data hook's values — no state, no effects. The balance line
 * uses the trigger's own `trigger.balance` (the panel headline without its
 * "API" prefix, since the chip is narrow); the spend line arrives precomputed
 * from the parent carrying the PANEL's `label.todaySpend`.
 */
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** Trigger props: the rendered strings come precomputed from the parent. */
export interface BalanceTriggerProps {
  /** Primary line amount, e.g. `¥123.45`; `—` when the provider reports none. */
  amount: string
  /** Secondary today-spend line; absent while today prices no usage. */
  spendLine: string | undefined
  /**
   * The settled balance failure, when there is one. It REPLACES the amount line
   * with the localized unavailable word — the chip can only say the balance is
   * unavailable, never a figure it does not have. Carried rather than dropped:
   * it becomes the trigger's accessible name, while the panel this same press
   * opens shows the message in full. A balance the provider reports without a
   * line has no failure to name (`undefined` here) and keeps the ordinary
   * `trigger.balance` label with its `—` amount.
   */
  error?: string | undefined
  /** Whether the detail panel is open (chevron + aria-expanded). */
  open: boolean
  /** Toggle the panel. */
  onToggle: () => void
  t: PropsLocale<typeof NS>['t']
}

/**
 * The badge button: balance line, spend line, and the open-state chevron. With
 * an `error` the primary line is the localized unavailable word instead of an
 * amount, the spend line drops (nothing account-level is known without a
 * balance fetch), and the accessible name is the error itself — the chip stays
 * the same button either way, so a failed fetch opens the same panel rather
 * than offering nothing to press.
 */
export function BalanceTrigger({ amount, spendLine, error, open, onToggle, t }: BalanceTriggerProps) {
  return (
    <button
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-label={error === undefined ? t('badge.aria', { amount }) : error}
      onClick={onToggle}
    >
      <span className={css.triggerLines}>
        <span className={error === undefined ? css.linePrimary : css.unavailable}>
          {error === undefined ? t('trigger.balance', { amount }) : t('state.unavailable')}
        </span>
        {spendLine !== undefined && <span className={css.lineSecondary}>{spendLine}</span>}
      </span>
      <IconChevronDownOutlineRegular size={14} className={open ? css.chevronOpen : undefined} />
    </button>
  )
}
