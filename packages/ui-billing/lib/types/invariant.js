/**
 * Package-owned invariant companion for `@rayadesu/dsh-client-ui-billing`.
 * @module @rayadesu/dsh-client-ui-billing/invariant
 */
const PACKAGE_NAME = '@rayadesu/dsh-client-ui-billing';
/** Cordis companion plugin name. */
export const name = 'client-ui-billing-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this package is a read-only projection of one Remote
 * snapshot onto three session-scoped slot entries (the header badge, the
 * per-turn cost label, and the composer spend pill). It emits no cordis events,
 * owns no cross-plugin mutable state, and its slot registrations prove disposal
 * through the HMR-safety spec.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map