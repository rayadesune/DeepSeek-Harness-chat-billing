/**
 * Composer spend pill: the billing mark (this package's own ring-and-sparkle
 * glyph, reduced for the composer's 14px tier) plus the amount, in the
 * composer's stat row, opening this conversation's billed-cost card. The card
 * reproduces DSH's own token-usage dialog skin row for row (same surface,
 * radius, elevation, title rule, and right-aligned tabular amounts) with the
 * spend's three billing buckets where that card shows its token buckets:
 * uncached input, cache read, output.
 *
 * The pill's main amount is the MAIN session's spend — the same caliber the
 * official composer pill counts tokens in — with the subagent sessions this
 * conversation delegated broken out after it as a ` · ` rider (the official
 * pill's own cache-hit rider format) and as the card's fourth row. Nothing
 * merges the two halves into one figure any more: the total the card heads
 * with is the sum of its four rows, and a pill with no subagent spend renders
 * exactly as it did before the rider existed.
 *
 * The amounts ride the host-pushed `billingTodaySpend` projection, so the pill
 * is live with zero Remote calls; `billing/getSessionSpend` is the fallback for
 * an assembly whose projection registry is absent (the same ladder the header
 * badge walks in `useBillingData`), and `billing/getDelegatedSpend` reads the
 * subagent subtotal the rider and the fourth row report.
 * @module @rayadesu/dsh-client-ui-billing/SpendCard
 */
import type { DeepSeekDelegatedSpend, DeepSeekSessionSpend } from '@rayadesu/dsh-llm-billing/types';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
/** Injected face: this conversation's priced spend and its subagent subtotal. */
export interface SpendCardInjected {
    /** Read one session's billed spend across its own events (Remote fallback). */
    getSessionSpend: (sessionId: SessionId) => Promise<DeepSeekSessionSpend>;
    /**
     * Read the subagent part of one conversation's billed spend: every subagent
     * session it delegated, transitively, across every day. The pill's ` ·`
     * rider and the card's fourth row report it, next to — never merged into —
     * the main session amount. `force` bypasses the host-side cache — the
     * turn-settled read passes it.
     */
    getDelegatedSpend: (sessionId: SessionId, force?: boolean) => Promise<DeepSeekDelegatedSpend>;
}
/**
 * Full props of the composer spend entry. The owner share arrives from
 * ui-conversation's declared `conversation.composer.dock` list slot (it passes
 * no owner values); the session runtime share adds the identity, the session
 * selector, and the projection reader, as it does for every session-scoped slot.
 */
export type SpendCardProps = PropsRuntime<'conversation.composer.dock'> & InjectFace<SpendCardInjected> & PropsLocale<typeof NS>;
/**
 * Render the composer spend pill, and the cost card it opens.
 *
 * The pill is an inline flex item of DSH's composer stat row, so it sits beside
 * the built-in time/token pills (see SpendCard.module.css); its glyph, tone,
 * typography, and hover fill are copied from those pills. The main amount is
 * this session's own billed spend, with the subagent sessions it delegated
 * riding after it as a ` · 子会话 ￥…` segment — and a session that priced
 * nothing itself and delegated nothing priced renders no entry at all.
 * @param props - the session identity, the runtime hooks, the Remote face, and the locale seat.
 * @returns the pill plus its portaled card, or null when there is nothing to show.
 */
export declare function SpendCard({ sessionId, useSession, useProjection, getSessionSpend, getDelegatedSpend, t }: SpendCardProps): import("react").JSX.Element | null;
//# sourceMappingURL=SpendCard.d.ts.map