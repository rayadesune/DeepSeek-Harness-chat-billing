/** Session-header billing badge: balance plus the current conversation's billed spend. */

import { Fragment, useEffect, useRef, useState } from 'react'
import type { DeepSeekBillingEstimate, DeepSeekSessionSpend } from '@deepseek-ai/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** Registration-side Remote face used by the header badge. */
export interface BalanceBadgeInjected {
  /** Read the account balance; rejects with the Remote error message. */
  getEstimate: () => Promise<DeepSeekBillingEstimate>
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
function primaryLine(estimate: DeepSeekBillingEstimate): { symbol: string; total: string } | undefined {
  const line = estimate.balance.lines[0]
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
 * @param props - Remote face, locale, and the standard session-header runtime share.
 * @returns the badge, or null while the first fetch is in flight.
 */
export function BalanceBadge({ getEstimate, getSessionSpend, sessionId, t }: BalanceBadgeProps) {
  const [estimate, setEstimate] = useState<DeepSeekBillingEstimate | null>(null)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    // A refresh (values already present) keeps the previous values on screen;
    // the first load has nothing to keep, so it stays on the loading render.
    setRefreshing(estimate !== null)
    void Promise.resolve().then(async () => {
      const [estimateResult, spendResult] = await Promise.allSettled([
        getEstimate(),
        getSessionSpend(sessionId),
      ])
      if (!current) return
      if (estimateResult.status === 'fulfilled') {
        setEstimate(estimateResult.value)
        setError(null)
      } else {
        // A refresh failure keeps the last good value instead of blanking it.
        const cause = estimateResult.reason
        if (estimate === null) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (spendResult.status === 'fulfilled') setSpend(spendResult.value)
      setRefreshing(false)
    })
    return () => { current = false }
  }, [getEstimate, getSessionSpend, sessionId, request])

  // A pointer press outside the label box closes it.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  if (estimate === null) {
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

  const line = primaryLine(estimate)
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
