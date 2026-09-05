/**
 * The vendored declaration package is not shipped or bundled: it only feeds
 * the typert generator's TypeScript program (resolved through the tsconfig
 * `paths` alias and project references). Its tsc output is emitted for
 * lib/types but must not be packed — the compiled declarations have no
 * runtime implementation, so bundling them would fail on their empty exports.
 * @module @rayadesu/dsh-billing/tsdown-typert-protocol
 */

import { defineConfig } from 'tsdown'

export default defineConfig(() => ({ entry: '' }))
