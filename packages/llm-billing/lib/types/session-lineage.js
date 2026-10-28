/**
 * Session lineage and titles: which session delegated which, where a subtree's
 * spend belongs, and the title a ranking row is labelled with. Split out of
 * `today-spend.ts` because neither the cache nor the scan strategies care
 * about lineage for their own sake — they only ask for it.
 * @module @rayadesu/dsh-llm-billing/session-lineage
 */
export function foldSessionTitle(events) {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        // `session/title` joined the SessionEvent union after the npm
        // 0.1.1-rc.2 baseline this package builds against; read its payload
        // through the structural escape hatch (runtime logs carry it).
        if (event.type !== 'session/title')
            continue;
        const data = event.data;
        return typeof data.title === 'string' ? data.title : null;
    }
    return null;
}
/**
 * Whether one session's durable header marks it as a CLI/headless one-shot
 * run: the GUI stamps `agentPreset` on every session it creates, while the
 * `dsh <prompt>` path never does. Only a PRESENT header without the field
 * counts — an unknown header (`undefined`) is never marked, so an unreadable
 * session cannot grow a wrong badge. The marker is DISPLAY-ONLY (a title
 * suffix in the ranking); a log predating the field would read as CLI, which
 * the archive sampled here never produced (every GUI session, v2 through v4,
 * carries the stamp).
 * @param header - the session's lineage slice; `undefined` is never CLI.
 * @returns true when the session was created outside the GUI by a one-shot run.
 */
export function isCliSession(header) {
    if (header === undefined)
        return false;
    if (isSubagentSession(header))
        return false;
    return header.agentPreset === undefined;
}
/**
 * Whether one session's durable header marks it as a subagent child. Either
 * marker is enough: `origin` is DSH's navigation classification and
 * `delegationDepth` is its persisted recursion budget, so a header carrying
 * only the depth (or only the origin) is still a delegation child. A session
 * created without either — an ordinary session, a user fork, or a cold resume
 * — is top-level.
 * @param header - the session's lineage slice; `undefined` reads as top-level.
 * @returns true when the session was created as a subagent child.
 */
export function isSubagentSession(header) {
    if (header === undefined)
        return false;
    return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0;
}
/**
 * The top-level session one session's ranking row belongs to: the session
 * itself for a top-level session, and for a subagent child the first ancestor
 * up the `parentSession` chain that is not itself a subagent child. A
 * multi-generation delegation (a subagent that spawned subagents) therefore
 * lands on the same root row as its parent, and a child whose parent header is
 * unknown is attributed to the parent id its own header names — the parent is
 * authoritative even when its log is not part of this scan.
 * @param id - the session whose row is being attributed.
 * @param lineage - lineage of every session this scan saw, by id.
 * @returns the session id whose ranking row the input belongs to.
 */
export function topLevelSessionOf(id, lineage) {
    let current = id;
    // A malformed log could claim a delegation cycle; each step visits a
    // distinct ancestor, so a repeat ends the walk instead of spinning.
    const seen = new Set([current]);
    for (;;) {
        const header = lineage.get(current);
        if (!isSubagentSession(header))
            return current;
        const parent = header?.parentSession;
        if (parent === undefined || seen.has(parent))
            return current;
        seen.add(parent);
        current = parent;
    }
}
/**
 * Fold every subagent child's row into the top-level row it belongs to
 * ({@link topLevelSessionOf}), so the ranking lists conversations rather than
 * every delegation a conversation started. A child's spend is added to its
 * ancestor's `total`; the ancestor's `ownTotal` keeps its own spend only. A
 * top-level session whose own day was empty but whose subagents priced
 * something still gets a row (with `ownTotal` 0), carrying the title the scan
 * resolved for it in `titles`. Each output row carries `cli` — whether the
 * TOP-LEVEL session behind the row was a CLI one-shot run (see
 * {@link isCliSession}) — so a ranking entry with no session-list counterpart
 * is labelled as such.
 * @param rows - one row per session that priced something today (own spends).
 * @param lineage - lineage of every session this scan saw, by id.
 * @param titles - resolved display titles by session id; a session absent from
 *   the map has no resolved title and its created row reports `null`.
 * @returns the merged rows, sorted by `total` descending.
 */
export function rollUpSubagentSpend(rows, lineage, titles = new Map()) {
    const merged = new Map();
    for (const row of rows) {
        const target = topLevelSessionOf(row.sessionId, lineage);
        // The row speaks for the TOP-LEVEL session, so the CLI marker reads that
        // session's own header — a subagent child's header never badges its parent.
        const cli = isCliSession(lineage.get(target));
        const carried = merged.get(target);
        if (carried === undefined) {
            // A row's own session keeps its own total as `ownTotal`; a row created
            // for an ancestor that priced nothing today carries zero there.
            merged.set(target, target === row.sessionId
                ? { ...row, cli }
                : { sessionId: target, title: titles.get(target) ?? null, total: row.total, ownTotal: 0, cli });
            continue;
        }
        merged.set(target, { ...carried, total: carried.total + row.total });
    }
    return [...merged.values()].sort((left, right) => right.total - left.total);
}
/**
 * Structural slice of a live session's header: the fork boundary of both DSH
 * runtime families plus the delegation lineage the ranking roll-up reads.
 */ 
//# sourceMappingURL=session-lineage.js.map