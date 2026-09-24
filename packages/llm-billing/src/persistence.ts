/**
 * The persistence seams a cold scan reads through. DSH has shipped two
 * persistence runtime families — a service-level `inspect`/`listSnapshots`
 * pair and a handle-based `list`/`open` + `SessionHandle` one — and this is
 * the only place that knows both. Split out of `today-spend.ts` so the scan
 * strategies read one shape.
 * @module @rayadesu/dsh-llm-billing/persistence
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { forkBoundaryOf } from './billing.ts'
import type { SessionLineage } from './session-lineage.ts'

export interface SessionHeaderSlice extends SessionLineage {
  /** ≤ 0.1.1-rc.2: the durable fork boundary carried by the header; absent for an unseeded session. */
  readonly seedLength?: number
  /** 0.1.2-alpha.4+: whether the session has a fork-inherited prefix. */
  readonly isSeeded?: boolean
  /**
   * Durable creation instant (epoch ms). The conversation read uses it to tell
   * whether a session's spend can span more than the queried day; it is also
   * part of the projection-cache record identity.
   */
  readonly createdAt?: number
}

/**
 * Structural slice of a live session the scanner reads, accepting both DSH
 * runtime families: the ≤ 0.1.1-rc.2 baseline exposes the log as
 * `events` (+ `header.seedLength`), while 0.1.2-alpha.4+ exposes
 * `snapshotEvents()` and `inheritedEventCount` (and dropped the header field).
 */
export interface ScannerSession {
  readonly id: SessionId
  /** ≤ 0.1.1-rc.2: the full event log snapshot. */
  readonly events?: readonly SessionEvent[]
  /** 0.1.2-alpha.4+: materialize an immutable log snapshot; no args = the full current log. */
  snapshotEvents?(fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[]
  /** 0.1.2-alpha.4+: the durable inherited-prefix length (0 for an unseeded session). */
  readonly inheritedEventCount?: number
  /** Durable header slice: `seedLength` (older runtime) or `isSeeded` (newer runtime), plus lineage. */
  readonly header?: SessionHeaderSlice
}

/**
 * Read one live session's complete event log across both runtime families.
 * @throws when the session exposes neither the legacy `events` snapshot nor
 *   the newer `snapshotEvents()` reader — an unknown runtime surface must
 *   fail loudly rather than silently price an empty log.
 */
export function liveSessionEvents(session: ScannerSession): readonly SessionEvent[] {
  if (session.events !== undefined) return session.events
  // Optional-call form keeps the receiver bound (snapshotEvents uses `this`).
  if (session.snapshotEvents !== undefined) return session.snapshotEvents()
  throw new Error('llm-billing: session log surface is neither Session.events nor Session.snapshotEvents')
}

/** Structural slice of a listed persisted session (the snapshot header is a full SessionHeader). */
export interface ScannerPersistedHeader extends SessionHeaderSlice {
  readonly id: SessionId
  /** Session format generation; part of the projection-cache record identity. */
  readonly version?: number
  /** Working directory recorded on the header; part of the projection-cache record identity. */
  readonly cwd?: string
}

/** One stored-session read: the full event log plus the durable inherited boundary. */
export interface ScannerPersistedRead {
  readonly events: readonly SessionEvent[]
  /** Inherited-prefix length (fork seed length); 0 for an unseeded session. */
  readonly seedLength: number
}

/** ≤ 0.1.1-rc.2 persistence slice: service-level `inspect` / `listSnapshots`. */
export interface ScannerPersistenceLegacy {
  listSnapshots(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
  inspect(id: SessionId): Promise<{
    meta?: SessionHeaderSlice
    /** 0.1.2-alpha.4+: the exact inherited cut travels beside, not inside, the header. */
    inheritedEventCount?: number
    events: readonly SessionEvent[]
  }>
}

/**
 * One handle read result across DSH generations. The handle seam first
 * returned the bare event array; since `9b78f99dec` (2026-09-06, in the
 * 0.1.5-alpha.1 checkout) it returns `{ eventState, events }`. Both shapes are
 * accepted so the same build serves the npm alpha line and the checkout.
 */
export type ScannerHandleRead =
  | readonly SessionEvent[]
  | { readonly events: readonly SessionEvent[] }

/**
 * Unwrap a handle read across both return shapes.
 * @param read - the handle's read result.
 * @returns the event array.
 */
export function handleReadEvents(read: ScannerHandleRead): readonly SessionEvent[] {
  // `Array.isArray` does not narrow readonly arrays out of a union, so the
  // branches are asserted explicitly.
  if (Array.isArray(read)) return read as readonly SessionEvent[]
  return (read as { readonly events: readonly SessionEvent[] }).events
}

/** 0.1.2-alpha.5+ handle-based persistence slice: service-level `list` / `open` + `SessionHandle`. */
export interface ScannerPersistenceHandle {
  list(): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]>
  open(id: SessionId, access: 'read'): Promise<{
    readonly header?: SessionHeaderSlice
    /** 0.1.2-alpha.5+: the handle carries the exact inherited cut beside the header. */
    readonly inheritedEventCount?: number
    read(): Promise<ScannerHandleRead>
    close(): Promise<void>
  }>
}

/** Structural union the scanner reads through, accepting both persistence runtime families. */
export type ScannerPersistence = ScannerPersistenceLegacy | ScannerPersistenceHandle

function isHandlePersistence(persistence: ScannerPersistence): persistence is ScannerPersistenceHandle {
  return typeof (persistence as Partial<ScannerPersistenceHandle>).open === 'function'
}

/**
 * List every stored session snapshot across both persistence runtime families:
 * `listSnapshots` (≤ 0.1.1-rc.2) or `list` (0.1.2-alpha.5+).
 * @param persistence - the persistence service slice.
 * @returns one snapshot per stored session.
 */
export function persistenceListSnapshots(
  persistence: ScannerPersistence,
): Promise<readonly { header: ScannerPersistedHeader; revision: SessionPersistenceRevision }[]> {
  return isHandlePersistence(persistence)
    ? persistence.list()
    : (persistence as ScannerPersistenceLegacy).listSnapshots()
}

/**
 * Read one stored session's complete event log and durable inherited boundary
 * across both persistence runtime families: legacy `inspect` (≤ 0.1.1-rc.2)
 * or `open` + handle `read` (0.1.2-alpha.5+; the handle is closed after the
 * read). Both throw when the session does not exist.
 * @param persistence - the persistence service slice.
 * @param id - the stored session to read.
 * @returns the session's complete event log plus its inherited-prefix boundary.
 */
export async function persistenceInspect(
  persistence: ScannerPersistence,
  id: SessionId,
): Promise<ScannerPersistedRead> {
  if (isHandlePersistence(persistence)) {
    const handle = await persistence.open(id, 'read')
    try {
      return { events: handleReadEvents(await handle.read()), seedLength: forkBoundaryOf(handle) }
    } finally {
      await handle.close()
    }
  }
  const inspection = await (persistence as ScannerPersistenceLegacy).inspect(id)
  return { events: inspection.events, seedLength: forkBoundaryOf(inspection) }
}

/** Structural slices of the optional services the scanner reads through. */