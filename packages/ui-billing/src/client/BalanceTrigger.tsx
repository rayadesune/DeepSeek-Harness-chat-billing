/**
 * Session-header billing trigger: the balance plus the conversation-spend
 * line. Pure view over the data hook's values — no state, no effects.
 */
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** Trigger props: the rendered strings come precomputed from the parent. */
export interface BalanceTriggerProps {
  /** Primary line amount, e.g. `¥123.45`; `—` when the provider reports none. */
  amount: string
  /** Secondary conversation-spend line; absent when the session has no priced usage. */
  spendLine: string | undefined
  /** Whether the detail panel is open (chevron + aria-expanded). */
  open: boolean
  /** Toggle the panel. */
  onToggle: () => void
  t: PropsLocale<typeof NS>['t']
}

/** The badge button: balance line, spend line, and the open-state chevron. */
export function BalanceTrigger({ amount, spendLine, open, onToggle, t }: BalanceTriggerProps) {
  return (
    <button
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-label={t('badge.aria', { amount })}
      onClick={onToggle}
    >
      <span className={css.triggerLines}>
        <span className={css.linePrimary}>{t('trigger.balance', { amount })}</span>
        {spendLine !== undefined && <span className={css.lineSecondary}>{spendLine}</span>}
      </span>
      <IconChevronDownOutline14 className={open ? css.chevronOpen : undefined} />
    </button>
  )
}
