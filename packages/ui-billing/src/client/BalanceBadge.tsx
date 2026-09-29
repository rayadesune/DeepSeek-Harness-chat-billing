/**
 * Session-header billing badge: the remaining balance plus TODAY's billed
 * spend, both carrying the detail panel's own labels (`API 剩余金额` /
 * `今日花费`). Composition root: the data lifecycle lives in
 * {@link useBillingData}, and the trigger / detail panel are pure views. The
 * badge renders null until the first balance fetch settles, and a refresh keeps
 * the last values visible rather than blanking them. A failed first fetch keeps
 * the badge pressable: the trigger reads the localized unavailable word and the
 * panel it opens carries both the Remote's own error message and the refresh
 * action, so a rejected key is readable and retryable from one place.
 *
 * The conversation's own spend is NOT shown here: it lives on the composer
 * spend pill (`SpendCard`), the one surface that reads the host-pushed
 * projection. The badge's second line is account-level, so it moves on the
 * reads today's figure has — mount, refresh, a settled turn, and a panel open.
 */
import type { DeepSeekBalance, DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
   * session that session delegated, transitively, across every day. The
   * composer spend pill is the surface that shows it — it adds this subtotal to
   * the live own-session value, so the amount reads as the whole
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
 * shows the remaining balance and today's billed spend, and opens the detail
 * panel (amount, today's tokens and spend with their bucket lines, ranking,
 * refresh, disclaimer).
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null until the first balance fetch settles.
 */
export function BalanceBadge({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection, t }: BalanceBadgeProps) {
  const {
    balance,
    balanceDaySpend,
    todaySpend,
    sessionsSpend,
    error,
    refreshing,
    open,
    rootRef,
    refresh,
    toggleOpen,
  } = useBillingData({ getBalance, getCachedBalance, getBalanceDaySpend, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, useSession, useProjection })

  // The amount, the chip's spend line, and both failure shapes are decided
  // BEFORE the render branches: a settled balance without a line, a rejected
  // fetch, and a healthy balance then differ only in what they show, not in how
  // the panel is reached. Today's spend is account-level and does not depend on
  // the balance read, so it stays visible — chip line and panel row alike —
  // whenever the balance itself cannot be reported.
  const line = balance === null ? undefined : primaryLine(balance)
  const amount = line === undefined ? '—' : `${line.symbol}${line.total}`
  // The panel's own label, so the chip and the box agree word for word — the
  // same `todaySpend` state feeds both, so they cannot disagree either. Today
  // is account-level: the line hides only while the day priced nothing, so a
  // conversation that spent nothing today still reports the day's other
  // sessions.
  const spendLine = todaySpend !== null && todaySpend.models.length > 0
    ? t('label.todaySpend', { amount: formatSpendSignificant(todaySpend.total) })
    : undefined
  // Two distinct shapes, and the panel says which: a rejected read is a FAILURE
  // with a message worth reading in full and its own chip word, while a
  // reachable API that simply reports no spendable balance has no failure to
  // name and keeps the ordinary `剩余金额：—` label. Both reach the same card,
  // and both keep the `—` headline the provider's own empty line produces.
  const failure = error ?? undefined
  const noBalanceNote = balance !== null && failure === undefined && (!balance.isAvailable || line === undefined)
    ? t('notice.none')
    : undefined

  if (balance === null || failure !== undefined || noBalanceNote !== undefined) {
    // Nothing renders before the first fetch settles without a failure to show.
    if (balance === null && failure === undefined) return null
    return (
      <div ref={rootRef} className={css.root}>
        <BalanceTrigger
          amount={amount}
          spendLine={spendLine}
          error={failure}
          open={open}
          onToggle={toggleOpen}
          t={t}
        />
        {open
          ? (
            <BalancePanel
              amount={amount}
              unavailable={failure !== undefined}
              balanceNote={noBalanceNote}
              balanceDaySpend={null}
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

  return (
    <div ref={rootRef} className={css.root}>
      <BalanceTrigger amount={amount} spendLine={spendLine} open={open} onToggle={toggleOpen} t={t} />
      {open
        ? (
          <BalancePanel
            amount={amount}
            balanceDaySpend={balanceDaySpend}
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
