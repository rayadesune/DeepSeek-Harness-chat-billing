/** Max sessions whose maps are kept before the oldest is evicted. */
export const TURN_COST_STORE_LIMIT = 32;
/**
 * Build the shared store over one batch fetcher.
 * @param fetch - the `getSessionTurnSpends` call.
 * @returns the store.
 */
export function createTurnCostStore(fetch) {
    const entries = new Map();
    const entryFor = (sessionId) => {
        let entry = entries.get(sessionId);
        if (entry === undefined) {
            entry = { turns: new Map(), inflight: undefined };
            entries.set(sessionId, entry);
            while (entries.size > TURN_COST_STORE_LIMIT) {
                const oldest = entries.keys().next().value;
                if (oldest === undefined)
                    break;
                entries.delete(oldest);
            }
        }
        return entry;
    };
    const refresh = (sessionId, entry) => {
        if (entry.inflight !== undefined)
            return entry.inflight;
        const run = (async () => {
            try {
                const result = await fetch(sessionId);
                entry.turns = new Map(result.turns.map(row => [row.messageId, row.total]));
            }
            finally {
                entry.inflight = undefined;
            }
        })();
        entry.inflight = run;
        return run;
    };
    return {
        async get(sessionId, messageId) {
            const entry = entryFor(sessionId);
            const cached = entry.turns.get(messageId);
            if (cached !== undefined)
                return cached;
            // One fetch per miss; every concurrently mounting row joins it. A failed
            // fetch leaves the map empty, so the row renders nothing.
            await refresh(sessionId, entry).catch(() => { });
            return entry.turns.get(messageId);
        },
        invalidate(sessionId) {
            if (sessionId === undefined)
                entries.clear();
            else
                entries.delete(sessionId);
        },
    };
}
//# sourceMappingURL=turnCostStore.js.map