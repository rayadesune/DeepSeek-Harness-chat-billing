/**
 * Session lineage and titles: which session delegated which, where a subtree's
 * spend belongs, and the title a ranking row is labelled with. Split out of
 * `today-spend.ts` because neither the cache nor the scan strategies care
 * about lineage for their own sake — they only ask for it.
 * @module @rayadesu/dsh-llm-billing/session-lineage
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { DeepSeekTodaySessionSpend } from './types.ts'

export function foldSessionTitle(events: readonly SessionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    // `session/title` joined the SessionEvent union after the npm
    // 0.1.1-rc.2 baseline this package builds against; read its payload
    // through the structural escape hatch (runtime logs carry it).
    if ((event as { type: string }).type !== 'session/title') continue
    const data = (event as { data: { title?: unknown } }).data
    return typeof data.title === 'string' ? data.title : null
  }
  return null
}

/**
 * Structural slice of a session's durable lineage: the header fields DSH
 * stamps on a delegation child (`origin: 'subagent'`, the delegating session's
 * id, and the depth that survives persistence). All three are read
 * structurally, so the scanner works on every runtime family — a log written
 * before the fields existed simply carries none of them and reads as a
 * top-level session.
 */
export interface SessionLineage {
  /** The session this one was forked from or delegated by; absent for a top-level session. */
  readonly parentSession?: SessionId
  /** DSH's subagent-child classification (`childSessionMeta` stamps it). */
  readonly origin?: 'subagent'
  /** Delegation depth: absent (zero) at the top level, parent depth + 1 for a subagent child. */
  readonly delegationDepth?: number
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
export function isSubagentSession(header: SessionLineage | undefined): boolean {
  if (header === undefined) return false
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
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
export function topLevelSessionOf(
  id: SessionId,
  lineage: ReadonlyMap<SessionId, SessionLineage>,
): SessionId {
  let current = id
  // A malformed log could claim a delegation cycle; each step visits a
  // distinct ancestor, so a repeat ends the walk instead of spinning.
  const seen = new Set<SessionId>([current])
  for (;;) {
    const header = lineage.get(current)
    if (!isSubagentSession(header)) return current
    const parent = header?.parentSession
    if (parent === undefined || seen.has(parent)) return current
    seen.add(parent)
    current = parent
  }
}

/**
 * Fold every subagent child's row into the top-level row it belongs to
 * ({@link topLevelSessionOf}), so the ranking lists conversations rather than
 * every delegation a conversation started. A child's spend is added to its
 * ancestor's `total`; the ancestor's `ownTotal` keeps its own spend only. A
 * top-level session whose own day was empty but whose subagents priced
 * something still gets a row (with `ownTotal` 0), carrying the title the scan
 * resolved for it in `titles`.
 * @param rows - one row per session that priced something today (own spends).
 * @param lineage - lineage of every session this scan saw, by id.
 * @param titles - resolved display titles by session id; a session absent from
 *   the map has no resolved title and its created row reports `null`.
 * @returns the merged rows, sorted by `total` descending.
 */
export function rollUpSubagentSpend(
  rows: readonly DeepSeekTodaySessionSpend[],
  lineage: ReadonlyMap<SessionId, SessionLineage>,
  titles: ReadonlyMap<SessionId, string | null> = new Map(),
): DeepSeekTodaySessionSpend[] {
  const merged = new Map<SessionId, DeepSeekTodaySessionSpend>()
  for (const row of rows) {
    const target = topLevelSessionOf(row.sessionId, lineage)
    const carried = merged.get(target)
    if (carried === undefined) {
      // A row's own session keeps its own total as `ownTotal`; a row created
      // for an ancestor that priced nothing today carries zero there.
      merged.set(target, target === row.sessionId
        ? row
        : { sessionId: target, title: titles.get(target) ?? null, total: row.total, ownTotal: 0 })
      continue
    }
    merged.set(target, { ...carried, total: carried.total + row.total })
  }
  return [...merged.values()].sort((left, right) => right.total - left.total)
}

/**
 * Structural slice of a live session's header: the fork boundary of both DSH
 * runtime families plus the delegation lineage the ranking roll-up reads.
 */