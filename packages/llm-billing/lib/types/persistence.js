/**
 * The persistence seams a cold scan reads through. DSH ships a single
 * persistence runtime family — the handle-based `list` / `open` +
 * `SessionHandle` surface (0.1.2-alpha.5+, the only one the plugin's
 * `^0.2.0-rc.1` peer targets). This module is the only place that knows
 * the handle shape. Split out of `today-spend.ts` so the scan strategies read
 * one shape.
 * @module @rayadesu/dsh-llm-billing/persistence
 */
import { forkBoundaryOf } from "./billing.js";
/**
 * Read one live session's complete event log across both runtime families.
 * @throws when the session exposes neither the legacy `events` snapshot nor
 *   the newer `snapshotEvents()` reader — an unknown runtime surface must
 *   fail loudly rather than silently price an empty log.
 */
export function liveSessionEvents(session) {
    if (session.events !== undefined)
        return session.events;
    // Optional-call form keeps the receiver bound (snapshotEvents uses `this`).
    if (session.snapshotEvents !== undefined)
        return session.snapshotEvents();
    throw new Error('llm-billing: session log surface is neither Session.events nor Session.snapshotEvents');
}
/**
 * Unwrap a handle read across both return shapes.
 * @param read - the handle's read result.
 * @returns the event array.
 */
export function handleReadEvents(read) {
    // `Array.isArray` does not narrow readonly arrays out of a union, so the
    // branches are asserted explicitly.
    if (Array.isArray(read))
        return read;
    return read.events;
}
/**
 * List every stored session snapshot through the handle-based persistence
 * service (`list`).
 * @param persistence - the persistence service slice.
 * @returns one snapshot per stored session.
 */
export function persistenceListSnapshots(persistence) {
    return persistence.list();
}
/**
 * Read one stored session's complete event log and durable inherited boundary
 * through the handle-based persistence service (`open` + handle `read`; the
 * handle is closed after the read). Throws when the session does not exist.
 * @param persistence - the persistence service slice.
 * @param id - the stored session to read.
 * @returns the session's complete event log plus its inherited-prefix boundary.
 */
export async function persistenceInspect(persistence, id) {
    const handle = await persistence.open(id, 'read');
    try {
        return { events: handleReadEvents(await handle.read()), seedLength: forkBoundaryOf(handle) };
    }
    finally {
        await handle.close();
    }
}
//# sourceMappingURL=persistence.js.map