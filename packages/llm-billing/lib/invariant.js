//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@rayadesu/dsh-llm-billing`.
* @module @rayadesu/dsh-llm-billing/invariant
*/
const PACKAGE_NAME = "@rayadesu/dsh-llm-billing";
/** Cordis companion plugin name. */
const name = "llm-billing-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this package is a read-only Remote projection over the
* provider balance and session logs, and owns no cross-plugin mutable state.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
