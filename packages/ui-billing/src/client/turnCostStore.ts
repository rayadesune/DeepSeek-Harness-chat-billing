/**
 * Shared per-session Turn-cost map: one `getSessionTurnSpends` fetch serves
 * every cost row of a session, instead of one Remote call per rendered
 * message. Concurrent row mounts join the in-flight fetch, and a message id
 * the map does not know triggers exactly one refetch (a newly completed Turn),
 * so a transcript of N rows costs O(1) calls plus one per new Turn.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeepSeekSessionTurnSpends } from '@rayadesu/dsh-llm-billing/types'

/** Max sessions whose maps are kept before the oldest is evicted. */
export const TURN_COST_STORE_LIMIT = 32

/** One session's cached map plus its in-flight fetch. */
interface TurnCostEntry {
  turns: Map<string, number>
  inflight: Promise<void> | undefined
}

/** The shared store surface the cost row consumes. */
export interface TurnCostStore {
  /**
   * Resolve one message's Turn cost, fetching the session's map on a miss.
   * @param sessionId - the session owning the message.
   * @param messageId - the assistant message id.
   * @returns the Turn cost in CNY, or `undefined` when the message is not in a completed Turn.
   */
  get(sessionId: SessionId, messageId: string): Promise<number | undefined>
  /** Drop one session's map (or every map) so the next read refetches. */
  invalidate(sessionId?: SessionId): void
}

/**
 * Build the shared store over one batch fetcher.
 * @param fetch - the `getSessionTurnSpends` call.
 * @returns the store.
 */
export function createTurnCostStore(
  fetch: (sessionId: SessionId) => Promise<DeepSeekSessionTurnSpends>,
): TurnCostStore {
  const entries = new Map<SessionId, TurnCostEntry>()

  const entryFor = (sessionId: SessionId): TurnCostEntry => {
    let entry = entries.get(sessionId)
    if (entry === undefined) {
      entry = { turns: new Map(), inflight: undefined }
      entries.set(sessionId, entry)
      while (entries.size > TURN_COST_STORE_LIMIT) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    }
    return entry
  }

  const refresh = (sessionId: SessionId, entry: TurnCostEntry): Promise<void> => {
    if (entry.inflight !== undefined) return entry.inflight
    const run = (async (): Promise<void> => {
      try {
        const result = await fetch(sessionId)
        entry.turns = new Map(result.turns.map(row => [row.messageId, row.total]))
      } finally {
        entry.inflight = undefined
      }
    })()
    entry.inflight = run
    return run
  }

  return {
    async get(sessionId: SessionId, messageId: string): Promise<number | undefined> {
      const entry = entryFor(sessionId)
      const cached = entry.turns.get(messageId)
      if (cached !== undefined) return cached
      // One fetch per miss; every concurrently mounting row joins it. A failed
      // fetch leaves the map empty, so the row renders nothing.
      await refresh(sessionId, entry).catch(() => {})
      return entry.turns.get(messageId)
    },
    invalidate(sessionId?: SessionId): void {
      if (sessionId === undefined) entries.clear()
      else entries.delete(sessionId)
    },
  }
}
