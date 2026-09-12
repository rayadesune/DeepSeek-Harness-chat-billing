/**
 * In-house glyphs shared by this plugin's entries. Today's only member is the
 * money bag the composer spend card and the per-turn cost label both lead with,
 * so the two spend surfaces cannot drift apart iconographically.
 * @module @rayadesu/dsh-client-ui-billing/icons
 */

/**
 * In-house money-bag glyph in the hollow-outline style (16px viewBox, stroke
 * currentColor, fill none), referencing the 💰 emoji: a bag outline with a
 * tie knot at the neck and a centered yuan mark on the body. The drawing
 * fills the 16px box like the other glyphs; a host that renders it at 14px
 * (the DSH glyph tier) keeps the same geometry and only scales down.
 * @param props - optional size and class.
 * @returns the money-bag icon.
 */
export function WalletIcon({ size = 16, className }: { size?: number; className?: string }) {
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
      <path
        d="M4.8 2.7 L5.2 5.2 C2.4 6.6 1.6 9.0 2.7 11.2 C3.4 12.8 5.5 13.6 8 13.6 C10.5 13.6 12.6 12.8 13.3 11.2 C14.4 9.0 13.6 6.6 10.8 5.2 L11.2 2.7 M6.6 1.4 L9.4 2.4 M9.4 1.4 L6.6 2.4 M5.6 5.5 L8 8.2 L10.4 5.5 M8 8.2 V12.4 M5.8 9.2 H10.2 M5.8 10.9 H10.2"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
