/**
 * Session-header billing detail panel: the API-remaining row, this session's
 * spend with its cache-hit / cache-miss-input / output cost breakdown per
 * model, today's spend across every session, the ranking of today's sessions,
 * a refresh action, and the spend disclaimer. Pure view — no state, no
 * effects; refreshing keeps the last values visible rather than blanking them.
 */
import { Fragment } from 'react'
import type { DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
import { IconQuestionOutline14, IconRefreshOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatSpend } from './format.ts'
import { NS } from './locales.ts'
import css from './BalanceBadge.module.css'

/** How many per-session ranking rows the panel shows before the overflow hint. */
export const SESSION_RANKING_LIMIT = 10

/** Panel props: precomputed amount plus the same spend values the badge holds. */
export interface BalancePanelProps {
  /** Primary balance line, e.g. `¥123.45`; `—` when the provider reports none. */
  amount: string
  spend: DeepSeekSessionSpend | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
  refreshing: boolean
  onRefresh: () => void
  t: PropsLocale<typeof NS>['t']
}

/** The detail box opened from the badge trigger. */
export function BalancePanel({ amount, spend, todaySpend, sessionsSpend, refreshing, onRefresh, t }: BalancePanelProps) {
  return (
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
            onClick={onRefresh}
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
}
