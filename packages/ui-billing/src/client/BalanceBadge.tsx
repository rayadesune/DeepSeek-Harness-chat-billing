/**
 * Session-header billing badge: balance plus the current conversation's billed
 * spend, both carrying the detail panel's own labels (`API 剩余金额` /
 * `本会话花费`). Composition root: the data lifecycle lives in
 * {@link useBillingData}, and the trigger / detail panel are pure views. The
 * badge renders null until the first balance fetch settles, and a refresh keeps
 * the last values visible rather than blanking them.
 */
import type { DeepSeekBalance, DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconRefreshOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatSpendSignificant, primaryLine } from './format.ts'
import { BalancePanel } from './BalancePanel.tsx'
import { BalanceTrigger } from './BalanceTrigger.tsx'
import { useBillingData } from './useBillingData.ts'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

export { SESSION_RANKING_LIMIT } from './BalancePanel.tsx'
export { BALANCE_POLL_MS, TURN_SETTLE_DEBOUNCE_MS } from './useBillingData.ts'

/** Registration-side Remote face used by the header badge. */
export interface BalanceBadgeInjected {
  /**
   * Read the account balance; rejects with the Remote error message. `force`
   * bypasses the host-side TTL — the manual refresh passes it, a mount does
   * not (a snapshot younger than the TTL is reused, so switching sessions
   * costs no provider call).
   */
  getBalance: (force?: boolean) => Promise<DeepSeekBalance>
  /**
   * The last balance this browser half settled, or `null` before the first
   * one. Synchronous: a badge mount renders the amount immediately and
   * revalidates in the background.
   */
  getCachedBalance: () => DeepSeekBalance | null
  /**
   * Today's consumption measured from the balance series itself: the day's
   * first queried balance minus the given one, plus the top-ups the series
   * showed (see balanceDay.ts). Synchronous and side-effect free — every
   * `getBalance` call has already folded its snapshot into the day record.
   * `null` when today holds no sample for the snapshot's primary currency.
   */
  getBalanceDaySpend: (balance: DeepSeekBalance) => number | null
  /** Read one session's billed spend; rejects with the Remote error message. */
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>
  /**
   * Read the subagent part of one conversation's billed spend: every subagent
   * session that session delegated, transitively, across every day. The badge
   * adds it to the live own-session value, so the amount it shows is the whole
   * conversation's. `force` behaves as in {@link getTodaySpend}.
   */
  getDelegatedSpend: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend>
  /**
   * Read today's billed spend across every session; rejects with the Remote
   * error message. `force` bypasses the host-side cache — the manual refresh
   * passes it, the turn-triggered recompute does not.
   */
  getTodaySpend: (force?: boolean) => Promise<DeepSeekTodaySpend>
  /**
   * Read today's billed spend per session, sorted by cost descending; rejects
   * with the Remote error message. One row per top-level conversation: the host
   * merges every subagent session's spend into the row of the session that
   * delegated it. `force` behaves as in {@link getTodaySpend}.
   */
  getTodaySessionsSpend: (force?: boolean) => Promise<DeepSeekTodaySessionsSpend>
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
export function BalanceBadge({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection, t }: BalanceBadgeProps) {
  const {
    balance,
    balanceDaySpend,
    spend,
    todaySpend,
    sessionsSpend,
    isSubagent,
    crossedDay,
    error,
    refreshing,
    open,
    rootRef,
    refresh,
    toggleOpen,
  } = useBillingData({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection })

  if (balance === null) {
    if (error === null) return null
    return (
      <Tooltip label={error} delayMs={500}>
        <button type="button" className={css.trigger} onClick={refresh} aria-label={t('action.refresh')}>
          <span className={css.unavailable}>{t('state.unavailable')}</span>
          <IconRefreshOutlineRegular size={14} className={css.inlineIcon} />
        </button>
      </Tooltip>
    )
  }

  const line = primaryLine(balance)
  const amount = line === undefined ? '—' : `${line.symbol}${line.total}`
  // The panel's own label, so the chip and the box agree word for word.
  const spendLine = spend !== null && spend.models.length > 0
    ? t('label.sessionSpend', { amount: formatSpendSignificant(spend.total) })
    : undefined

  return (
    <div ref={rootRef} className={css.root}>
      <BalanceTrigger amount={amount} spendLine={spendLine} open={open} onToggle={toggleOpen} t={t} />
      {open
        ? (
          <BalancePanel
            amount={amount}
            balanceDaySpend={balanceDaySpend}
            sessionId={sessionId}
            spend={spend}
            todaySpend={todaySpend}
            sessionsSpend={sessionsSpend}
            isSubagent={isSubagent}
            crossedDay={crossedDay}
            refreshing={refreshing}
            onRefresh={refresh}
            t={t}
          />
        )
        : null}
    </div>
  )
}
