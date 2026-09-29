/**
 * Composer spend pill: the billing mark (this package's own ring-and-sparkle
 * glyph, reduced for the composer's 14px tier) plus the amount, in the
 * composer's stat row, opening this conversation's billed-cost card. The card
 * reproduces DSH's own token-usage dialog skin row for row (same surface,
 * radius, elevation, title rule, and right-aligned tabular amounts) with the
 * spend's three billing buckets where that card shows its token buckets:
 * uncached input, cache read, output.
 *
 * The amounts ride the host-pushed `billingTodaySpend` projection, so the pill
 * is live with zero Remote calls; `billing/getSessionSpend` is the fallback for
 * an assembly whose projection registry is absent (the same ladder the header
 * badge walks in `useBillingData`), and `billing/getDelegatedSpend` adds the
 * subagent sessions this conversation delegated — the same own+delegated merge
 * that badge's second line makes, so the pill and the badge never disagree.
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
     * session it delegated, transitively, across every day. The same face the
     * header badge reads, so both surfaces count the conversation the same way.
     * `force` bypasses the host-side cache — the turn-settled read passes it.
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
 * typography, and hover fill are copied from those pills. The amount is this
 * conversation's billed spend — this session's own spend plus the subagent
 * sessions it delegated — and a session that priced nothing anywhere renders no
 * entry at all.
 * @param props - the session identity, the runtime hooks, the Remote face, and the locale seat.
 * @returns the pill plus its portaled card, or null when there is nothing to show.
 */
export declare function SpendCard({ sessionId, useSession, useProjection, getSessionSpend, getDelegatedSpend, t }: SpendCardProps): import("react").JSX.Element | null;
//# sourceMappingURL=SpendCard.d.ts.map