/**
 * Composer spend card: the money-bag pill under the input box that opens this
 * conversation's billed-cost card. The card reproduces DSH's own token-usage
 * dialog skin row for row (same surface, radius, elevation, title rule, and
 * right-aligned tabular amounts) with the spend's three billing buckets where
 * that card shows its token buckets: uncached input, cache read, output.
 *
 * The amounts ride the host-pushed `billingTodaySpend` projection, so the card
 * is live with zero Remote calls; `billing/getSessionSpend` is the fallback for
 * an assembly whose projection registry is absent (the same ladder the header
 * badge walks in `useBillingData`).
 * @module @rayadesu/dsh-client-ui-billing/SpendCard
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeepSeekSessionSpend } from '@rayadesu/dsh-llm-billing/types'
// Type-only: merges the host's `billingTodaySpend` key into SessionProjectionMap,
// which is what types the `useProjection` read below.
import type {} from '@rayadesu/dsh-llm-billing/projection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatSpend } from './format.ts'
import { WalletIcon } from './icons.tsx'
import { NS } from './locales.ts'
import { spendBucketsOf } from './spendBuckets.ts'
import { MEASURE_STYLE, useCardDialog } from './useCardDialog.ts'
import css from './SpendCard.module.css'

/** Injected face: this conversation's priced spend, for the projection-less fallback. */
export interface SpendCardInjected {
  /** Read one session's billed spend across its own events (Remote fallback). */
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>
}

/**
 * Full props of the composer spend entry. The owner share arrives from
 * ui-conversation's declared `conversation.composer.dock` list slot (it passes
 * no owner values); the session runtime share adds the identity and the
 * projection reader, as it does for every session-scoped slot.
 */
export type SpendCardProps =
  PropsRuntime<'conversation.composer.dock'>
  & InjectFace<SpendCardInjected>
  & PropsLocale<typeof NS>

/** One row of the card's detail grid (a dt/dd pair of the same dl). */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

/**
 * Render the composer spend pill, and the cost card it opens.
 *
 * The pill mirrors DSH's own composer stat pills (14px glyph, tertiary tone,
 * tabular amount, hover pill) in its own row under the input box, because the
 * composer dock is a list slot whose entries the composer stacks. A session
 * that priced nothing renders no row at all.
 * @param props - the session identity, the projection reader, the Remote fallback, and the locale seat.
 * @returns the pill plus its portaled card, or null when there is nothing to show.
 */
export function SpendCard({ sessionId, useProjection, getSessionSpend, t }: SpendCardProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useCardDialog()
  const projected = useProjection('billingTodaySpend')
  // Fallback path only: with the projection composed, this state never fills.
  const [fallback, setFallback] = useState<DeepSeekSessionSpend | null>(null)

  useEffect(() => {
    if (projected !== undefined) return
    let current = true
    void Promise.resolve()
      .then(() => getSessionSpend(sessionId))
      .then(
        (value) => { if (current) setFallback(value) },
        () => { if (current) setFallback(null) },
      )
    return () => { current = false }
  }, [getSessionSpend, projected, sessionId])

  // The projection's `session` bucket is the session's OWN events across every
  // day — the same quantity the header badge's "本轮对话花费" line shows.
  const spend = projected?.session ?? fallback
  // Hooks stay above the early return: a session that later prices something
  // must not mount a different hook sequence than one that never did.
  const buckets = useMemo(() => (spend === null ? null : spendBucketsOf(spend)), [spend])
  // No priced row means nothing was billed here (no DeepSeek/MiMo usage, or the
  // Remote failed): no pill, no card. A model row that priced to zero still
  // shows, so "priced ¥0" never reads as "not priced yet".
  if (buckets === null || (spend !== null && spend.models.length === 0)) return null
  const totalText = formatSpend(buckets.total)
  return (
    <div className={css.root} data-composer-stats data-spend-card>
      <span ref={rootRef} className={css.anchor}>
        <button
          type="button"
          className={css.pill}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('card.aria', { amount: totalText })}
          onClick={() => { setOpen(!open) }}
        >
          <WalletIcon size={14} />
          <span className={css.label}>{totalText}</span>
        </button>
        {open && createPortal(
          <div
            ref={panelRef}
            className={css.panel}
            role="dialog"
            aria-label={t('card.title')}
            style={pos ?? MEASURE_STYLE}
          >
            <div className={css.title}>
              <span className={css.titleLabel}>
                <WalletIcon size={14} />
                {t('card.title')}
              </span>
              <span className={css.titleValue}>{totalText}</span>
            </div>
            <div className={css.titleRule} aria-hidden />
            <dl className={css.details} data-spend-buckets>
              <Row label={t('label.bucket.input')} value={formatSpend(buckets.uncachedInput)} />
              <Row label={t('label.bucket.cacheRead')} value={formatSpend(buckets.cacheRead)} />
              <Row label={t('label.bucket.output')} value={formatSpend(buckets.output)} />
            </dl>
          </div>,
          document.body,
        )}
      </span>
    </div>
  )
}
