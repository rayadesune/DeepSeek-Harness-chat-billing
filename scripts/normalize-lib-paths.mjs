#!/usr/bin/env node
/**
 * Make the committed `lib/` artifacts machine-independent.
 *
 * The built files ship inside the repository (a git install gets no build
 * step, so the artifacts must be present), which turns every build-machine
 * path into repository content. The one that does: the client bundle's
 * `dsh-css-modules-inline` virtual module id, which the bundler writes into a
 * `//#region \0dsh-css:<absolute path>.mjs` comment — the path is a build
 * diagnostic, nothing reads it at runtime, but it differs per checkout and
 * would make every build show up as a diff.
 *
 * The comment is cut back to the module's file name, which is what the marker
 * is good for and is identical on every machine — and, unlike a
 * repo-root-relative rewrite, holds even when the checkout lives somewhere
 * this script never saw. The rewrite is idempotent and touches nothing else;
 * run it after every build that regenerates `lib/`.
 *
 * Usage: node scripts/normalize-lib-paths.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The bundler's region marker for an inlined CSS module, with an absolute
 * virtual path after `\0dsh-css:`. Captured so the path can be replaced with
 * its own base name whatever the build machine's layout was.
 */
const CSS_MODULE_REGION = /(\\0dsh-css:)([^\s"']+?)(\.mjs)/g

/** Every file under the workspace packages' built `lib/` directories. */
function libFiles() {
  const packages = join(ROOT, 'packages')
  const out = []
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const lib = join(packages, entry.name, 'lib')
    try {
      readdirSync(lib)
    } catch {
      continue
    }
    const walk = (dir) => {
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, child.name)
        if (child.isDirectory()) walk(path)
        else out.push(path)
      }
    }
    walk(lib)
  }
  return out
}

let rewritten = 0
for (const file of libFiles()) {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(CSS_MODULE_REGION, (_match, prefix, virtualPath, suffix) => (
    `${prefix}${basename(virtualPath)}${suffix}`
  ))
  if (next === text) continue
  writeFileSync(file, next)
  rewritten += 1
  console.log(`normalized ${relative(ROOT, file)}`)
}

console.log(`normalize-lib-paths: ${rewritten} file(s) rewritten`)
