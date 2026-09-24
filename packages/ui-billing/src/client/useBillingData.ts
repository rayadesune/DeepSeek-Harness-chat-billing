/**
 * Billing badge data hook: owns the balance/session/today/delegated states, the
 * mount+refresh fetch, the visible-page balance poll, the turn-settled
 * recompute, and the click-outside close. The trigger and the panel are pure
 * views over the returned values, so the concurrency/race handling lives in
 * exactly one file.
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
 * Balance poll cadence while the page is visible: five minutes, the
 * `balanceinfo` program's own interval.
 *
 * The day's consumption is measured from the FIRST balance queried on the local
 * calendar day (see balanceDay.ts), so the sampling cadence IS the figure's
 * resolution: with a poll, a page left open across midnight takes the new day's
 * baseline within one interval, and a top-up is seen within one interval
 * instead of only at the next mount. A hidden page stops polling and refreshes
 * once when it comes back, so a backgrounded tab costs nothing.
 */
export const BALANCE_POLL_MS = 300_000

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
   * Today's consumption measured from the balance series ITSELF (the
   * `balanceDay.ts` caliber): the day's first queried balance minus the
   * amount on screen, plus the day's top-ups. Derived synchronously from
   * `balance` — the host is never asked for it, because only this browser
   * knows which balances it has seen today. `null` until the day holds a
   * sample for the amount's currency.
   */
  balanceDaySpend: number | null
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
  /**
   * Whether a read the user is waiting on is in flight. It follows the group
   * the change actually re-ran: a session switch covers this session's own two
   * reads, a manual refresh (which re-runs both groups) covers every read. The
   * account-level reads never make a switch spin.
   */
  refreshing: boolean
  open: boolean
  rootRef: RefObject<HTMLDivElement>
  refresh: () => void
  toggleOpen: () => void
}

/**
 * Start the badge's data lifecycle for one session. The reads are split by what
 * they depend on, because only one half of them varies by session:
 *
 * - **Session level** (`getSessionSpend`, `getDelegatedSpend`) — re-read on
 *   mount, on a session switch, on a manual refresh, and when a turn settles.
 * - **Account level** (`getBalance`, `getTodaySpend`, plus the ranking while
 *   the panel is open) — re-read on mount, on a manual refresh, and when a turn
 *   settles, never on a session switch: neither answer depends on which session
 *   is on screen, and re-fetching them on every switch is what made the header
 *   spin for as long as the day's scan took.
 *
 * The session's own part is also driven live by the host-pushed
 * `billingTodaySpend` projection (zero Remote calls), with `getSessionSpend` as
 * the bootstrap/fallback when the projection key is absent; the balance is
 * additionally polled every {@link BALANCE_POLL_MS} while the page is visible,
 * because the day's consumption is measured from the first balance each local
 * day queried.
 *
 * A settled turn and the manual refresh read with `force`, a plain read does
 * not: the host serves a plain read the value on hand while it refreshes behind
 * it, so a settled turn that read plainly would report the day's pre-turn figure
 * one turn late. Opening the panel re-reads today's spend too — that is the
 * moment the reader asks for the day row, and a switch alone never re-reads it.
 * @param props - the badge's injected face and session runtime share.
 */
export function useBillingData({
  getBalance,
  getCachedBalance,
  getBalanceDaySpend,
  getSessionSpend,
  getTodaySpend,
  getTodaySessionsSpend,
  getDelegatedSpend,
  sessionId,
  useSession,
  useProjection,
}: Pick<BalanceBadgeProps, 'getBalance' | 'getCachedBalance' | 'getBalanceDaySpend' | 'getSessionSpend' | 'getTodaySpend' | 'getTodaySessionsSpend' | 'getDelegatedSpend' | 'sessionId' | 'useSession' | 'useProjection'>): BillingData {
  // A previously settled balance renders immediately on mount; the effect
  // below revalidates in the background (the host reuses its own TTL snapshot).
  const [balance, setBalance] = useState<DeepSeekBalance | null>(getCachedBalance)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [todaySpend, setTodaySpend] = useState<DeepSeekTodaySpend | null>(null)
  const [sessionsSpend, setSessionsSpend] = useState<DeepSeekTodaySessionsSpend | null>(null)
  const [delegated, setDelegated] = useState<DeepSeekDelegatedSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One flag per read group: the spinner follows whichever group a change
  // actually re-ran (see the hook's doc above), instead of always covering
  // every line.
  const [sessionBusy, setSessionBusy] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
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

  // The fetch effects read whether values are already present (a refresh vs
  // the first load) without subscribing to them — a ref keeps each effect's
  // dependency array as the fetch trigger only.
  const balanceRef = useRef(balance)
  balanceRef.current = balance
  const spendRef = useRef(spend)
  spendRef.current = spend

  // Whether the detail panel is open: the ranking fetch is gated on it, so a
  // badge that is never opened never pays for the all-session ranking.
  const openRef = useRef(open)
  openRef.current = open

  // The session-level group: the two reads whose answer depends on WHICH
  // session is on screen. A switch re-runs only these, so the spinner it starts
  // covers two Remote calls rather than the day's whole-session scan.
  useEffect(() => {
    let current = true
    const isCurrent = (): boolean => current
    // The previous session's spend stays on screen until its replacement lands
    // (the projection, when composed, swaps it immediately); the first load has
    // nothing to keep, so it stays on the loading render.
    setSessionBusy(spendRef.current !== null)
    void Promise.resolve().then(() => {
      const sessionSpendRequest = fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      // The delegated subtotal completes the conversation amount; the same
      // cached host pass serves it, so it costs no extra scan.
      const delegatedRequest = fetchLine(isCurrent, () => getDelegatedSpend(sessionId, request > 0), setDelegated)
      void Promise.allSettled([sessionSpendRequest, delegatedRequest]).then(() => {
        if (current) setSessionBusy(false)
      })
    })
    return () => { current = false }
  }, [getSessionSpend, getDelegatedSpend, sessionId, request])

  // The account-level group: neither read varies by session, so this runs on
  // mount, on the manual refresh, and on a turn settle — never on a session
  // switch. Each line settles on its own, so a slow aggregate (today's spend
  // scans every session) delays neither the balance nor the session spend.
  useEffect(() => {
    let current = true
    const isCurrent = (): boolean => current
    setAccountBusy(balanceRef.current !== null)
    void Promise.resolve().then(() => {
      const balanceRequest = fetchLine(isCurrent, () => getBalance(request > 0), (value) => {
        setBalance(value)
        setError(null)
      }, (reason: unknown) => {
        // A refresh failure keeps the last good value instead of blanking it.
        if (balanceRef.current === null) setError(reason instanceof Error ? reason.message : String(reason))
      })
      const todaySpendRequest = fetchLine(isCurrent, () => getTodaySpend(request > 0), setTodaySpend)
      // The ranking is only rendered inside the open detail panel; opening the
      // panel has its own effect below, and only the manual refresh forces this
      // one.
      const sessionsSpendRequest = openRef.current
        ? fetchLine(isCurrent, () => getTodaySessionsSpend(request > 0), setSessionsSpend)
        : Promise.resolve()
      void Promise.allSettled([balanceRequest, todaySpendRequest, sessionsSpendRequest]).then(() => {
        if (current) setAccountBusy(false)
      })
    })
    return () => { current = false }
  }, [getBalance, getTodaySpend, getTodaySessionsSpend, request])

  // Opening the panel re-reads today's spend AND loads the ranking on demand
  // (the ranking is never fetched while the panel stays closed). The day row
  // needs its own read here: a session switch re-reads only the session's own
  // lines, so while the user browses conversations the day figure the badge
  // holds is whatever the last read returned — opening the panel is the moment
  // the reader asks for it, and it must not show a value the host has already
  // moved past. Both reads go through the cached path: the host serves what it
  // holds, and past its window refreshes behind the answer.
  useEffect(() => {
    if (!open) return
    let current = true
    void fetchLine(() => current, () => getTodaySpend(), setTodaySpend)
    void fetchLine(() => current, () => getTodaySessionsSpend(), setSessionsSpend)
    return () => { current = false }
  }, [getTodaySpend, getTodaySessionsSpend, open])

  // The balance is polled while the page is VISIBLE, at the balanceinfo
  // program's own cadence. This exists for the balance-series consumption: that
  // figure is measured from the first balance queried on the local day, so a
  // page left open across midnight must sample shortly after the new day
  // starts, and a top-up must surface within one interval rather than at the
  // next mount. A hidden page stops polling (a backgrounded tab costs nothing)
  // and refreshes once on return, which is also what re-baselines the day for a
  // tab that slept through midnight. The cached path is used — the host's own
  // TTL still merges everything inside 15 seconds — and a failed poll keeps the
  // last good value, exactly like a failed refresh.
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = (): void => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }
    const poll = (): void => {
      void fetchLine(() => current, () => getBalance(), (value) => {
        setBalance(value)
        setError(null)
      })
    }
    const start = (): void => {
      if (timer !== undefined) return
      timer = setInterval(poll, BALANCE_POLL_MS)
    }
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop()
        return
      }
      poll()
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      current = false
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [getBalance])

  // A turn settles: recompute this session's spend, its delegated subtotal, and
  // today's spend across every session. The balance is account-level and this
  // effect never refetches it — its own cadence is the mount fetch plus the
  // visible-page poll above. The recompute is debounced so a burst of turns (an
  // agent continuing across turns) prices once instead of once per turn.
  //
  // Every read here FORCES, and that is the point: the turn just priced its own
  // usage, so the cached day figure is the one from before it. A plain (cached)
  // read would be answered from the value on hand with a refresh running behind
  // it — the reader would then see this turn's cost one turn late. The host
  // scan yields to its event loop between sessions (see `yieldToEventLoop`), so
  // waiting for the recompute no longer freezes the GUI; and the scan is
  // revision-gated, so a forced pass only re-reads the logs that changed.
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
      void fetchLine(isCurrent, () => getDelegatedSpend(sessionId, true), setDelegated)
      void fetchLine(isCurrent, () => getTodaySpend(true), setTodaySpend)
      // The ranking is only refreshed while its panel is open.
      if (openRef.current) void fetchLine(isCurrent, () => getTodaySessionsSpend(true), setSessionsSpend)
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
    // Today's consumption from the balance series, for the amount on screen:
    // each `getBalance` call already folded its snapshot into the day record
    // (see index.ts), so this is a read of state the balance render depends on
    // anyway — never a fetch, and never stale relative to the amount beside it.
    balanceDaySpend: balance === null ? null : getBalanceDaySpend(balance),
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
    refreshing: sessionBusy || accountBusy,
    open,
    rootRef,
    refresh: () => { setRequest(value => value + 1) },
    toggleOpen: () => { setOpen(value => !value) },
  }
}
