#!/usr/bin/env node
/**
 * Compatibility patch for the generated Typert codec shape.
 *
 * `@deepseek-ai/dsh-typert-generator@0.1.6-alpha.1` — the newest line on npm —
 * emits every strict codec as `{ mode, typeSymbol, schema }`, and the
 * `dsh-typert-loader` published on that same line validates `schema` as a zod
 * v4 schema object. The harness checkout `dsh` actually runs from is AHEAD of
 * that publish: `perf(typert): materialize generated schemas on first use`
 * changed the descriptor to `{ mode, typeSymbol, create() }`, and its loader
 * rejects every codec whose `create` is not a function — which is exactly how a
 * freshly-built plugin broke profile boot on 2026-09-15:
 *
 *   typert-loader: @rayadesu/dsh-llm-billing invocation
 *   "@rayadesu/dsh-llm-billing#billing/getBalance" parameter codec has no create() factory
 *
 * Neither reader rejects the field it does not use (the newer loader reads
 * `create`, the published one reads `schema`), so carrying BOTH keeps a single
 * artifact loadable on the newer checkout runtime and on the published alpha
 * line. The browser half needs the same treatment: the newer api-gateway client
 * parses through `codec.create()`.
 *
 * Run after every build that regenerates the typert artifacts (`build:host`
 * does) and before packing/publishing. Idempotent, and exits non-zero when a
 * codec cannot be bridged, so a generator swap cannot slip past unnoticed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Generated artifacts whose strict codecs reach a DSH runtime. */
const ARTIFACTS = [
  join(ROOT, 'packages', 'llm-billing', 'lib', 'typert.host.js'),
  join(ROOT, 'packages', 'llm-billing', 'lib', 'typert.remote-client.js'),
]

/** One strict codec object: its `mode` line plus every scalar field line. */
const CODEC_BLOCK = /mode: 'strict',\n(?:[ \t]*(?:typeSymbol|schema|create): [^\n]*,\n)+/g

/**
 * Add the `create()` factory beside an emitted `schema` in every strict codec.
 * @param source - one generated artifact's text.
 * @returns the rewritten text plus how many codecs were already bridged and how
 * many could not be bridged (a codec with neither shape).
 */
function bridgeCodecs(source) {
  let bridged = 0
  let unbridgeable = 0
  const out = source.replace(CODEC_BLOCK, (block) => {
    if (/^[ \t]*create:/m.test(block)) {
      bridged += 1
      return block
    }
    const schema = /^([ \t]*)schema: ([^,\n]+),$/m.exec(block)
    if (schema === null) {
      unbridgeable += 1
      return block
    }
    bridged += 1
    return `${block}${schema[1]}create: () => ${schema[2]},\n`
  })
  return { out, bridged, unbridgeable }
}

let rewritten = 0
const failures = []

for (const artifact of ARTIFACTS) {
  const label = artifact.slice(ROOT.length + 1)
  if (!existsSync(artifact)) {
    failures.push(`${label} is missing — run the host build first`)
    continue
  }
  const source = readFileSync(artifact, 'utf8').replace(/\r\n/g, '\n')
  const strict = source.match(/mode: 'strict',/g)?.length ?? 0
  const { out, bridged, unbridgeable } = bridgeCodecs(source)
  if (unbridgeable > 0 || bridged !== strict) {
    failures.push(
      `${label}: ${String(strict)} strict codec(s), ${String(bridged)} bridged, `
      + `${String(unbridgeable)} without a create() factory or schema — `
      + 'the installed typert generator emits a shape this step does not understand',
    )
    continue
  }
  if (out === source) {
    console.log(`typert-compat: ${label}: ${String(bridged)} codec(s) already bridged`)
    continue
  }
  writeFileSync(artifact, out)
  rewritten += 1
  console.log(`typert-compat: ${label}: ${String(bridged)} codec(s) bridged`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`typert-compat: ${failure}`)
  process.exit(1)
}
console.log(`typert-compat: OK (${String(rewritten)} artifact(s) rewritten)`)
