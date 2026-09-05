/**
 * Session-header billing badge: balance plus the current conversation's billed
 * spend. Composition root: the data lifecycle lives in {@link useBillingData},
 * and the trigger / detail panel are pure views. The badge renders null until
 * the first balance fetch settles, and a refresh keeps the last values
 * visible rather than blanking them.
 */
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatSpend, primaryLine } from './format.ts'
import { BalancePanel } from './BalancePanel.tsx'
import { BalanceTrigger } from './BalanceTrigger.tsx'
import { useBillingData } from './useBillingData.ts'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

export { SESSION_RANKING_LIMIT } from './BalancePanel.tsx'
export { TURN_SETTLE_DEBOUNCE_MS } from './useBillingData.ts'

/** Registration-side Remote face used by the header badge. */
export interface BalanceBadgeInjected {
  /** Read the account balance; rejects with the Remote error message. */
  getBalance: () => Promise<DeepSeekBalance>
  /** Read one session's billed spend; rejects with the Remote error message. */
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>
  /**
   * Read today's billed spend across every session; rejects with the Remote
   * error message. `force` bypasses the host-side cache — the manual refresh
   * passes it, the turn-triggered recompute does not.
   */
  getTodaySpend: (force?: boolean) => Promise<DeepSeekTodaySpend>
  /**
   * Read today's billed spend per session, sorted by cost descending; rejects
   * with the Remote error message. `force` behaves as in {@link getTodaySpend}.
   */
  getTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend>
  /** Read one completed Turn's billed cost, located by its closing message id. */
  getTurnSpend: (sessionId: SessionId, messageId: string) => Promise<DeepSeekTurnSpend>
}

/** Full props assembled by the header utilities slot renderer. */
export type BalanceBadgeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<BalanceBadgeInjected>
  & PropsLocale<typeof NS>

/**
 * Render the billing badge in the session-header utilities row: the trigger
 * shows the remaining balance and this conversation's billed spend, and opens
 * the detail panel (amount, per-model spend breakdown, today's spend, ranking,
 * refresh, disclaimer).
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null until the first balance fetch settles.
 */
export function BalanceBadge({ getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, useSession, t }: BalanceBadgeProps) {
  const {
    balance,
    spend,
    todaySpend,
    sessionsSpend,
    error,
    refreshing,
    open,
    rootRef,
    refresh,
    toggleOpen,
  } = useBillingData({ getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, useSession })

  if (balance === null) {
    if (error === null) return null
    return (
      <Tooltip label={error} delayMs={500}>
        <button type="button" className={css.trigger} onClick={refresh} aria-label={t('action.refresh')}>
          <span className={css.unavailable}>{t('state.unavailable')}</span>
          <IconRefreshOutline14 className={css.inlineIcon} />
        </button>
      </Tooltip>
    )
  }

  const line = primaryLine(balance)
  const amount = line === undefined ? '—' : `${line.symbol}${line.total}`
  const spendLine = spend !== null && spend.models.length > 0
    ? t('trigger.conversationSpend', { amount: formatSpend(spend.total) })
    : undefined

  return (
    <div ref={rootRef} className={css.root}>
      <BalanceTrigger amount={amount} spendLine={spendLine} open={open} onToggle={toggleOpen} t={t} />
      {open
        ? (
          <BalancePanel
            amount={amount}
            spend={spend}
            todaySpend={todaySpend}
            sessionsSpend={sessionsSpend}
            refreshing={refreshing}
            onRefresh={refresh}
            t={t}
          />
        )
        : null}
    </div>
  )
}
