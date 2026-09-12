/**
 * One trigger-anchored dialog seat for the composer spend card, mirroring the
 * behaviour of DSH's own composer stat dialogs: the panel portals above the
 * trigger, the position is clamped inside the viewport, an outside pointerdown
 * or Escape closes it.
 *
 * DSH's `ui-chat` keeps its equivalent seat in its own private client bundle,
 * so this plugin cannot import it; the two primitives it is built from are
 * public (`@deepseek-ai/dsh-client-ui-primitives`), and the CSS skin they are
 * paired with is reproduced in `SpendCard.module.css` from the same tokens.
 * @module @rayadesu/dsh-client-ui-billing/useCardDialog
 */

import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'

/** Viewport margin the placement clamp keeps (DSH's menu-portal margin). */
const PANEL_MARGIN = 12

/** Distance between the trigger's top edge and the panel's bottom. */
const PANEL_GAP = 8

/**
 * Unplaced portal panel: hidden but laid out, so the clamp's measure pass sees
 * the panel's real dimensions instead of clamping a zero-size box.
 */
export const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** Open state, the two refs, and the clamped placement of one card dialog. */
export interface CardDialogSeat {
  open: boolean
  setOpen: (open: boolean) => void
  /** Anchor: wraps the trigger pill so the clamp measures the pill, not the page. */
  rootRef: MutableRefObject<HTMLSpanElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  /** Clamped placement; `null` during the measure pass (use {@link MEASURE_STYLE}). */
  pos: CSSProperties | null
}

/**
 * Own the card's open state, placement, and dismissal.
 * @returns the seat; spread `pos ?? MEASURE_STYLE` onto the portaled panel.
 */
export function useCardDialog(): CardDialogSeat {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const pos = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // Outside pointerdown closes through the shared primitive; the portaled
  // panel counts as inside.
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  return { open, setOpen, rootRef, panelRef, pos }
}
