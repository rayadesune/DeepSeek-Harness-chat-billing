/**
 * The single-pass fold state machine that turns a committed event log into a
 * session's billed spend. Consumes the pricing primitives in `pricing.ts`
 * (`priceUsage` / `reportUnpricedModel`) and the spend algebra in `spend.ts`
 * (`addEventContribution` / `subtractSpend` / `noteUnpriced` / `emptyTodaySpend`);
 * every scan path prices through {@link applyBillingEvent} so a pricing-table
 * change cannot drift one path from the others.
 * @module @rayadesu/dsh-llm-billing/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DeepSeekTodaySpend } from './types.ts'
import type { ResolvedBilling } from './pricing.ts'
import { beijingPartsOf } from './beijing-time.ts'
import { priceUsage, reportUnpricedModel, usageTokens } from './pricing.ts'
import { addEventContribution, contributionSpend, emptyTodaySpend, noteUnpriced, subtractSpend } from './spend.ts'

/**
 * One priced attempt sample kept for same-step replacement: DSH can report the
 * same `(turn, step)` twice (an `assistant/attempt` stream and the
 * `assistant/message` that assembles from it), and a later sample replaces the
 * earlier one instead of adding to it. `llm/retry-started` clears the slot, so
 * a retried attempt adds rather than replaces (both requests were billed).
 */
export interface BillingFoldSample {
  /** Turn of the producing attempt. */
  turn: number
  /** Step of the producing attempt. */
  step: number
  /** Beijing day of the sample's timestamp. */
  dayKey: string
  /** The sample's contribution as a one-row spend (subtracted on replacement). */
  spend: DeepSeekTodaySpend
}

/**
 * Plain-JSON fold state of one session's billed spend: the latest priced day,
 * the whole-session total, the fork boundary, the model of the latest request
 * (needed to price an `assistant/attempt`, which carries no route), and the
 * last sample kept for replacement.
 */
export interface BillingFoldState {
  /** Beijing-time calendar-day key of `spend`; `''` for no priced usage. */
  dayKey: string
  /** The spend of the session's latest priced Beijing day (own events only). */
  spend: DeepSeekTodaySpend
  /** The spend of the session's OWN events across every day. */
  session: DeepSeekTodaySpend
  /** Fork-inherited prefix length; events below it belong to the source session. */
  inheritedEventCount: number
  /** Wire model of the latest `request/header`; `''` before the first one. */
  model: string
  /** Latest priced attempt sample, for same-step replacement. */
  last: BillingFoldSample | null
}

/** The empty fold state for one fork boundary. */
export function emptyBillingFoldState(inheritedEventCount = 0): BillingFoldState {
  return {
    dayKey: '',
    spend: emptyTodaySpend(),
    session: emptyTodaySpend(),
    inheritedEventCount,
    model: '',
    last: null,
  }
}

/** Structural view of the newer event fields this fold reads (see the module note). */
interface StructuralEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
}

/** Whether an unknown value looks like a provider usage report. */
function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { inputTokens?: unknown; outputTokens?: unknown }
  return typeof candidate.inputTokens === 'number' && typeof candidate.outputTokens === 'number'
}

/**
 * The last `usage` sample embedded in an event's stream, if any. `assistant/
 * attempt` and the embedded streams are newer than the plugin's npm baseline,
 * so the stream is read structurally (a failed/retried attempt reports its
 * usage only there).
 */
function streamUsageOf(event: SessionEvent): TokenUsage | undefined {
  const stream = (event as StructuralEvent).data === undefined
    ? undefined
    : ((event as StructuralEvent).data as { stream?: unknown }).stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = (stream[index] as { chunk?: { type?: unknown; usage?: unknown } } | undefined)?.chunk
    if (chunk === undefined || chunk.type !== 'usage') continue
    return isTokenUsage(chunk.usage) ? chunk.usage : undefined
  }
  return undefined
}

/**
 * Fold one committed event into a session's billed-spend state.
 *
 * Priced samples come from `assistant/message` (its own reported usage, or the
 * stream's last usage chunk) and `assistant/attempt` (the stream's last usage
 * chunk, priced with the model of the latest `request/header`, since an
 * attempt carries no route). A sample for the same `(turn, step)` replaces the
 * previous one; `llm/retry-started` closes the replacement slot so a retried
 * attempt adds. Every other event is inert and returns the same state
 * reference.
 * @param state - the previous fold state.
 * @param event - the committed event.
 * @param billing - resolved pricing with peak-hour windows.
 * @param names - model id → display label.
 * @returns the next state (the same reference when nothing was priced).
 */
export function applyBillingEvent(
  state: BillingFoldState,
  event: SessionEvent,
  billing: ResolvedBilling,
  names: ReadonlyMap<string, string>,
): BillingFoldState {
  if (event.seq < state.inheritedEventCount) return state
  // `assistant/attempt`, `llm/retry-started`, and the embedded stream are all
  // newer than the npm baseline this package builds against, so their fields
  // are read structurally.
  const type = (event as StructuralEvent).type
  if (type === 'request/header') {
    const model = ((event as StructuralEvent).data as { header?: { config?: { model?: unknown } } } | undefined)
      ?.header?.config?.model
    return typeof model === 'string' && model.length > 0 && model !== state.model ? { ...state, model } : state
  }
  const data = (event as StructuralEvent).data as
    | { turn?: unknown; step?: unknown; usage?: unknown; message?: { source?: { model?: unknown } }; stream?: unknown }
    | undefined
  if (type === 'llm/retry-started') {
    if (typeof data?.turn !== 'number' || typeof data.step !== 'number') return state
    const last = state.last
    if (last === null || last.turn !== data.turn || last.step !== data.step) return state
    return { ...state, last: null }
  }
  if (type !== 'assistant/message' && type !== 'assistant/attempt') return state
  const usage = (type === 'assistant/message' ? data?.usage : undefined) ?? streamUsageOf(event)
  if (!isTokenUsage(usage)) return state
  const model = type === 'assistant/message' ? data?.message?.source?.model : state.model
  if (typeof model !== 'string' || model.length === 0) return state
  const parts = beijingPartsOf(event.time)
  const rows = billing.models.get(model)
  if (rows === undefined) {
    // Unlisted upstream model: no rate row means no price, and no price is
    // guessed — a similar-looking id says nothing about a similar price, and a
    // wrong number that LOOKS authoritative is worse than a visible gap. The
    // usage is recorded rather than dropped, so today's ¥0 can say WHY.
    reportUnpricedModel(model)
    const tokens = usageTokens(usage)
    // Mirror the priced day rule so the tally reaches the day view: an
    // unpriced sample opens the day when the fold has none yet and rolls it
    // forward. Otherwise the very case this exists for — a session whose
    // EVERY sample is unpriced — would keep reading as "no usage at all"
    // with nothing recorded anywhere the today figure is read from.
    const opens = state.dayKey === '' || parts.dayKey > state.dayKey
    const sameDay = parts.dayKey === state.dayKey
    return {
      ...state,
      dayKey: opens ? parts.dayKey : state.dayKey,
      spend: opens
        ? noteUnpriced(emptyTodaySpend(), model, tokens)
        : sameDay ? noteUnpriced(state.spend, model, tokens) : state.spend,
      session: noteUnpriced(state.session, model, tokens),
    }
  }
  const priced = priceUsage(parts, usage, model, billing, names)
  // Unreachable — the row was resolved just above — but the lookup's own type
  // says `| undefined`, so the branch is spelled out rather than asserted away.
  if (priced === undefined) return state

  let session = state.session
  let spend = state.spend
  let dayKey = state.dayKey
  const last = state.last
  const turn = typeof data?.turn === 'number' ? data.turn : 0
  const step = typeof data?.step === 'number' ? data.step : 0
  if (last !== null && last.turn === turn && last.step === step) {
    session = subtractSpend(session, last.spend)
    if (last.dayKey === dayKey) spend = subtractSpend(spend, last.spend)
  }
  session = addEventContribution(session, priced)
  if (dayKey === priced.dayKey) {
    spend = addEventContribution(spend, priced)
  } else if (dayKey === '' || priced.dayKey > dayKey) {
    // The session log is append-only and chronological, so a strictly older
    // day cannot legally follow; ignore it for the latest-day state (the
    // whole-session total still accrues).
    dayKey = priced.dayKey
    spend = addEventContribution(emptyTodaySpend(), priced)
  }
  return {
    ...state,
    dayKey,
    spend,
    session,
    last: { turn, step, dayKey: priced.dayKey, spend: contributionSpend(priced) },
  }
}

/**
 * Mutable wrapper over {@link applyBillingEvent} for the pure pricing paths:
 * feed events in order, read the folded spend.
 */
export class BillingFolder {
  private state: BillingFoldState

  /**
   * @param billing - resolved pricing with peak-hour windows.
   * @param catalog - model display rows, in presentation order.
   * @param inheritedEventCount - fork boundary to skip (default 0).
   */
  constructor(
    private readonly billing: ResolvedBilling,
    catalog: readonly { id: string; name: string }[],
    inheritedEventCount = 0,
  ) {
    this.names = new Map(catalog.map(model => [model.id, model.name]))
    this.state = emptyBillingFoldState(inheritedEventCount)
  }

  private readonly names: ReadonlyMap<string, string>

  /** Fold one event. */
  add(event: SessionEvent): void {
    this.state = applyBillingEvent(this.state, event, this.billing, this.names)
  }

  /** Fold every event, in order. */
  addAll(events: readonly SessionEvent[]): void {
    for (const event of events) this.add(event)
  }

  /** The folded state (live reference; do not mutate). */
  get fold(): BillingFoldState {
    return this.state
  }
}
