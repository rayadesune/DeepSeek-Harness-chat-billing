/**
 * Billing badge data hook: owns the balance/session/today states, the
 * mount+refresh fetch, the turn-settled recompute, and the click-outside
 * close. The trigger and the panel are pure views over the returned values,
 * so the concurrency/race handling lives in exactly one file.
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DeepSeekBalance, DeepSeekSessionSpend, DeepSeekTodaySessionsSpend, DeepSeekTodaySpend } from '@rayadesu/dsh-llm-billing/types'
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
  spend: DeepSeekSessionSpend | null
  todaySpend: DeepSeekTodaySpend | null
  sessionsSpend: DeepSeekTodaySessionsSpend | null
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
 * conversation: when a prompt turn settles in the current session, only the
 * (local, network-free) session spend and today's spend are recomputed
 * through `getSessionSpend` / `getTodaySpend`; the balance stays a
 * manual-refresh snapshot and is never refetched on its own.
 * @param props - the badge's injected face and session runtime share.
 */
export function useBillingData({
  getBalance,
  getSessionSpend,
  getTodaySpend,
  getTodaySessionsSpend,
  sessionId,
  useSession,
}: Pick<BalanceBadgeProps, 'getBalance' | 'getSessionSpend' | 'getTodaySpend' | 'getTodaySessionsSpend' | 'sessionId' | 'useSession'>): BillingData {
  const [balance, setBalance] = useState<DeepSeekBalance | null>(null)
  const [spend, setSpend] = useState<DeepSeekSessionSpend | null>(null)
  const [todaySpend, setTodaySpend] = useState<DeepSeekTodaySpend | null>(null)
  const [sessionsSpend, setSessionsSpend] = useState<DeepSeekTodaySessionsSpend | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

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
      const balanceRequest = fetchLine(isCurrent, getBalance, (value) => {
        setBalance(value)
        setError(null)
      }, (reason: unknown) => {
        // A refresh failure keeps the last good value instead of blanking it.
        if (balanceRef.current === null) setError(reason instanceof Error ? reason.message : String(reason))
      })
      const sessionSpendRequest = fetchLine(isCurrent, () => getSessionSpend(sessionId), setSpend)
      const todaySpendRequest = fetchLine(isCurrent, () => getTodaySpend(request > 0), setTodaySpend)
      const sessionsSpendRequest = fetchLine(isCurrent, () => getTodaySessionsSpend(request > 0), setSessionsSpend)
      // The refresh spinner covers the whole refresh, whatever settles last.
      void Promise.allSettled([balanceRequest, sessionSpendRequest, todaySpendRequest, sessionsSpendRequest]).then(() => {
        if (current) setRefreshing(false)
      })
    })
    return () => { current = false }
  }, [getBalance, getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, request])

  // A turn settles: recompute this session's spend and today's spend across
  // every session. The balance is account-level and stays a manual snapshot —
  // never refetched here. The recompute is debounced so a burst of turns (an
  // agent continuing across turns) prices once instead of once per turn; the
  // host-side cache then serves the first miss for the rest of the minute.
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
      void fetchLine(isCurrent, () => getTodaySpend(), setTodaySpend)
      void fetchLine(isCurrent, () => getTodaySessionsSpend(), setSessionsSpend)
    }, TURN_SETTLE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      current = false
    }
  }, [getSessionSpend, getTodaySpend, getTodaySessionsSpend, sessionId, running])

  // A pointer press outside the label box closes it.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  return {
    balance,
    spend,
    todaySpend,
    sessionsSpend,
    error,
    refreshing,
    open,
    rootRef,
    refresh: () => { setRequest(value => value + 1) },
    toggleOpen: () => { setOpen(value => !value) },
  }
}
