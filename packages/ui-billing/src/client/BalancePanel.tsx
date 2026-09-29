/**
 * Session-header billing detail panel: the API-remaining row carrying today's
 * consumption measured from the balance series (see balanceDay.ts), today's
 * billed token count (the day's cache-hit share following it) and today's
 * spend across every session with the three TODAY
 * BUCKET modules under them (two lines: the buckets' token counts, then their
 * costs), the pricing-gap notice that names the wire models
 * today's fold could not price, the ranking of today's sessions (one row per
 * conversation — the host has already merged each subagent session's spend into
 * the session that delegated it), a refresh action, and the spend disclaimer.
 * Pure view — no state, no effects; refreshing keeps the last values visible
 * rather than blanking them.
 *
 * The CONVERSATION's own spend is deliberately absent: it belongs to the
 * composer spend pill, so every figure here is account-level — the day's, not
 * this session's.
 */
import type { DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import { HoverCard, IconQuestionOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatSpendSignificant, formatTokens, rowTokens } from './format.ts'
import { spendBucketsOf, cacheHitPercentOf, tokenBucketsOf } from './spendBuckets.ts'
import { NS } from './locales.ts'
import { PLUGIN_VERSION } from './version.ts'
import css from './BalanceBadge.module.css'

/**
 * How many per-session ranking rows the panel shows before the overflow hint.
 */
export const SESSION_RANKING_LIMIT = 10

/**
 * Today's two bucket detail lines, rendered under the 今日 Token / 今日花费 row:
 * the three buckets' token counts, then their costs — DSH's own bucket wording
 * and row order in both lines, in the panel's own breakdown typography and row
 * rhythm (the pricing-gap notice reuses it). Each line stands on its own (no
 * column alignment between them): the middots keep the natural " · " spacing of
 * every other breakdown line in the panel.
 *
 * Tokens and costs come from the SAME day row set (`todaySpend.models`) the row
 * above is built from: the three token counts add up to the token figure, and
 * the three costs (with `spendBucketsOf`'s residual absorbed into the largest
 * bucket) to the cost figure. Costs render at three significant digits, like the
 * day figure above them, and never finer than four decimals — their last digits
 * move with every request and carry no meaning.
 */
function todayBucketLines(
  t: PropsLocale<typeof NS>['t'],
  spend: DeepSeekTodaySpend,
): { tokenLine: string; costLine: string } {
  const tokens = tokenBucketsOf(spend)
  const costs = spendBucketsOf(spend)
  return {
    tokenLine: [
      `${t('label.bucket.input')} ${t('unit.tokens', { count: formatTokens(tokens.uncachedInput) })}`,
      `${t('label.bucket.cacheRead')} ${t('unit.tokens', { count: formatTokens(tokens.cacheRead) })}`,
      `${t('label.bucket.output')} ${t('unit.tokens', { count: formatTokens(tokens.output) })}`,
    ].join(' · '),
    costLine: [
      t('label.cost.input', { amount: formatSpendSignificant(costs.uncachedInput) }),
      t('label.cost.cacheRead', { amount: formatSpendSignificant(costs.cacheRead) }),
      t('label.cost.output', { amount: formatSpendSignificant(costs.output) }),
    ].join(' · '),
  }
}

/**
 * The hint card's body: every line of `info.hint` as its own row, then the
 * version below them at the metadata weight instead of the prose's.
 *
 * The two levels are restated rather than referenced — the panel defines them
 * as custom properties on `.panel`, and the card is portaled to
 * `document.body`, outside that subtree, so nothing inherits from it. Their
 * values match the panel's own second and first levels exactly, which keeps
 * this notice in the same type family as everything beside it.
 */
function HintCard({ t }: { t: PropsLocale<typeof NS>['t'] }) {
  const lines = t('info.hint', { version: PLUGIN_VERSION }).split('\n')
  return (
    <div className={css.hint}>
      {lines.slice(0, -1).map(line => <div key={line} className={css.hintLine}>{line}</div>)}
      <div className={css.hintVersion}>{lines[lines.length - 1]}</div>
    </div>
  )
}

/** Panel props: precomputed amount plus the same spend values the badge holds. */
export interface BalancePanelProps {
  /** Primary balance line, e.g. `¥123.45`; `—` when the provider reports none. */
  amount: string
  /**
   * Today's consumption measured from the balance series itself (the
   * `balanceDay.ts` caliber), riding the amount; `null` before today's first
   * sample for the amount's currency, which renders no rider at all.
   */
  balanceDaySpend: number | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
  /**
   * Whether the balance read failed. The panel's first row is then the short
   * actionable `notice.unavailable`; the Remote's verbatim message is NOT
   * rendered here (it is English transport prose, and the chip's accessible
   * name already carries it).
   */
  unavailable?: boolean | undefined
  /**
   * The other empty balance: the API answered and named no spendable balance.
   * A complete sentence of its own (`notice.none`), not a message to wrap, and
   * it renders as the same first row — this is the only reason the headline
   * above it reads `—`.
   */
  balanceNote?: string | undefined
  refreshing: boolean
  onRefresh: () => void
  t: PropsLocale<typeof NS>['t']
}

/** The detail box opened from the badge trigger. */
export function BalancePanel({ amount, balanceDaySpend, todaySpend, sessionsSpend, unavailable, balanceNote, refreshing, onRefresh, t }: BalancePanelProps) {
  // The count is DSH's compact notation plus DSH's own ` tok` unit; the
  // placeholder states stay bare (no ` tok` after a `—`).
  const todayTokens = todaySpend === null
    ? '—'
    : todaySpend.models.length === 0
      ? todaySpend.unpriced === undefined ? t('stat.none') : t('stat.unpricedOnly')
      : t('unit.tokens', {
        count: formatTokens(todaySpend.models.reduce((sum, row) => sum + rowTokens(row), 0)),
      })
  const todayAmount = todaySpend === null
    ? '—'
    : todaySpend.models.length === 0
      // Two empties that look identical in a figure: nothing was measured, or
      // usage was measured and matched no rate. Only the second is actionable,
      // so it must never borrow the first's wording.
      ? todaySpend.unpriced === undefined ? t('stat.none') : t('stat.unpricedOnly')
      : formatSpendSignificant(todaySpend.total)
  // The day's cache-hit share rides the token figure bare — no parentheses, in
  // the same level-one style as the amount rider (see the
  // stylesheet's three type levels) — using DSH's own hit-rate rule (format.ts)
  // over the day's prompt-side buckets, so the number matches what the official
  // token surfaces would print. It shares the placeholder states' own condition:
  // a day that priced nothing has no ratio (and neither `—` nor `暂无消耗记录`
  // grows a figure of its own).
  const todayHit = todaySpend === null || todaySpend.models.length === 0
    ? null
    : cacheHitPercentOf(todaySpend)
  // Today's pricing gap, NAMED: the wire models whose usage has no rate row. A
  // figure that silently omits them invites no doubt — which is exactly the
  // failure being fixed here. Nothing is ever priced by a guessed rate.
  const todayNotices = todaySpend === null || todaySpend.unpriced === undefined
    ? []
    : [t('notice.unpriced', { models: todaySpend.unpriced.models.join(', ') })]
  return (
    <div className={css.panel} role="dialog" aria-label={t('panel.aria')}>
      {/*
        The failure row is FIRST, above the headline it explains: the headline
        reads `—`, and the reason it does must precede the figure rather than
        trail it. It reuses the notice row's own typography and rhythm (the
        pricing-gap row below is the same family), so the panel grows no new
        type level for it.
      */}
      {(unavailable === true || balanceNote !== undefined) && (
        <div className={css.dayBucketRow}>
          <span className={css.costBreakdown}>
            {unavailable === true ? t('notice.unavailable') : balanceNote}
          </span>
        </div>
      )}
      <div className={css.amountRow}>
        <span className={css.amountLabel}>
          {t('label.amount', { amount })}
          {/*
            Today's consumption from the balance series itself, riding the
            amount the way the day's cache-hit share rides the token figure: a
            bare amount in level-one type, no wording and no parentheses (the
            info hint names it). It renders only once today holds a sample for this
            currency — a figure nothing measured stays away rather than reading
            as ¥0.
          */}
          {balanceDaySpend !== null
            ? (
              <span className={css.amountToday}>
                {t('label.amount.todaySpend', { amount: formatSpendSignificant(balanceDaySpend) })}
              </span>
            )
            : null}
        </span>
        <span className={css.amountActions}>
          {/*
            The hint is a HOVER CARD, not a tooltip, because it is a notice
            rather than a label: DSH's `Tooltip` is built for one short line —
            `padding: 3px 7px`, `pointer-events: none`, and a `string` label
            that admits no second type size — so a four-line notice dropped
            into it renders as an edge-to-edge slab whose build stamp reads at
            the same weight as the caliber above it. `HoverCard` takes JSX,
            keeps the pointer on the card so a notice this long can actually be
            read and selected, and portals its card to `document.body` on its
            own — which is also what escapes this panel's `backdrop-filter`
            (the trap that stranded the old bubble off-screen; see AGENTS.md).

            `inline` is the variant this row needs: it stays in the line box
            (the others are `display: block`) and it answers the keyboard —
            focus-visible opens it and Escape closes it — while its placement
            clamps into the viewport. `compact` would lay the card to the RIGHT
            of the anchor, off-screen for a button parked this close to the
            corner, and `preview` wants a measured width anchor, which would
            mean handing this purely-presentational view a ref.

            The lines stay one locale string (`\n`-separated) so the four-line
            contract stays visible in the dictionaries; HintCard splits it.
          */}
          <HoverCard
            openDelayMs={200}
            inline
            anchor={(
              <button type="button" className={css.infoButton} aria-label={t('info.aria')}>
                <IconQuestionOutlineRegular size={14} className={css.inlineIcon} />
              </button>
            )}
            content={<HintCard t={t} />}
          />
          <button
            type="button"
            className={css.refreshButton}
            onClick={onRefresh}
            aria-label={t('action.refresh')}
            data-refreshing={refreshing || undefined}
          >
            <IconRefreshOutlineRegular size={14} className={refreshing ? css.spinning : css.inlineIcon} />
          </button>
        </span>
      </div>
      <div className={css.spendRow}>
        <span className={css.amountLabel}>
          {t('label.todayTokens', { count: todayTokens })}
          {todayHit !== null
            ? (
              <span className={css.todayHit}>
                {t('label.todayTokens.hit', { percent: todayHit })}
              </span>
            )
            : null}
        </span>
        <span className={css.amountLabel}>{t('label.todaySpend', { amount: todayAmount })}</span>
      </div>
      {/*
        Today's two detail lines, right under the figures they explain: the
        three buckets' tokens, then their costs — each line on its own, in the
        panel's breakdown typography and spacing.
      */}
      {todaySpend !== null && todaySpend.models.length > 0 && (
        <>
          <div className={css.dayBucketRow}>
            <span className={css.costBreakdown}>{todayBucketLines(t, todaySpend).tokenLine}</span>
          </div>
          <div className={css.dayBucketRow}>
            <span className={css.costBreakdown}>{todayBucketLines(t, todaySpend).costLine}</span>
          </div>
        </>
      )}
      {todayNotices.length > 0 && todayNotices.map(notice => (
        <div className={css.dayBucketRow} key={notice}>
          <span className={css.costBreakdown}>{notice}</span>
        </div>
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
              <span className={css.rankingAmount}>{formatSpendSignificant(row.total)}</span>
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
}
