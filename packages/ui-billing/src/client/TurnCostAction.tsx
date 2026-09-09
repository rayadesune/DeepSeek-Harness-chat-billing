/** Per-turn billed-cost label in the closing assistant message's actions row. */

import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatSpend } from './format.ts'
import { NS } from './locales.ts'
import css from './TurnCostAction.module.css'

/** Injected face: one message's Turn cost, served from a shared per-session map. */
export interface TurnCostActionInjected {
  /**
   * Resolve one completed Turn's billed cost by its message id. The underlying
   * `getSessionTurnSpends` fetch happens once per session (shared by every row
   * and coalesced across concurrent mounts), not once per rendered message.
   */
  getTurnCost: (sessionId: SessionId, messageId: string) => Promise<number | undefined>
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

/**
 * Render one Turn's billed cost as a plain, non-interactive `¥金额` at the
 * end of the closing message's actions row. The DOM stays inside the
 * assistant-actions slot (between copy and branch); flex `order: 1` sorts the
 * span after every order-0 sibling, so it visually lands after the clock at
 * the line end. The typography replicates the clock's `.timeEnd` tier and the
 * row's 8px gap spaces it from the clock, so the amount reads as one trailing
 * meta line with the time; no icon, label or hover behavior of its own (the
 * row's hover reveal shows it with the clock). It appears only after the
 * shared map resolves and hides again when the Turn priced to zero (no DeepSeek
 * usage); a failed fetch stays hidden so a Remote outage never clutters the
 * row.
 * @param props - the closing message id, the session runtime share, and the injected cost reader.
 * @returns the cost text, or null while loading, on failure, or for zero cost.
 */
export function TurnCostAction({ messageId, sessionId, getTurnCost }: TurnCostActionProps) {
  const [cost, setCost] = useState<number | null>(null)
  useEffect(() => {
    let current = true
    void Promise.resolve()
      .then(() => getTurnCost(sessionId, messageId))
      .then(
        (value) => { if (current) setCost(value ?? null) },
        () => { if (current) setCost(null) },
      )
    return () => { current = false }
  }, [getTurnCost, messageId, sessionId])
  if (cost === null || cost <= 0) return null
  return (
    <span className={css.cost} data-turn-cost>{formatSpend(cost)}</span>
  )
}
