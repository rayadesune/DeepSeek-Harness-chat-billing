/** Session-header billing badge: balance plus the current conversation's billed spend. */

import { Fragment, useEffect, useRef, useState } from 'react'
import type { DeepSeekBalance, DeepSeekSessionSpend } from '@deepseek-ai/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** Registration-side Remote face used by the header badge. */
export interface BalanceBadgeInjected {
  /** Read the account balance; rejects with the Remote error message. */
  getBalance: () => Promise<DeepSeekBalance>
  /** Read one session's billed spend; rejects with the Remote error message. */
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>
}

/** Full props assembled by the header utilities slot renderer. */
export type BalanceBadgeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<BalanceBadgeInjected>
  & PropsLocale<typeof NS>

/** Currency prefix for one balance line; unknown codes render as a literal prefix. */
function currencySymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/** The primary balance line, or undefined when the provider reports none. */
function primaryLine(balance: DeepSeekBalance): { symbol: string; total: string } | undefined {
  const line = balance.lines[0]
  if (line === undefined) return undefined
  return { symbol: currencySymbol(line.currency), total: line.total }
}

/** CNY amount, up to four decimals with trailing zeros trimmed. */
function formatSpend(amount: number): string {
  return `¥${amount.toFixed(4).replace(/\.?0+$/, '')}`
}

/**
 * Render the billing badge in the session-header utilities row. The trigger
 * shows the remaining balance and this conversation's billed spend and opens
 * a label box with the amount, this session's spend with its cache-hit /
 * cache-miss-input / output cost breakdown per model, a refresh action, and a
 * spend disclaimer. Refreshing keeps the last values visible rather than
 * blanking them.
 *
 * The spend follows the conversation: a new message in the current session
 * recomputes only the (local, network-free) session spend through
 * `getSessionSpend`; the balance stays a manual-refresh snapshot and is never
 * refetched on its own.
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null while the first fetch is in flight.
 */
export function BalanceBadge({ getBalance, getSessionSpend, sessionId, useSession, t }: BalanceBadgeProps) {
  const [balance, setBalance] = useState<DeepSeekBalance | null>(null)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // The in-window message count is the "new message" signal: it changes when a
  // message lands in the current session, letting the spend-only effect below
  // react without touching the account balance.
  const messageCount = useSession(snapshot => snapshot.chat.order.length)

  // The last message count this component already priced, so the spend-only
  // effect skips the initial mount (the mount effect already fetched).
  const pricedMessageCountRef = useRef(messageCount)

  useEffect(() => {
    let current = true
    // A refresh (values already present) keeps the previous values on screen;
    // the first load has nothing to keep, so it stays on the loading render.
    setRefreshing(balance !== null)
    void Promise.resolve().then(async () => {
      const [balanceResult, spendResult] = await Promise.allSettled([
        getBalance(),
        getSessionSpend(sessionId),
      ])
      if (!current) return
      if (balanceResult.status === 'fulfilled') {
        setBalance(balanceResult.value)
        setError(null)
      } else {
        // A refresh failure keeps the last good value instead of blanking it.
        const cause = balanceResult.reason
        if (balance === null) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (spendResult.status === 'fulfilled') setSpend(spendResult.value)
      setRefreshing(false)
    })
    return () => { current = false }
  }, [getBalance, getSessionSpend, sessionId, request])

  // A new message lands: recompute only this session's spend. The balance is
  // account-level and stays a manual snapshot — never refetched here.
  useEffect(() => {
    if (messageCount === pricedMessageCountRef.current) return
    pricedMessageCountRef.current = messageCount
    let current = true
    void Promise.resolve().then(async () => {
      const result = await getSessionSpend(sessionId)
      if (current) setSpend(result)
    })
    return () => { current = false }
  }, [getSessionSpend, sessionId, messageCount])

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
          </div>
        )
        : null}
    </div>
  )
}
