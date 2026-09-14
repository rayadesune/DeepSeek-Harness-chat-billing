/**
 * Session-header billing detail panel: the API-remaining row, today's billed
 * token count and today's spend across every session, this session's spend
 * (with this session's share of today beside it only when the two disagree)
 * and its cache-hit / cache-miss-input / output cost breakdown per model, the
 * ranking of today's sessions (one row per conversation — the host has already
 * merged each subagent session's spend into the session that delegated it), a
 * refresh action, and the spend disclaimer. Pure view — no state, no effects;
 * refreshing keeps the last values visible rather than blanking them.
 */
import { Fragment } from 'react'
import type { DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatSpend, formatTokens, rowTokens } from './format.ts'
import { NS } from './locales.ts'
import { PLUGIN_VERSION } from './version.ts'
import css from './BalanceBadge.module.css'

/**
 * How many per-session ranking rows the panel shows before the overflow hint.
 */
export const SESSION_RANKING_LIMIT = 10

/**
 * Tolerance for "the session total and its share of today are the same number".
 * Both are sums of the same priced samples, so a same-day session yields
 * bit-identical floats; the slack only absorbs the accumulation-order noise a
 * float sum can pick up on the way (a 1e-9 CNY difference is not a real one).
 */
const SPEND_SAME_EPSILON = 1e-9

/** Panel props: precomputed amount plus the same spend values the badge holds. */
export interface BalancePanelProps {
  /** Primary balance line, e.g. `¥123.45`; `—` when the provider reports none. */
  amount: string
  /** The session this panel belongs to: the row looked up in today's ranking. */
  sessionId: SessionId
  spend: DeepSeekSessionSpend | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
  refreshing: boolean
  onRefresh: () => void
  t: PropsLocale<typeof NS>['t']
}

/** The detail box opened from the badge trigger. */
export function BalancePanel({ amount, sessionId, spend, todaySpend, sessionsSpend, refreshing, onRefresh, t }: BalancePanelProps) {
  // This session's share of today rides the same all-session ranking read the
  // section below renders, so both numbers come from one host-side "today":
  // `undefined` while that read has not settled, and a confirmed `0` when it
  // settled without a row — the ranking lists only sessions that priced
  // something today.
  //
  // It reads the row's `ownTotal`, NOT its `total`: a row's total also carries
  // the spend of every subagent session this one delegated (those rows are
  // merged into it), while the amount beside this one is this session's own
  // billed spend. Comparing like with like is what keeps the parenthesized
  // number "the part of the amount beside it that fell on today".
  const sessionToday = sessionsSpend === null
    ? undefined
    : sessionsSpend.sessions.find(row => row.sessionId === sessionId)?.ownTotal ?? 0
  // The share is shown ONLY when it disagrees with the whole-session amount:
  // a session that has not crossed a Beijing day bills exactly its own total
  // today, so the parenthesized number would just repeat the one beside it.
  // An unsettled ranking cannot prove a disagreement, so it renders nothing.
  const sessionTodayShare = spend !== null
    && sessionToday !== undefined
    && Math.abs(spend.total - sessionToday) > SPEND_SAME_EPSILON
    ? sessionToday
    : null
  const sessionAmount = spend === null
    ? '—'
    : spend.models.length === 0
      ? t('stat.none')
      : formatSpend(spend.total)
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
      : formatSpend(todaySpend.total)
  return (
    <div className={css.panel} role="dialog" aria-label={t('panel.aria')}>
      <div className={css.amountRow}>
        <span className={css.amountLabel}>{t('label.amount', { amount })}</span>
        <span className={css.amountActions}>
          {/*
            `side="bottom"`: the DSH bubble's viewport fit only corrects the
            vertical axis for the bottom/top sides, so the (short) hint flips
            above the anchor instead of being clipped when it does not fit
            below — the right side would leave a tall bubble cut off.

            The label is a plain string (the primitive takes no JSX), so the
            version rides the hint text itself as its own line after a blank
            one (`\n\nv{version}`).
          */}
          <Tooltip label={t('info.hint', { version: PLUGIN_VERSION })} side="bottom" delayMs={200} maxWidth={300}>
            <button type="button" className={css.infoButton} aria-label={t('info.aria')}>
              <IconQuestionOutline14 className={css.inlineIcon} />
            </button>
          </Tooltip>
          <button
            type="button"
            className={css.refreshButton}
            onClick={onRefresh}
            aria-label={t('action.refresh')}
            data-refreshing={refreshing || undefined}
          >
            <IconRefreshOutline14 className={refreshing ? css.spinning : css.inlineIcon} />
          </button>
        </span>
      </div>
      <div className={css.spendRow}>
        <span className={css.amountLabel}>{t('label.todayTokens', { count: todayTokens })}</span>
        <span className={css.amountLabel}>{t('label.todaySpend', { amount: todayAmount })}</span>
      </div>
      <div className={css.spendRow}>
        <span className={css.amountLabel}>
          {t('label.sessionSpend', { amount: sessionAmount })}
          {sessionTodayShare !== null
            ? (
              <span className={css.spendToday}>
                {t('label.sessionSpend.today', { amount: formatSpend(sessionTodayShare) })}
              </span>
            )
            : null}
        </span>
      </div>
      {spend?.models.map(model => (
        <Fragment key={model.model}>
          <div className={css.modelRow}>
            <span className={css.modelName}>{model.displayName}</span>
            <span className={css.tasks}>{formatSpend(model.cost)}</span>
          </div>
          <div className={css.costRow}>
            <span className={css.costBreakdown}>
              {/* DSH's own bucket wording and row order (ui-chat's token
                  dialog): uncached input, cached input, output. */}
              {t('label.cost.input', { amount: formatSpend(model.cacheMissInputCost) })}
              {' · '}
              {t('label.cost.cacheRead', { amount: formatSpend(model.cacheHitInputCost) })}
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
}
