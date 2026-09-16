/**
 * Billing badge data hook: owns the balance/session/today/delegated states, the
 * mount+refresh fetch, the turn-settled recompute, and the click-outside
 * close. The trigger and the panel are pure views over the returned values,
 * so the concurrency/race handling lives in exactly one file.
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DeepSeekBalance, DeepSeekDelegatedSpend, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
// Type-only: pulls the host's `billingTodaySpend` SessionProjectionMap merge
// (the state/wire view type) for the `useProjection` read below.
import type {} from '@rayadesu/dsh-llm-billing/projection'
import { sumSpends } from './spends.ts'
import type { BalanceBadgeProps } from './BalanceBadge.tsx'

/** Debounce for the turn-settled recompute: a burst of turns prices once. */
export const TURN_SETTLE_DEBOUNCE_MS = 2_000

/**
 * Run one fetch line: the fetch is deferred to a microtask so the effect's
 * render commits before any state update lands; a settled value is stored
 * while `current` stays true, and a rejection keeps the previous value (a
 * no-op unless `onReject` supplies fallback handling) so a failed refetch
 * never blanks the UI.
 */
function fetchLine<T>(
  current: () => boolean,
  fetch: () => Promise<T>,
  store: (value: T) => void,
  onReject?: (reason: unknown) => void,
): Promise<void> {
  return Promise.resolve().then(fetch).then(
    (value) => { if (current()) store(value) },
    (reason: unknown) => { if (current()) onReject?.(reason) },
  )
}

/** The data surface the trigger and the panel render from. */
export interface BillingData {
  balance: DeepSeekBalance | null
  /**
   * The WHOLE conversation's billed spend: this session's own spend (live, from
   * the pushed projection or the `getSessionSpend` fallback) plus the subagent
   * sessions it delegated (the last `getDelegatedSpend` read), so the amount a
   * user reads is the conversation's, not just its own log's.
   */
  spend: DeepSeekSessionSpend | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
  /** Whether the current session is itself a delegated subagent child. */
  isSubagent: boolean
  /**
   * Whether the current session started on an EARLIER Beijing day — the only
   * case in which the panel's parenthesized today share is meaningful.
   * `false` until the delegated read settles (an unproven crossing stays
   * hidden) and for every session created today.
   */
  crossedDay: boolean
  /** Balance fetch failure while no value is present yet. */
  error: string | null
  refreshing: boolean
  open: boolean
  rootRef: RefObject<HTMLDivElement>
  refresh: () => void
  toggleOpen: () => void
}

/**
 * Start the badge's data lifecycle for one session. The spend follows the
 * conversation: the host-pushed `billingTodaySpend` projection drives this
 * session's own part live (zero Remote calls), with `getSessionSpend` as the
 * bootstrap/fallback when the projection key is absent; the delegated-subagent
 * subtotal comes from `getDelegatedSpend` on mount, on refresh, and when a turn
 * settles; today's spend is recomputed through `getTodaySpend` on the same
 * events; the balance stays a manual-refresh snapshot and is never refetched on
 * its own.
 * @param props - the badge's injected face and session runtime share.
 */
export function useBillingData({
  getBalance,
  getCachedBalance,
  getSessionSpend,
  getTodaySpend,
  getTodaySessionsSpend,
  getDelegatedSpend,
  sessionId,
  useSession,
  useProjection,
}: Pick<BalanceBadgeProps, 'getBalance' | 'getCachedBalance' | 'getSessionSpend' | 'getTodaySpend' | 'getTodaySessionsSpend' | 'getDelegatedSpend' | 'sessionId' | 'useSession' | 'useProjection'>): BillingData {
  // A previously settled balance renders immediately on mount; the effect
  // below revalidates in the background (the host reuses its own TTL snapshot).
  const [balance, setBalance] = useState<DeepSeekBalance | null>(getCachedBalance)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [todaySpend, setTodaySpend] = useState<DeepSeekTodaySpend | null>(null)
  const [sessionsSpend, setSessionsSpend] = useState<DeepSeekTodaySessionsSpend | null>(null)
  const [delegated, setDelegated] = useState<DeepSeekDelegatedSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // The host computes this session's spend eagerly and pushes it through the
  // projection wire; reading it here is a subscription, not a Remote call.
  // `undefined` means the key is absent (no projection registry), in which
  // case the Remote fetch below is the only source.
  const projected = useProjection('billingTodaySpend')

  // The running flag is the "turn settled" signal: it flips true when a prompt
  // turn starts and false when the turn ends, letting the spend-only effect
  // below react to a landed turn without touching the account balance.
  const running = useSession(snapshot => snapshot.running)

  // The last running state already priced, so the spend-only effect skips
  // the initial mount (the mount effect already fetched).
  const pricedRunningRef = useRef(running)

  // The fetch effect reads whether values are already present (refreshing vs
  // first load) without subscribing to balance changes — a ref keeps the
  // effect's dependency array as the fetch trigger only.
  const balanceRef = useRef(balance)
  balanceRef.current = balance

  // Whether the detail panel is open: the ranking fetch is gated on it, so a
  // badge that is never opened never pays for the all-session ranking.
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    let current = true
    const isCurrent = (): boolean => current
    // A refresh (values already present) keeps the previous values on screen;
    // the first load has nothing to keep, so it stays on the loading render.
    setRefreshing(balanceRef.current !== null)
    void Promise.resolve().then(() => {
      // Each line settles on its own: the badge renders from the balance and
      // the panel rows from their own spend, so a slow aggregate (today's
      // spend scans every session) delays neither the balance nor the session
      // spend.
      const balanceRequest = fetchLine(isCurrent, () => getBalance(request > 0), (value) => {
        setBalance(value)
        setError(null)
      }, (reason: unknown) => {
        // A refresh failure keeps the last good value instead of blanking it.
        if (balanceRef.current === null) setError(reason instanceof Error ? reason.message : String(reason))
      })
      const sessionSpendRequest = fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      const todaySpendRequest = fetchLine(isCurrent, () => getTodaySpend(request > 0), setTodaySpend)
      // The delegated subtotal completes the conversation amount; the same
      // cached host pass serves it, so it costs no extra scan.
      const delegatedRequest = fetchLine(isCurrent, () => getDelegatedSpend(sessionId, request > 0), setDelegated)
      // The ranking is only rendered inside the open detail panel.
      const sessionsSpendRequest = openRef.current
        ? fetchLine(isCurrent, () => getTodaySessionsSpend(request > 0), setSessionsSpend)
        : Promise.resolve()
      // The refresh spinner covers the whole refresh, whatever settles last.
      void Promise.allSettled([balanceRequest, sessionSpendRequest, todaySpendRequest, delegatedRequest, sessionsSpendRequest]).then(() => {
        if (current) setRefreshing(false)
      })
    })
    return () => { current = false }
  }, [getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, getDelegatedSpend, sessionId, request])

  // Opening the panel loads today's ranking on demand (it is never fetched
  // while the panel stays closed).
  useEffect(() => {
    if (!open) return
    let current = true
    void fetchLine(() => current, () => getTodaySessionsSpend(), setSessionsSpend)
    return () => { current = false }
  }, [getTodaySessionsSpend, open])

  // A turn settles: recompute this session's spend, its delegated subtotal, and
  // today's spend across every session. The balance is account-level and stays a
  // manual snapshot — never refetched here. The recompute is debounced so a
  // burst of turns (an agent continuing across turns) prices once instead of
  // once per turn; the host-side cache then serves the first miss for the rest
  // of the minute.
  useEffect(() => {
    if (running === pricedRunningRef.current) return
    pricedRunningRef.current = running
    // A turn starting only arms the edge; the settle (running → false) prices.
    if (running) return
    let current = true
    const isCurrent = (): boolean => current
    const timer = setTimeout(() => {
      // Each spend line updates on its own: the slow all-session aggregate
      // does not delay the session line.
      void fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      void fetchLine(isCurrent, () => getDelegatedSpend(sessionId), setDelegated)
      void fetchLine(isCurrent, () => getTodaySpend(), setTodaySpend)
      // The ranking is only refreshed while its panel is open.
      if (openRef.current) void fetchLine(isCurrent, () => getTodaySessionsSpend(), setSessionsSpend)
    }, TURN_SETTLE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      current = false
    }
  }, [getSessionSpend, getDelegatedSpend, getTodaySpend, getTodaySessionsSpend, sessionId, running])

  // A pointer press outside the label box closes it.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  // This session's own billed spend: the pushed projection wins over the Remote
  // snapshot when present, because it is already current for this session and
  // costs no round trip.
  const own = projected === undefined ? spend : projected.session

  return {
    balance,
    // What the badge and the panel show is the CONVERSATION: the own part above
    // stays live (it moves with the projection as the turn streams) and the
    // subagent subtotal rides the last `getDelegatedSpend` read, so a session
    // whose subagents burned most of the money no longer reads as nearly free.
    spend: own === null ? null : delegated === null ? own : sumSpends(own, delegated),
    todaySpend,
    sessionsSpend,
    isSubagent: delegated?.isSubagent ?? false,
    crossedDay: delegated?.crossedDay ?? false,
    error,
    refreshing,
    open,
    rootRef,
    refresh: () => { setRequest(value => value + 1) },
    toggleOpen: () => { setOpen(value => !value) },
  }
}
