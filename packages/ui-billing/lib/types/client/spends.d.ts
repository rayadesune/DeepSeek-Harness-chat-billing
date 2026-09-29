/**
 * Additive merge of a conversation's two spend halves: the session's OWN billed
 * spend (live, from the pushed `billingTodaySpend` projection or the
 * `billing/getSessionSpend` fallback) and the delegated-subagent subtotal
 * (`billing/getDelegatedSpend`). The composer spend pill shows one amount for the whole
 * conversation, so the two must be summed before rendering — and the per-model
 * rows must be summed the same way, or the breakdown would no longer add up to
 * the amount above it.
 *
 * Pure addition only: no pricing, no timezone, no fork-boundary knowledge lives
 * here (the host owns all of that), so this cannot drift from the host's own
 * sums.
 */
import type { DeepSeekSessionSpend } from '@rayadesu/dsh-llm-billing/types';
/**
 * Sum one conversation's own spend and its delegated-subagent subtotal.
 * @param own - the session's own billed spend.
 * @param delegated - the delegated subtotal from the last `getDelegatedSpend` read.
 * @returns the merged spend (own model order first, then newly seen models).
 */
export declare function sumSpends(own: DeepSeekSessionSpend, delegated: DeepSeekSessionSpend): DeepSeekSessionSpend;
//# sourceMappingURL=spends.d.ts.map