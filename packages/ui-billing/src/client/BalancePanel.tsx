/**
 * Session-header billing detail panel: the API-remaining row carrying today's
 * consumption measured from the balance series (see balanceDay.ts), today's
 * billed token count (the day's cache-hit share following it) and today's
 * spend across every session with the three TODAY
 * BUCKET modules under them (one two-line module per billing bucket: its token
 * count, then its cost, styled exactly like the per-model blocks further down),
 * this session's CONVERSATION spend (its own billed work plus the subagent
 * sessions it delegated, with its share of today beside it only when the two
 * disagree) and its cache-hit / cache-miss-input / output cost breakdown per
 * model, the ranking of today's sessions (one row per conversation — the host
 * has already merged each subagent session's spend into the session that
 * delegated it), a refresh action, and the spend disclaimer. Pure view — no
 * state, no effects; refreshing keeps the last values visible rather than
 * blanking them.
 */
import { Fragment } from 'react'
import type { DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconQuestionOutlineRegular, IconRefreshOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
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
 * and row order in both lines, so they read like the per-model breakdown line
 * further down and keep its own row rhythm. Each line stands on its own (no
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
  /** The session this panel belongs to: the row looked up in today's ranking. */
  sessionId: SessionId
  /** The WHOLE conversation's billed spend (this session plus the subagents it delegated). */
  spend: DeepSeekSessionSpend | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
  /** Whether this session is itself a delegated subagent child (so it has no ranking row of its own). */
  isSubagent: boolean
  /** Whether this session started on an earlier Beijing day (the only time a today share is shown). */
  crossedDay: boolean
  refreshing: boolean
  onRefresh: () => void
  t: PropsLocale<typeof NS>['t']
}

/** The detail box opened from the badge trigger. */
export function BalancePanel({ amount, balanceDaySpend, sessionId, spend, todaySpend, sessionsSpend, isSubagent, crossedDay, refreshing, onRefresh, t }: BalancePanelProps) {
  // This session's share of today rides the same all-session ranking read the
  // section below renders, so both numbers come from one host-side "today":
  // `undefined` while that read has not settled, and a confirmed `0` when it
  // settled without a row — the ranking lists only sessions that priced
  // something today.
  //
  // It reads the row's `total`, which counts the same thing as the amount on
  // the session line: the whole conversation (this session plus every subagent
  // session it delegated).
  //
  // WHETHER to show it is decided by the session's CREATION DAY, not by
  // comparing the two amounts: the session amount is live (the pushed
  // projection moves as the turn streams) while the ranking row is served from a
  // 60-second cache, so mid-turn the two routinely differ by a few cents — a
  // comparison would flash a parenthesis for a conversation that started today.
  // Only a session that started on an earlier Beijing day has a share worth
  // showing, and then it shows even when it billed nothing today (a confirmed
  // ¥0). A session that is ITSELF a delegated child shows none: its spend rides
  // the row of the top-level session that delegated it.
  const row = sessionsSpend === null ? undefined : sessionsSpend.sessions.find(entry => entry.sessionId === sessionId)
  const sessionToday = spend !== null && !isSubagent && crossedDay && sessionsSpend !== null
    ? row?.total ?? 0
    : null
  const sessionAmount = spend === null
    ? '—'
    : spend.models.length === 0
      ? t('stat.none')
      : formatSpendSignificant(spend.total)
  // The count is DSH's compact notation plus DSH's own ` tok` unit; the
  // placeholder states stay bare (no ` tok` after a `—`).
  const todayTokens = todaySpend === null
    ? '—'
    : todaySpend.models.length === 0
      ? t('stat.none')
      : t('unit.tokens', {
        count: formatTokens(todaySpend.models.reduce((sum, row) => sum + rowTokens(row), 0)),
      })
  const todayAmount = todaySpend === null
    ? '—'
    : todaySpend.models.length === 0
      ? t('stat.none')
      : formatSpendSignificant(todaySpend.total)
  // The day's cache-hit share rides the token figure bare — no parentheses, in
  // the same level-one style as the session row's today amount (see the
  // stylesheet's three type levels) — using DSH's own hit-rate rule (format.ts)
  // over the day's prompt-side buckets, so the number matches what the official
  // token surfaces would print. It shares the placeholder states' own condition:
  // a day that priced nothing has no ratio (and neither `—` nor `暂无消耗记录`
  // grows a figure of its own).
  const todayHit = todaySpend === null || todaySpend.models.length === 0
    ? null
    : cacheHitPercentOf(todaySpend)
  // A lone priced model renders no name row at all: in a session that only ever
  // billed one model the name says nothing new, and its amount IS the 本会话花费
  // figure on the row above. Its bucket line below still carries the whole split,
  // so nothing is lost; two or more models get a named row each.
  const modelCount = spend === null ? 0 : spend.models.length
  return (
    <div className={css.panel} role="dialog" aria-label={t('panel.aria')}>
      <div className={css.amountRow}>
        <span className={css.amountLabel}>
          {t('label.amount', { amount })}
          {/*
            Today's consumption from the balance series itself, riding the
            amount exactly the way the other two riders follow theirs: a bare
            amount in level-one type, no wording and no parentheses (the info
            hint names it). It renders only once today holds a sample for this
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
            `side="bottom"`: the DSH bubble's viewport fit only corrects the
            vertical axis for the bottom/top sides, so the (short) hint flips
            above the anchor instead of being clipped when it does not fit
            below — the right side would leave a tall bubble cut off.

            The label is a plain string (the primitive takes no JSX), so the
            version rides the hint text itself as its own last line
            (`\nv{version}`, with no blank line before it).
          */}
          <Tooltip label={t('info.hint', { version: PLUGIN_VERSION })} side="bottom" delayMs={200} maxWidth={300}>
            <button type="button" className={css.infoButton} aria-label={t('info.aria')}>
              <IconQuestionOutlineRegular size={14} className={css.inlineIcon} />
            </button>
          </Tooltip>
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
        per-model cost row's typography and spacing.
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
      <div className={css.spendRow}>
        <span className={css.amountLabel}>
          {t('label.sessionSpend', { amount: sessionAmount })}
          {sessionToday !== null
            ? (
              <span className={css.sessionToday}>
                {t('label.sessionSpend.today', { amount: formatSpendSignificant(sessionToday) })}
              </span>
            )
            : null}
        </span>
      </div>
      {spend?.models.map(model => (
        <Fragment key={model.model}>
          {modelCount > 1 && (
            <div className={css.modelRow}>
              <span className={css.modelName}>{model.displayName}</span>
              <span className={css.tasks}>{formatSpendSignificant(model.cost)}</span>
            </div>
          )}
          <div className={css.costRow}>
            <span className={css.costBreakdown}>
              {/* DSH's own bucket wording and row order (ui-chat's token
                  dialog): uncached input, cached input, output. */}
              {t('label.cost.input', { amount: formatSpendSignificant(model.cacheMissInputCost) })}
              {' · '}
              {t('label.cost.cacheRead', { amount: formatSpendSignificant(model.cacheHitInputCost) })}
              {' · '}
              {t('label.cost.output', { amount: formatSpendSignificant(model.outputCost) })}
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
