/**
 * Composer spend pill: the billing mark (this package's own ring-and-sparkle
 * glyph, reduced for the composer's 14px tier) plus the amount, in the
 * composer's stat row, opening this conversation's billed-cost card. The card
 * reproduces DSH's own token-usage dialog skin row for row (same surface,
 * radius, elevation, title rule, and right-aligned tabular amounts) with the
 * spend's three billing buckets where that card shows its token buckets:
 * uncached input, cache read, output.
 *
 * The pill's main amount is the MAIN session's spend — the same caliber the
 * official composer pill counts tokens in — with the subagent sessions this
 * conversation delegated broken out after it as a ` · ` rider (the official
 * pill's own cache-hit rider format) and as the card's fourth row. Nothing
 * merges the two halves into one figure any more: the total the card heads
 * with is the sum of its four rows, and a pill with no subagent spend renders
 * exactly as it did before the rider existed.
 *
 * The amounts ride the host-pushed `billingTodaySpend` projection, so the pill
 * is live with zero Remote calls; `billing/getSessionSpend` is the fallback for
 * an assembly whose projection registry is absent (the same ladder the header
 * badge walks in `useBillingData`), and `billing/getDelegatedSpend` reads the
 * subagent subtotal the rider and the fourth row report.
 * @module @rayadesu/dsh-client-ui-billing/SpendCard
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeepSeekDelegatedSpend, DeepSeekSessionSpend } from '@rayadesu/dsh-llm-billing/types'
// Type-only: merges the host's `billingTodaySpend` key into SessionProjectionMap,
// which is what types the `useProjection` read below.
import type {} from '@rayadesu/dsh-llm-billing/projection'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { formatSpendSignificant } from './format.ts'
import { BillingMarkIcon } from './icons.tsx'
import { NS } from './locales.ts'
import { spendBucketsOf } from './spendBuckets.ts'
import { TURN_SETTLE_DEBOUNCE_MS } from './useBillingData.ts'
import { MEASURE_STYLE, useCardDialog } from './useCardDialog.ts'
import css from './SpendCard.module.css'

/**
 * The middot that separates the pill's two segments. It renders inside a
 * `sep`-classed span (see the JSX and `SpendCard.module.css`) so it carries
 * ui-chat's official separator colour and 6px inset rather than sitting tight
 * against the amounts as a bare text run would.
 */
const DOT_SEPARATOR = '·'

/** Injected face: this conversation's priced spend and its subagent subtotal. */
export interface SpendCardInjected {
  /** Read one session's billed spend across its own events (Remote fallback). */
  getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>
  /**
   * Read the subagent part of one conversation's billed spend: every subagent
   * session it delegated, transitively, across every day. The pill's ` ·`
   * rider and the card's fourth row report it, next to — never merged into —
   * the main session amount. `force` bypasses the host-side cache — the
   * turn-settled read passes it.
   */
  getDelegatedSpend: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend>
}

/**
 * Full props of the composer spend entry. The owner share arrives from
 * ui-conversation's declared `conversation.composer.dock` list slot (it passes
 * no owner values); the session runtime share adds the identity, the session
 * selector, and the projection reader, as it does for every session-scoped slot.
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
 * The pill is an inline flex item of DSH's composer stat row, so it sits beside
 * the built-in time/token pills (see SpendCard.module.css); its glyph, tone,
 * typography, and hover fill are copied from those pills. The main amount is
 * this session's own billed spend, with the subagent sessions it delegated
 * riding after it as a ` · 子会话 ￥…` segment — and a session that priced
 * nothing itself and delegated nothing priced renders no entry at all.
 * @param props - the session identity, the runtime hooks, the Remote face, and the locale seat.
 * @returns the pill plus its portaled card, or null when there is nothing to show.
 */
export function SpendCard({ sessionId, useSession, useProjection, getSessionSpend, getDelegatedSpend, t }: SpendCardProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useCardDialog()
  const projected = useProjection('billingTodaySpend')
  // Fallback path only: with the projection composed, this state never fills.
  const [fallback, setFallback] = useState<DeepSeekSessionSpend | null>(null)
  // The last settled subagent subtotal; `null` until one lands, and a failed
  // read keeps the previous value instead of dropping the amount back to this
  // session's own spend alone.
  const [delegated, setDelegated] = useState<DeepSeekDelegatedSpend | null>(null)

  // The turn-settled effect below reads whether the projection is composed
  // without subscribing to it: a projection value landing mid-debounce must not
  // re-run that effect and cancel the armed settle read.
  const projectedRef = useRef(projected)
  projectedRef.current = projected

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

  // The delegated subtotal is a session-level read, like the badge's: on mount
  // and on a session switch. It reads plainly (no `force`) — the host serves
  // what it holds and refreshes behind the answer — while the turn-settled
  // effect below forces.
  useEffect(() => {
    let current = true
    void Promise.resolve()
      .then(() => getDelegatedSpend(sessionId))
      .then(
        (value) => { if (current) setDelegated(value) },
        () => {},
      )
    return () => { current = false }
  }, [getDelegatedSpend, sessionId])

  // The running flag is the "turn settled" signal, exactly as it is for the
  // badge: it flips true when a prompt turn starts and false when the turn
  // ends. The settle read FORCES, because the turn just priced its own usage —
  // a cached answer is the pre-turn figure, which would leave the pill one turn
  // behind the badge's own line. The debounce matches the badge's, so a burst of
  // turns (an agent continuing across turns) prices once.
  const running = useSession(snapshot => snapshot.running)
  // The last running state already priced, so this effect skips the initial
  // mount (the mount effect already fetched).
  const pricedRunningRef = useRef(running)
  useEffect(() => {
    if (running === pricedRunningRef.current) return
    pricedRunningRef.current = running
    // A turn starting only arms the edge; the settle (running → false) prices.
    if (running) return
    let current = true
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => getDelegatedSpend(sessionId, true))
        .then(
          (value) => { if (current) setDelegated(value) },
          () => {},
        )
      // A projection-less assembly is served by the fallback state, which no
      // push updates: re-read it in the same beat (the badge's own settle read
      // of `getSessionSpend` is plain too).
      if (projectedRef.current === undefined) {
        void Promise.resolve()
          .then(() => getSessionSpend(sessionId))
          .then(
            (value) => { if (current) setFallback(value) },
            () => {},
          )
      }
    }, TURN_SETTLE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      current = false
    }
  }, [getDelegatedSpend, getSessionSpend, sessionId, running])

  // This session's own billed spend: the pushed projection wins over the Remote
  // snapshot when present, because it is already current for this session and
  // costs no round trip.
  const own = projected === undefined ? fallback : projected.session
  // The pill's main amount is the MAIN session's spend only — the same caliber
  // the official composer pill counts tokens in (a session's own usage, no
  // delegation rolled in). The subagent sessions this conversation delegated
  // are the RIDER after it (` · 子会话 ￥…`), the same ` · `-separated second
  // segment the official pill uses for its cache-hit share, and the card's
  // fourth row — never folded into the main figure or the three buckets.
  const delegatedTotal = delegated?.total ?? 0
  const ownPriced = own !== null && own.models.length > 0
  // Hooks stay above the early return: a session that later prices something
  // must not mount a different hook sequence than one that never did.
  const buckets = useMemo(() => (own === null ? null : spendBucketsOf(own)), [own])
  // No priced row anywhere means nothing was billed here (no DeepSeek/MiMo
  // usage, or the Remote failed): no pill, no card. A model row that priced to
  // zero still shows, so "priced ¥0" never reads as "not priced yet".
  if (buckets === null || own === null || (!ownPriced && delegatedTotal <= 0)) return null
  const ownText = ownPriced ? formatSpendSignificant(buckets.total) : undefined
  // The rider carries its `label.subagent` prefix (`子会话`) so the pill's
  // visible text and its aria-label describe the same two segments — a bare
  // amount in the aria would drop the word that names what the figure is.
  const subAmount = delegatedTotal > 0 ? formatSpendSignificant(delegatedTotal) : undefined
  const delegatedText = subAmount === undefined ? undefined : t('label.subagent', { amount: subAmount })
  // The two segments are joined by the official pill's own separator: a
  // middot inside a `sep` span (`ui-chat`'s `StatsPills.module.css`), which
  // colours it with `--dsw-alias-separator-primary` and insets it
  // `margin: 0 6px`. A bare ` · ` text run sits too tight and inherits the
  // amount's tone, so the pill would not match its official neighbours.
  const aria = [ownText, delegatedText]
    .filter(value => value !== undefined)
    .join(` ${DOT_SEPARATOR} `)
  const heading = formatSpendSignificant(buckets.total + delegatedTotal)
  return (
    <div className={css.root} data-spend-card>
      <span ref={rootRef} className={css.anchor}>
        <button
          type="button"
          className={css.pill}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('card.aria', { amount: aria })}
          onClick={() => { setOpen(!open) }}
        >
          <BillingMarkIcon size={14} />
          <span className={css.label}>
            {ownText}
            {delegatedText !== undefined && (
              <>
                <span className={css.sep} aria-hidden>{DOT_SEPARATOR}</span>
                {/* `delegatedText` already carries the `label.subagent` prefix
                    (the pill and its aria-label share that one string), so it
                    renders verbatim — wrapping it in `t()` again doubled the
                    `子会话` word. */}
                {delegatedText}
              </>
            )}
          </span>
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
                <BillingMarkIcon size={14} />
                {t('card.title')}
              </span>
              <span className={css.titleValue}>{heading}</span>
            </div>
            <div className={css.titleRule} aria-hidden />
            <dl className={css.details} data-spend-buckets>
              {/*
                The subagent subtotal leads, so a reader sees the delegation
                cost before this session's own three buckets; the four rows
                still sum to the total the card heads with.
              */}
              {subAmount !== undefined && (
                <Row label={t('label.bucket.subagent')} value={subAmount} />
              )}
              <Row label={t('label.bucket.input')} value={formatSpendSignificant(buckets.uncachedInput)} />
              <Row label={t('label.bucket.cacheRead')} value={formatSpendSignificant(buckets.cacheRead)} />
              <Row label={t('label.bucket.output')} value={formatSpendSignificant(buckets.output)} />
            </dl>
          </div>,
          document.body,
        )}
      </span>
    </div>
  )
}
