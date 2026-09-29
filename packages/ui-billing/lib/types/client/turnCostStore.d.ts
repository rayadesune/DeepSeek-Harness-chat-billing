/**
 * Shared per-session Turn-cost map: one `getSessionTurnSpends` fetch serves
 * every cost row of a session, instead of one Remote call per rendered
 * message. Concurrent row mounts join the in-flight fetch, and a message id
 * the map does not know triggers exactly one refetch (a newly completed Turn),
 * so a transcript of N rows costs O(1) calls plus one per new Turn.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { DeepSeekSessionTurnSpends } from '@rayadesu/dsh-llm-billing/types';
/** Max sessions whose maps are kept before the oldest is evicted. */
export declare const TURN_COST_STORE_LIMIT = 32;
/** The shared store surface the cost row consumes. */
export interface TurnCostStore {
    /**
     * Resolve one message's Turn cost, fetching the session's map on a miss.
     * @param sessionId - the session owning the message.
     * @param messageId - the assistant message id.
     * @returns the Turn cost in CNY, or `undefined` when the message is not in a completed Turn.
     */
    get(sessionId: SessionId, messageId: string): Promise<number | undefined>;
    /** Drop one session's map (or every map) so the next read refetches. */
    invalidate(sessionId?: SessionId): void;
}
/**
 * Build the shared store over one batch fetcher.
 * @param fetch - the `getSessionTurnSpends` call.
 * @returns the store.
 */
export declare function createTurnCostStore(fetch: (sessionId: SessionId) => Promise<DeepSeekSessionTurnSpends>): TurnCostStore;
//# sourceMappingURL=turnCostStore.d.ts.map