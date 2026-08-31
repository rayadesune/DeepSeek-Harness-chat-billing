/** Per-turn billed-cost label in the closing assistant message's actions row. */

import { useEffect, useState } from 'react'
import type { DeepSeekTurnSpend } from '@rayadesu/dsh-llm-billing/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TurnCostAction.module.css'

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
 * Render one Turn's billed cost as a plain, non-interactive `¥金额` at the
 * end of the closing message's actions row. The DOM stays inside the
 * assistant-actions slot (between copy and branch); flex `order: 1` sorts the
 * span after every order-0 sibling, so it visually lands after the clock at
 * the line end. The typography replicates the clock's `.timeEnd` tier and the
 * row's 8px gap spaces it from the clock, so the amount reads as one trailing
 * meta line with the time; no icon, label or hover behavior of its own (the
 * row's hover reveal shows it with the clock). It appears only after the
 * Remote settles and hides again when the Turn priced to zero (no DeepSeek
 * usage); a failed fetch stays hidden so a Remote outage never clutters the
 * row.
 * @param props - the closing message id, the session runtime share, and the injected cost reader.
 * @returns the cost text, or null while loading, on failure, or for zero cost.
 */
export function TurnCostAction({ messageId, sessionId, getTurnSpend }: TurnCostActionProps) {
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
    <span className={css.cost} data-turn-cost>{formatSpend(cost.total)}</span>
  )
}
