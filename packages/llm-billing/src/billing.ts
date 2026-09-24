/**
 * DeepSeek billing aggregation: the session/turn/today spend computations
 * over the pricing engine (`pricing.ts`) and the per-event fold state machine
 * (`fold.ts`). Pure functions over session events, so the whole spend is
 * testable without a key and the Remote gateway stays transport-free.
 *
 * The fold in {@link BillingFolder} / {@link applyBillingEvent} (see `fold.ts`)
 * and the per-event pricing in `pricing.ts` are the single source of truth the
 * events-scan paths, the session-projection unit, and the scanner all price
 * through, so a pricing-table change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/billing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionSpend, DeepSeekSessionTurnSpends, DeepSeekTodaySpend, DeepSeekTurnSpend, DeepSeekTurnSpendRow } from './types.ts'
import type { ResolvedBilling } from './pricing.ts'
import { beijingDayKey, beijingDayRangeOfKey } from './beijing-time.ts'
import { emptyTodaySpend } from './spend.ts'
import { BillingFolder } from './fold.ts'

// Re-exported so the package's public surface and its tests keep importing
// them from this module: the pricing engine, the fold state machine, the
// Beijing-time helpers, and the spend algebra.
export * from './beijing-time.ts'
export * from './spend.ts'
export * from './pricing.ts'
export * from './fold.ts'

/**
 * Structural source of a session's durable inherited-prefix boundary. The
 * exact cut moved between DSH runtimes: since 0.1.2-alpha.4,
 * `SessionHeader.seedLength` was removed (the header now carries only
 * `isSeeded`: boolean) and the count moved to `Session.inheritedEventCount` /
 * `SessionHandle.inheritedEventCount`. The reader prefers that exact-count
 * field and otherwise falls back to the older `seedLength` on the durable
 * header, so the same plugin code prices correctly across the live-session
 * and handle surfaces it still meets.
 */
export interface ForkBoundarySource {
  /** 0.1.2-alpha.4+: `Session.inheritedEventCount` / `SessionHandle.inheritedEventCount`. */
  readonly inheritedEventCount?: number
  /** ≤ 0.1.1-rc.2 live-session header: `SessionHeader.seedLength`. */
  readonly seedLength?: number
  /** Durable header slice of a live session or opened handle (its `seedLength`). */
  readonly header?: { readonly seedLength?: number; readonly isSeeded?: boolean }
}

/**
 * The durable inherited-prefix boundary of one session: the number of leading
 * events it inherited verbatim from its fork source, 0 for a session created
 * without a seed. A forked session (or any seeded replay) carries that count
 * in its session state; every event with `seq < seedLength` is a copy of an
 * event already billed in that source session, so pricing must skip them or
 * the same model output is counted once per copy. Accepts the durable field
 * of the live-session and handle surfaces (see {@link ForkBoundarySource}).
 * @param source - the session, header slice, or opened handle carrying the
 *   boundary; `undefined` reads as 0.
 * @returns the inherited-prefix length; 0 for an unseeded session.
 */
export function forkBoundaryOf(source: ForkBoundarySource | undefined): number {
  if (source === undefined) return 0
  const inherited = source.inheritedEventCount
  if (inherited !== undefined && Number.isSafeInteger(inherited)) return inherited
  return source.header?.seedLength ?? source.seedLength ?? 0
}

/** Whether a durable header marks a fork-inherited (seeded) session across the live-session and handle surfaces. */
export function isSeededSession(header: { readonly seedLength?: number; readonly isSeeded?: boolean } | undefined): boolean {
  if (header === undefined) return false
  if (header.isSeeded === true) return true
  return (header.seedLength ?? 0) > 0
}

/**
 * Price one session's complete event log at the official per-model rates,
 * with DSH's attempt semantics: every provider-reported sample (an
 * `assistant/message`'s usage, or an `assistant/attempt`'s stream usage)
 * contributes, a later sample for the same `(turn, step)` replaces the earlier
 * one, and `llm/retry-started` makes the retried attempt add.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param startSeq - when provided, only events with `seq >= startSeq`
 *   contribute: a forked session's inherited prefix (see {@link forkBoundaryOf})
 *   is skipped, so each model output is billed only in the session that
 *   produced it.
 * @returns the session's total cost plus one row per priced model.
 */
export function computeSessionSpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  startSeq = 0,
): DeepSeekSessionSpend {
  const folder = new BillingFolder(billing, catalog, startSeq)
  folder.addAll(events)
  return folder.fold.session
}

/**
 * Price one completed Turn's billed usage, identified by its closing
 * assistant message id. The turn's events are those between its `turn/start`
 * and `turn/end` (both matched by the message's own turn coordinate), priced
 * with the same attempt semantics as {@link computeSessionSpend}. A message
 * that cannot be located, a turn without bracketing `turn/start` / `turn/end`
 * events (for example after compaction), or a session with no priced usage
 * prices to zero.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param messageId - the closing assistant message's durable id.
 * @returns the turn's total cost in CNY.
 */
export function computeTurnSpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  messageId: string,
): DeepSeekTurnSpend {
  return { total: turnCostOf(events, billing, catalog, messageId) }
}

/**
 * The total cost of the Turn containing `messageId`, folded with the shared
 * attempt semantics (see {@link applyBillingEvent}).
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param messageId - one assistant message inside the Turn.
 * @returns the Turn's total cost in CNY, or 0 when the Turn cannot be located.
 */
function turnCostOf(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  messageId: string,
): number {
  let turn: number | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    if (event.data.message.id !== messageId) continue
    turn = event.data.turn
    break
  }
  if (turn === undefined) return 0
  const folder = new BillingFolder(billing, catalog)
  let active = false
  for (const event of events) {
    if (event.type === 'turn/start' && event.data.turn === turn) {
      active = true
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === turn) break
    if (!active) continue
    folder.add(event)
  }
  return folder.fold.session.total
}

/**
 * Incremental single-pass fold of one session's completed-Turn costs, keyed by
 * the id of every assistant message inside each Turn. Feeding the fold only
 * the appended tail keeps a growing session's map current in O(new events)
 * instead of re-scanning the whole log per message.
 *
 * Semantics are exactly {@link computeTurnSpend}'s: a Turn is the
 * `turn/start`..`turn/end` range (matched by the event's own turn coordinate),
 * every priced event inside it contributes at its own timestamp's rate, and a
 * message outside any bracket contributes nothing.
 */
export class SessionTurnSpendFolder {
  private readonly catalog: readonly { id: string; name: string }[]
  private readonly rows: DeepSeekTurnSpendRow[] = []
  private ids: string[] = []
  /** Events of the open Turn, folded with the shared attempt semantics on close. */
  private events: SessionEvent[] = []
  private open = false
  /** Events already fed; a shorter log resets the fold. */
  private cursor = 0

  /**
   * @param billing - resolved pricing with peak-hour windows.
   * @param catalog - model display rows, in presentation order.
   */
  constructor(
    private readonly billing: ResolvedBilling,
    catalog: readonly { id: string; name: string }[],
  ) {
    this.catalog = catalog
  }

  /** How many events have been folded so far (the host's incremental cursor). */
  get processed(): number {
    return this.cursor
  }

  /**
   * Fold every event from the cursor to the end of the log. A log shorter than
   * the cursor (rewritten session) restarts the fold from an empty state.
   * @param events - the session's complete event log, in seq order.
   */
  feed(events: readonly SessionEvent[]): void {
    if (events.length < this.cursor) this.reset()
    for (let index = this.cursor; index < events.length; index += 1) {
      const event = events[index]!
      if (event.type === 'turn/start') {
        this.open = true
        this.ids = []
        this.events = []
        continue
      }
      if (event.type === 'turn/end') {
        if (this.open) {
          const folder = new BillingFolder(this.billing, this.catalog)
          folder.addAll(this.events)
          const total = folder.fold.session.total
          for (const messageId of this.ids) this.rows.push({ messageId, total })
        }
        this.open = false
        this.ids = []
        this.events = []
        continue
      }
      if (!this.open) continue
      if (event.type === 'assistant/message') this.ids.push(event.data.message.id)
      this.events.push(event)
    }
    this.cursor = events.length
  }

  /** The folded map; the fold stays usable afterwards. */
  finish(): DeepSeekSessionTurnSpends {
    return { turns: [...this.rows] }
  }

  /** Drop the fold state so the next feed starts from the log's beginning. */
  private reset(): void {
    this.rows.length = 0
    this.ids = []
    this.events = []
    this.open = false
    this.cursor = 0
  }
}

/**
 * Price every completed Turn of one session in a single pass (the pure
 * equivalent of {@link SessionTurnSpendFolder}).
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @returns one row per assistant message inside a completed Turn, in log order.
 */
export function computeSessionTurnSpends(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
): DeepSeekSessionTurnSpends {
  const folder = new SessionTurnSpendFolder(billing, catalog)
  folder.feed(events)
  return folder.finish()
}

/**
 * Price one session's log for the Beijing-time calendar day of `now`. Events
 * after the reference day are ignored; the fold's latest-day state then
 * answers the query exactly (empty when the session's latest priced day is not
 * the reference day). Pricing follows {@link applyBillingEvent} (attempt
 * samples with same-step replacement).
 *
 * The fold's `(turn, step)` replacement slot is per session, so callers must
 * pass ONE session's log; aggregate across sessions with
 * {@link mergeTodaySpend}.
 * @param events - one session's complete event log.
 * @param billing - resolved pricing with peak-hour windows.
 * @param catalog - model display rows, in presentation order.
 * @param now - the reference moment whose Beijing-time calendar day is "today".
 * @returns today's total cost plus one row per priced model.
 */
export function computeTodaySpend(
  events: readonly SessionEvent[],
  billing: ResolvedBilling,
  catalog: readonly { id: string; name: string }[],
  now: Date = new Date(),
): DeepSeekTodaySpend {
  const day = beijingDayKey(now)
  // Events past the reference day cannot contribute: one numeric bound for the
  // scan instead of a date string per event.
  const dayRange = beijingDayRangeOfKey(day)
  const dayEnd = dayRange?.end ?? Number.POSITIVE_INFINITY
  const folder = new BillingFolder(billing, catalog)
  for (const event of events) {
    if (event.time >= dayEnd) continue
    folder.add(event)
  }
  return folder.fold.dayKey === day ? folder.fold.spend : emptyTodaySpend()
}
