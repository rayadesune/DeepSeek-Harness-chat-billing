// @vitest-environment jsdom
/**
 * The billing mark's geometry. No test used to look at this glyph, and the
 * sparkle's four cubics shipped once with their control points paired
 * backwards: the outline self-intersected and filled as a horizontal bar, so
 * the mark read as a minus-in-circle (⊖) instead of a four-point star. These
 * probes pin the shape down exactly where it broke — ink at all four tips and
 * at the centre, none outside the tips — without copying the path string in.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BillingMarkIcon } from '../src/client/icons.tsx'

afterEach(cleanup)

/** The mark's sampled outline: `d` uses only M / C / Z, cubics at 32 steps. */
function starPolygon(root: HTMLElement): Array<[number, number]> {
  const d = root.querySelector('svg path')?.getAttribute('d') ?? ''
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const cmds = d.match(/[MCZ]/g) ?? []
  const pts: Array<[number, number]> = []
  let cursor: [number, number] = [0, 0]
  let i = 0
  for (const cmd of cmds) {
    if (cmd === 'M') {
      cursor = [nums[i]!, nums[i + 1]!]
      i += 2
      pts.push(cursor)
    } else if (cmd === 'C') {
      const c1: [number, number] = [nums[i]!, nums[i + 1]!]
      const c2: [number, number] = [nums[i + 2]!, nums[i + 3]!]
      const p3: [number, number] = [nums[i + 4]!, nums[i + 5]!]
      i += 6
      for (let step = 1; step <= 32; step++) {
        const t = step / 32
        const mt = 1 - t
        pts.push([
          mt ** 3 * cursor[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p3[0],
          mt ** 3 * cursor[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p3[1],
        ])
      }
      cursor = p3
    }
  }
  return pts
}

/** Ray-cast point-in-polygon (the star is simple, so even-odd == nonzero). */
function filled(polygon: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

describe('BillingMarkIcon', () => {
  it('keeps the single ring of the package mark', () => {
    const { container } = render(<BillingMarkIcon size={14} />)
    expect(container.querySelector('svg circle')?.getAttribute('r')).toBe('6.45')
  })

  it('fills the sparkle at every tip and the centre — not a horizontal bar', () => {
    const { container } = render(<BillingMarkIcon size={14} />)
    const outline = starPolygon(container)
    // tips sit at r=4.36 along both axes; a bar-shaped fill leaves the
    // vertical tips (and a star that shrank leaves the horizontal ones) empty.
    for (const [x, y] of [
      [11.5, 8],
      [8, 11.5],
      [4.5, 8],
      [8, 4.5],
      [8, 8],
    ] as const) {
      expect(filled(outline, x, y), `ink expected at (${x}, ${y})`).toBe(true)
    }
    // ...and nothing beyond the tips, between star and ring.
    expect(filled(outline, 12.7, 8)).toBe(false)
  })
})
