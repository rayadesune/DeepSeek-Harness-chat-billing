#!/usr/bin/env node
/**
 * Pre-publish gate for the billing plugin workspace.
 *
 * The typert host artifact every plugin package ships must be owned by the
 * package that exports it (`TYPERT.package` === package.json name), and no
 * published lib file may embed another package's manifest name. This catches
 * the historical regression where a scoped fork published upstream-built
 * artifacts that still named `@deepseek-ai/dsh-llm-billing`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notices = []

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, out)
    } else if (/\.(?:js|d\.ts|map)$/.test(entry.name)) {
      out.push(path)
    }
  }
}

for (const packageDir of readdirSync(join(ROOT, 'packages'))) {
  const dir = join(ROOT, 'packages', packageDir)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string') continue
  if (manifest.name.startsWith('@deepseek-ai/')) continue

  if (manifest.exports?.['./typert'] !== undefined) {
    const host = join(dir, 'lib', 'typert.host.js')
    if (!existsSync(host)) {
      failures.push(`${manifest.name}: exports ./typert but lib/typert.host.js is missing — run pnpm run build first`)
    } else {
      const mod = await import(pathToFileURL(host).href)
      const owned = mod.TYPERT?.package
      if (owned !== manifest.name) {
        failures.push(
          `${manifest.name}: TYPERT manifest is owned by ${JSON.stringify(owned)} `
          + `but the exporting package is ${manifest.name}`,
        )
      } else {
        notices.push(`${manifest.name}: typert host manifest owned correctly`)
      }
    }
  }

  const lib = join(dir, 'lib')
  if (!existsSync(lib)) continue
  const files = []
  walk(lib, files)
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const stale = content.match(/@deepseek-ai\/dsh-llm-billing/g)
    if (stale !== null) {
      failures.push(
        `${manifest.name}: ${relative(ROOT, file)} still embeds the upstream package name `
        + `${stale.length} time(s)`,
      )
    }
    const foreign = content.match(/package: "@deepseek-ai\/dsh-[^"]+"/g)
    if (foreign !== null) {
      failures.push(
        `${manifest.name}: ${relative(ROOT, file)} embeds a manifest owned by ${foreign.join(', ')}`,
      )
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`verify-packages: ${failure}`)
  console.error(`verify-packages: ${failures.length} failure(s)`)
  process.exit(1)
}
for (const notice of notices) console.log(`verify-packages: ${notice}`)
console.log('verify-packages: OK')
