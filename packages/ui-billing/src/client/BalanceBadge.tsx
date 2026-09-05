/** Session-header billing badge: balance plus the current conversation's billed spend. */

import { Fragment, useEffect, useRef, useState } from 'react'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend, DeepSeekTurnSpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconChevronDownOutline14, IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatSpend, primaryLine } from './format.ts'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

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

/** How many per-session ranking rows the panel shows before the overflow hint. */
export const SESSION_RANKING_LIMIT = 10

/**
 * Run one fetch line: the fetch is deferred to a microtask so the effect's
 * render commits before any state update lands; a settled value is stored
 * while `current` stays true, and a rejection keeps the previous value (a
 * no-op unless `onReject` supplies fallback handling) so a failed refetch
 * never blanks the UI.
 */
function fetchLine<T>(
  current: () => boolean,
  fetch: () => Promise<T>,
  store: (value: T) => void,
  onReject?: (reason: unknown) => void,
): Promise<void> {
  return Promise.resolve().then(fetch).then(
    (value) => { if (current()) store(value) },
    (reason: unknown) => { if (current()) onReject?.(reason) },
  )
}

/**
 * Render the billing badge in the session-header utilities row. The trigger
 * shows the remaining balance and this conversation's billed spend and opens
 * a label box with the amount, this session's spend with its cache-hit /
 * cache-miss-input / output cost breakdown per model, today's spend across
 * every session, a refresh action, and a spend disclaimer. Refreshing keeps
 * the last values visible rather than blanking them.
 *
 * The spend follows the conversation: when a prompt turn settles in the
 * current session, the badge recomputes only the (local, network-free)
 * session spend and today's spend through `getSessionSpend` /
 * `getTodaySpend`; the balance stays a manual-refresh snapshot and is never
 * refetched on its own.
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null until the first balance fetch settles.
 */
export function BalanceBadge({ getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, useSession, t }: BalanceBadgeProps) {
  const [balance, setBalance] = useState<DeepSeekBalance | null>(null)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [todaySpend, setTodaySpend] = useState<DeepSeekTodaySpend | null>(null)
  const [sessionsSpend, setSessionsSpend] = useState<DeepSeekTodaySessionsSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // The running flag is the "turn settled" signal: it flips true when a prompt
  // turn starts and false when the turn ends, letting the spend-only effect
  // below react to a landed turn without touching the account balance.
  const running = useSession(snapshot => snapshot.running)

  // The last running state this component already priced, so the spend-only
  // effect skips the initial mount (the mount effect already fetched).
  const pricedRunningRef = useRef(running)

  useEffect(() => {
    let current = true
    const isCurrent = (): boolean => current
    // A refresh (values already present) keeps the previous values on screen;
    // the first load has nothing to keep, so it stays on the loading render.
    setRefreshing(balance !== null)
    void Promise.resolve().then(() => {
      // Each line settles on its own: the badge renders from the balance and
      // the panel rows from their own spend, so a slow aggregate (today's
      // spend scans every session) delays neither the balance nor the session
      // spend.
      const balanceRequest = fetchLine(isCurrent, getBalance, (value) => {
        setBalance(value)
        setError(null)
      }, (reason: unknown) => {
        // A refresh failure keeps the last good value instead of blanking it.
        if (balance === null) setError(reason instanceof Error ? reason.message : String(reason))
      })
      const sessionSpendRequest = fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      const todaySpendRequest = fetchLine(isCurrent, () => getTodaySpend(request > 0), setTodaySpend)
      const sessionsSpendRequest = fetchLine(isCurrent, () => getTodaySessionsSpend(request > 0), setSessionsSpend)
      // The refresh spinner covers the whole refresh, whatever settles last.
      void Promise.allSettled([balanceRequest, sessionSpendRequest, todaySpendRequest, sessionsSpendRequest]).then(() => {
        if (current) setRefreshing(false)
      })
    })
    return () => { current = false }
  }, [getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, request])

  // A turn settles: recompute this session's spend and today's spend across
  // every session. The balance is account-level and stays a manual snapshot —
  // never refetched here. The recompute is debounced so a burst of turns (an
  // agent continuing across turns) prices once instead of once per turn; the
  // host-side cache then serves the first miss for the rest of the minute.
  useEffect(() => {
    if (running === pricedRunningRef.current) return
    pricedRunningRef.current = running
    // A turn starting only arms the edge; the settle (running → false) prices.
    if (running) return
    let current = true
    const isCurrent = (): boolean => current
    const timer = setTimeout(() => {
      // Each spend line updates on its own: the slow all-session aggregate
      // does not delay the session line.
      void fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      void fetchLine(isCurrent, () => getTodaySpend(), setTodaySpend)
      void fetchLine(isCurrent, () => getTodaySessionsSpend(), setSessionsSpend)
    }, 2_000)
    return () => {
      clearTimeout(timer)
      current = false
    }
  }, [getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, running])

  // A pointer press outside the label box closes it.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  if (balance === null) {
    if (error === null) return null
    return (
      <Tooltip label={error} delayMs={500}>
        <button type="button" className={css.trigger} onClick={() => { setRequest(value => value + 1) }} aria-label={t('action.refresh')}>
          <span className={css.unavailable}>{t('state.unavailable')}</span>
          <IconRefreshOutline14 className={css.inlineIcon} />
        </button>
      </Tooltip>
    )
  }

  const refresh = (): void => { setRequest(value => value + 1) }

  const line = primaryLine(balance)
  const amount = line === undefined ? '—' : `${line.symbol}${line.total}`
  const spendLine = spend !== null && spend.models.length > 0
    ? t('trigger.conversationSpend', { amount: formatSpend(spend.total) })
    : undefined

  return (
    <div ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={t('badge.aria', { amount })}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.triggerLines}>
          <span className={css.linePrimary}>{t('trigger.balance', { amount })}</span>
          {spendLine !== undefined && <span className={css.lineSecondary}>{spendLine}</span>}
        </span>
        <IconChevronDownOutline14 className={open ? css.chevronOpen : undefined} />
      </button>
      {open
        ? (
          <div className={css.panel} role="dialog" aria-label={t('panel.aria')}>
            <div className={css.amountRow}>
              <span className={css.amountLabel}>{t('label.amount', { amount })}</span>
              <span className={css.amountActions}>
                <Tooltip label={t('info.hint')} delayMs={200} maxWidth={340}>
                  <button type="button" className={css.infoButton} aria-label={t('info.aria')}>
                    <IconQuestionOutline14 className={css.inlineIcon} />
                  </button>
                </Tooltip>
                <button
                  type="button"
                  className={css.refreshButton}
                  onClick={refresh}
                  aria-label={t('action.refresh')}
                  data-refreshing={refreshing || undefined}
                >
                  <IconRefreshOutline14 className={refreshing ? css.spinning : css.inlineIcon} />
                </button>
              </span>
            </div>
            <div className={css.spendRow}>
              <span className={css.amountLabel}>{t('label.sessionSpend', {
                amount: spend === null
                  ? '—'
                  : spend.models.length === 0
                    ? t('stat.none')
                    : formatSpend(spend.total),
              })}</span>
              <span className={css.amountLabel}>{t('label.todaySpend', {
                amount: todaySpend === null
                  ? '—'
                  : todaySpend.models.length === 0
                    ? t('stat.none')
                    : formatSpend(todaySpend.total),
              })}</span>
            </div>
            {spend?.models.map(model => (
              <Fragment key={model.model}>
                <div className={css.modelRow}>
                  <span className={css.modelName}>{model.displayName}</span>
                  <span className={css.tasks}>{formatSpend(model.cost)}</span>
                </div>
                <div className={css.costRow}>
                  <span className={css.costBreakdown}>
                    {t('label.cost.hit', { amount: formatSpend(model.cacheHitInputCost) })}
                    {' · '}
                    {t('label.cost.input', { amount: formatSpend(model.cacheMissInputCost) })}
                    {' · '}
                    {t('label.cost.output', { amount: formatSpend(model.outputCost) })}
                  </span>
                </div>
              </Fragment>
            ))}
            {sessionsSpend !== null && sessionsSpend.sessions.length > 0 && (
              <div className={css.ranking}>
                <div className={css.rankingTitle}>{t('label.sessionRanking')}</div>
                {sessionsSpend.sessions.slice(0, SESSION_RANKING_LIMIT).map((row, index) => (
                  <div key={row.sessionId} className={css.rankingRow}>
                    <span className={css.rankingIndex}>{index + 1}</span>
                    <span className={css.rankingDot} aria-hidden>{' · '}</span>
                    <span className={css.rankingName} title={row.title ?? undefined}>
                      {row.title ?? t('stat.untitled')}
                    </span>
                    <span className={css.rankingAmount}>{formatSpend(row.total)}</span>
                  </div>
                ))}
                {sessionsSpend.sessions.length > SESSION_RANKING_LIMIT && (
                  <div className={css.rankingMore}>
                    {t('label.sessionRanking.more', { count: sessionsSpend.sessions.length - SESSION_RANKING_LIMIT })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
        : null}
    </div>
  )
}
