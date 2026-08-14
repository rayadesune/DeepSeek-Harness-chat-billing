/** Session-header billing badge: balance plus per-model remaining-task estimates. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DeepSeekBillingEstimate } from '@deepseek-ai/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** Registration-side Remote face used by the header badge. */
export interface BalanceBadgeInjected {
  /** Read the balance plus per-model task projections; rejects with the Remote error message. */
  getEstimate: () => Promise<DeepSeekBillingEstimate>
  /** Read the session's current model id; null while unknown. */
  getCurrentModel: (sessionId: SessionId) => string | null
  /** Subscribe to the session's model directory; loads it lazily and returns an unsubscribe. */
  subscribeCurrentModel: (sessionId: SessionId, listener: () => void) => () => void
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

/**
 * Render the billing badge in the session-header utilities row. The trigger
 * shows the remaining balance and the current model's remaining-task estimate
 * and opens a label box with the amount, a refresh action, an estimate
 * disclaimer, and one remaining-task line per model. Refreshing keeps the last
 * value visible rather than blanking it.
 * @param props - Remote face, current-model access, locale, and the standard session-header runtime share.
 * @returns the badge, or null while the first fetch is in flight.
 */
export function BalanceBadge({ getEstimate, getCurrentModel, subscribeCurrentModel, sessionId, t }: BalanceBadgeProps) {
  const [estimate, setEstimate] = useState<DeepSeekBillingEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const currentModel = useSyncExternalStore(
    listener => subscribeCurrentModel(sessionId, listener),
    () => getCurrentModel(sessionId),
  )

  useEffect(() => {
    let current = true
    // A refresh (estimate already present) keeps the previous value on screen;
    // the first load has nothing to keep, so it stays on the loading render.
    setRefreshing(estimate !== null)
    void Promise.resolve().then(() => getEstimate()).then(
      (value) => {
        if (!current) return
        setEstimate(value)
        setError(null)
        setRefreshing(false)
      },
      (cause: unknown) => {
        if (!current) return
        // A refresh failure keeps the last good value instead of blanking it.
        if (estimate === null) setError(cause instanceof Error ? cause.message : String(cause))
        setRefreshing(false)
      },
    )
    return () => { current = false }
  }, [getEstimate, request])

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
  const currentEstimate = currentModel === null
    ? undefined
    : estimate.models.find(model => model.model === currentModel)
  const tasksLine = currentEstimate === undefined || currentEstimate.tasksRemaining === null
    ? undefined
    : currentEstimate.tasksRemaining === 0
      ? t('trigger.tasks.short')
      : t('trigger.tasks', { count: currentEstimate.tasksRemaining })

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
          {tasksLine !== undefined && <span className={css.lineSecondary}>{tasksLine}</span>}
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
            {estimate.models.map(model => (
              <div className={css.modelRow} key={model.model}>
                <span className={css.modelName}>{model.displayName}</span>
                <span className={css.tasks}>
                  {model.tasksRemaining === null
                    ? t('stat.none')
                    : model.tasksRemaining === 0
                      ? t('label.tasks.insufficient')
                      : t('label.tasks', { count: model.tasksRemaining })}
                </span>
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}
