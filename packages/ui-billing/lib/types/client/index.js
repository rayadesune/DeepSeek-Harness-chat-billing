/**
 * DeepSeek account-balance badge, browser half: three session-scoped entries —
 * the header badge, the per-turn cost label, and the composer spend pill.
 */
import billingRemote from '@rayadesu/dsh-llm-billing/remote';
import { BalanceBadge } from "./BalanceBadge.js";
import { browserBalanceDayStorage, createBalanceDayTracker } from "./balanceDay.js";
import { SpendCard } from "./SpendCard.js";
import { TurnCostAction } from "./TurnCostAction.js";
import { createTurnCostStore } from "./turnCostStore.js";
import { en, NS, zh } from "./locales.js";
export { createTurnCostStore, TURN_COST_STORE_LIMIT } from "./turnCostStore.js";
/** Services required for locale registration, the Remote face, and the three slot entries. */
export const inject = ['slots', 'locale', 'remote'];
/** Unwrap one Remote result into its value, reporting the endpoint on failure. */
function unwrap(endpoint, result) {
    if (!result.ok)
        throw new Error(`${endpoint} failed: ${result.error.code}: ${result.error.message}`);
    return result.value;
}
/**
 * Client plugin body: mount the `billing` Remote, register the dictionaries,
 * and contribute the header badge, the per-turn cost label, and the composer
 * spend pill.
 * @param ctx - client root context.
 */
export async function apply(ctx) {
    // Mount the Remote owned by this plugin; the host half is `dsh-llm-billing`.
    await ctx.remote.$mount(billingRemote);
    // The mounted namespace is read through the explicit service lookup. The
    // property access `ctx.remote.billing` would require `remote.billing` in this
    // fiber's inject list, which deadlocks: this apply mounts that namespace, so
    // it cannot also wait for it before running.
    const billing = ctx.get('remote.billing');
    if (billing === undefined) {
        throw new Error('ui-billing: billing Remote namespace did not mount');
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-billing: dictionaries');
    // The injected face is built ONCE so its function identities stay stable:
    // the badge's and the pill's fetch effects list these functions as
    // dependencies, so a per-call rebuild would re-trigger the mount fetch on
    // every render that re-invokes the slot's injector.
    // The last settled balance is kept here (per plugin instance) so a badge
    // mount renders the amount immediately instead of waiting for the network;
    // the host-side TTL then serves the revalidation from its own cache.
    let lastBalance = null;
    // Today's consumption is measured from the balance series ITSELF (see
    // balanceDay.ts): every queried balance is folded into the day record here,
    // at the one place a balance enters this half, and persisted so the day's
    // first sample survives a reload. `getCachedBalance` deliberately does NOT
    // sample: it replays a value an earlier query already recorded.
    const balanceDay = createBalanceDayTracker(browserBalanceDayStorage());
    const injected = {
        getBalance: async (force) => {
            const value = unwrap('billing.getBalance', await billing.getBalance(force));
            lastBalance = value;
            balanceDay.record(value);
            return value;
        },
        getCachedBalance: () => lastBalance,
        getBalanceDaySpend: balance => balanceDay.spend(balance),
        getSessionSpend: async (sessionId) => unwrap('billing.getSessionSpend', await billing.getSessionSpend(sessionId)),
        getTodaySpend: async (force) => unwrap('billing.getTodaySpend', await billing.getTodaySpend(force)),
        getTodaySessionsSpend: async (force) => unwrap('billing.getTodaySessionsSpend', await billing.getTodaySessionsSpend(force)),
        getDelegatedSpend: async (sessionId, force) => unwrap('billing.getDelegatedSpend', await billing.getDelegatedSpend(sessionId, force)),
    };
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'billing-balance',
        order: 30,
        locale: NS,
        inject: () => injected,
    }, BalanceBadge));
    // The per-turn cost amounts ride ui-chat's assistant-actions list slot (the
    // same strip ui-message-feedback uses), so they coexist with every other
    // entry; the actions row renders once per completed Turn, for its closing
    // assistant message. The DOM therefore stays between copy and branch — the
    // label's own CSS `order: 1` sorts it visually after every order-0 sibling
    // (copy, branch, usage pills, clock), landing at the line end.
    // The amount is a plain static span: no interaction, no icon, no label
    // text, so the entry needs no aria or portal behavior.
    //
    // ONE batch fetch per session serves every row: `getSessionTurnSpends`
    // returns the whole message→Turn-cost map in one pass on the host, and the
    // shared store coalesces the concurrent mounts of a transcript (the old
    // per-message `getTurnSpend` fan-out cost one Remote call and one full-log
    // fold per rendered message).
    const turnCosts = createTurnCostStore(async (sessionId) => unwrap('billing.getSessionTurnSpends', await billing.getSessionTurnSpends(sessionId)));
    const turnCostInjected = {
        getTurnCost: (sessionId, messageId) => turnCosts.get(sessionId, messageId),
    };
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'billing-turn-cost',
        order: 20,
        locale: NS,
        inject: () => turnCostInjected,
    }, TurnCostAction));
    // The spend pill rides ui-conversation's composer dock — the row under the
    // input box that ui-chat's own time/token pills occupy. `b6726fe79d` turned
    // that dock from a column stack into one centred flex row
    // (InputBar.module.css `.dock`: `display:flex; justify-content:center;
    // gap:12px; padding-top:4px`), so a dock entry is an inline flex item rather
    // than a row of its own: ui-chat's stats register `order: 0`, this entry
    // `order: 20`, and InputBar renders ContextMeter after the slot — the row
    // reads [time/tok] [¥ pill] [ContextMeter], the pill immediately right of the
    // built-in tokens. (ContextMeter hides itself while a turn runs, so the pill
    // is not always the row's last item; the dock itself only renders on a
    // resident composer with a session, so the hero page has no pill at all.)
    //
    // The amount is the CONVERSATION's: the host already prices every session
    // into the client-visible `billingTodaySpend` projection, and the card sums
    // that value's three billing buckets plus the subagent subtotal it reads
    // through `getDelegatedSpend` — the pill is the ONLY surface that shows the
    // conversation's own amount (the header badge's second line and its panel are
    // account-level: they report today's figures). `getSessionSpend` stays
    // injected as the fallback an assembly without the projection registry reads:
    // the same face, and the same ladder, the badge walks.
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'billing-spend',
        order: 20,
        locale: NS,
        inject: () => injected,
    }, SpendCard));
}
//# sourceMappingURL=index.js.map