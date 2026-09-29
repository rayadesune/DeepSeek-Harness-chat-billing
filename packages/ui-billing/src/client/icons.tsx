/**
 * In-house glyphs shared by this plugin's entries. Today's only member is the
 * billing mark the composer spend pill and the cost card it opens both lead
 * with, so the two spend surfaces cannot drift apart iconographically.
 * @module @rayadesu/dsh-client-ui-billing/icons
 */

/**
 * The package's mark — the ring and four-point sparkle of `icon.svg` — reduced
 * to what reads in the composer's 14px glyph tier: the same single ring, with
 * the sparkle SOLID (the icon draws it as a hollow band, whose opening closes up
 * below ~20px). The whole glyph is stroked in `currentColor`, so the pill's own
 * tone governs it like every other glyph in that row.
 *
 * The sparkle is not a fresh drawing: its four edges are cubics least-squares
 * fitted to the icon's own sampled outer outline (tips pinned at 0/90/180/270,
 * r=4.36), so the pill's star and the plugin icon's star are the same shape
 * rather than two similar ones. The first version of this path paired each
 * edge's control points backwards, which made the outline self-intersect and
 * fill as a horizontal bar — the mark read as a minus-in-circle (⊖) — so
 * `icons.client.spec.tsx` now probes ink at all four tips and the centre.
 * @param props - optional size and class.
 * @returns the billing mark.
 */
export function BillingMarkIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.45" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M12.36 8 C9.93 8.33 8.41 10.01 8 12.36 C7.67 9.93 5.99 8.41 3.64 8 C6.07 7.67 7.59 5.99 8 3.64 C8.33 6.07 10.01 7.59 12.36 8 Z"
        fill="currentColor"
      />
    </svg>
  )
}
