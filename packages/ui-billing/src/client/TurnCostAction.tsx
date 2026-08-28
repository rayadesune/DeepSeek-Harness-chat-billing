/** Per-turn billed-cost label in the closing assistant message's actions row. */

import { useEffect, useState } from 'react'
import type { DeepSeekTurnSpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TurnCostAction.module.css'

/**
 * In-house money-bag glyph in the hollow-outline style (16px viewBox, stroke
 * currentColor, fill none), referencing the 💰 emoji: a bag outline with a
 * tie knot at the neck and a centered yuan mark on the body. The drawing
 * fills the 16px box like the other glyphs.
 * @param props - optional size and class (the leading slot scales it to 14px).
 * @returns the money-bag icon.
 */
function WalletIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.8 2.7 L5.2 5.2 C2.4 6.6 1.6 9.0 2.7 11.2 C3.4 12.8 5.5 13.6 8 13.6 C10.5 13.6 12.6 12.8 13.3 11.2 C14.4 9.0 13.6 6.6 10.8 5.2 L11.2 2.7 M6.6 1.4 L9.4 2.4 M9.4 1.4 L6.6 2.4 M5.6 5.5 L8 8.2 L10.4 5.5 M8 8.2 V12.4 M5.8 9.2 H10.2 M5.8 10.9 H10.2"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

/** Injected face: one Turn's billed cost through the billing Remote. */
export interface TurnCostActionInjected {
  /** Read one completed Turn's billed cost, located by its closing message id. */
  getTurnSpend: (sessionId: SessionId, messageId: string) => Promise<DeepSeekTurnSpend>
}

/**
 * Full props of the per-turn cost entry. The slot's owner share
 * (`AssistantActionOwnerProps.messageId`) arrives from ui-conversation's
 * declared `conversation.chat.assistant-actions` slot; the session runtime
 * share adds `sessionId`.
 */
export type TurnCostActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<TurnCostActionInjected>
  & PropsLocale<typeof NS>

/** CNY amount, up to four decimals with trailing zeros trimmed. */
function formatSpend(amount: number): string {
  return `¥${amount.toFixed(4).replace(/\.?0+$/, '')}`
}

// Completed turns never change, so one fetch per (session, message) serves
// the page lifetime; the map is capped so an unbounded transcript cannot grow
// it without bound.
const turnCostCache = new Map<string, DeepSeekTurnSpend>()
const TURN_COST_CACHE_LIMIT = 1024

async function cachedTurnCost(
  sessionId: SessionId,
  messageId: string,
  getTurnSpend: TurnCostActionInjected['getTurnSpend'],
): Promise<DeepSeekTurnSpend> {
  const key = `${sessionId}\0${messageId}`
  const cached = turnCostCache.get(key)
  if (cached !== undefined) return cached
  const spend = await getTurnSpend(sessionId, messageId)
  if (turnCostCache.size >= TURN_COST_CACHE_LIMIT) turnCostCache.clear()
  turnCostCache.set(key, spend)
  return spend
}

/**
 * Render one Turn's billed cost inside the closing message's actions row,
 * before the built-in copy control (flex `order: -1`). The "本轮花费" word
 * uses the usage-card title tone and the amount the summary tone; unlike the
 * clock, the label stays visible without hover (the hover rule only targets
 * the time labels). It appears only after the Remote settles and hides again
 * when the Turn priced to zero (no DeepSeek usage); a failed fetch stays
 * hidden so a Remote outage never clutters the row.
 * @param props - the closing message id, the session runtime share, and the injected cost reader.
 * @returns the cost label, or null while loading, on failure, or for zero cost.
 */
export function TurnCostAction({ messageId, sessionId, getTurnSpend, t }: TurnCostActionProps) {
  const [cost, setCost] = useState<DeepSeekTurnSpend | null>(null)
  useEffect(() => {
    let current = true
    void Promise.resolve()
      .then(() => cachedTurnCost(sessionId, messageId, getTurnSpend))
      .then(
        (value) => { if (current) setCost(value) },
        () => { if (current) setCost(null) },
      )
    return () => { current = false }
  }, [getTurnSpend, messageId, sessionId])
  if (cost === null || cost.total <= 0) return null
  return (
    <span className={css.cost} data-turn-cost>
      <span className={css.leading}><WalletIcon /></span>
      <span className={css.costLabel}>{t('turnCost.label')}</span>
      <span className={css.separator} aria-hidden />
      <span className={css.costValue}>{formatSpend(cost.total)}</span>
    </span>
  )
}
