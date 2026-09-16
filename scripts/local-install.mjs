#!/usr/bin/env node
/**
 * Stage-A tail in one command: build the changed build face, pack the changed
 * packages into `$DSH_HOME/local-tarballs`, reinstall them into a DSH profile
 * (`remove` + `add`, because pnpm 11 treats a same-version tarball as
 * unchanged), and count marker strings inside the INSTALLED package so the
 * round can prove the new code really shipped.
 *
 * The point is context economy: finishing a stage-A round costs ONE tool call
 * and a handful of printed lines instead of four to six calls and a wall of
 * build log. A passing step contributes one line; a failing step contributes
 * its own tail.
 *
 * Usage:
 *   node scripts/local-install.mjs ui-billing --check label.todayTokens.hit
 *   node scripts/local-install.mjs ui-billing llm-billing --face both
 *   node scripts/local-install.mjs ui-billing --dry-run
 *
 * Flags:
 *   --face client|host|both|none  build face; default per package (ui-billing
 *                                 client, llm-billing host, root none)
 *   --check <text>                marker counted in the installed lib/ (repeatable)
 *   --profile <name>              DSH profile to install into (default: web)
 *   --harness <dir>               deepseek-harness checkout (default:
 *                                 $DSH_HARNESS_DIR, else the sibling checkout,
 *                                 else `dsh` on PATH)
 *   --no-build                    skip the build step
 *   --dry-run                     print the plan and exit
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Changed-package table: CLI name -> package directory, npm name, default build face. */
const PACKAGES = {
  'ui-billing': { dir: 'packages/ui-billing', name: '@rayadesu/dsh-client-ui-billing', face: 'client' },
  'llm-billing': { dir: 'packages/llm-billing', name: '@rayadesu/dsh-llm-billing', face: 'host' },
  'billing': { dir: '.', name: '@rayadesu/dsh-billing', face: 'none' },
  'root': { dir: '.', name: '@rayadesu/dsh-billing', face: 'none' },
}

/** Build face -> root pnpm script; `none` needs no build at all. */
const BUILD_SCRIPTS = { client: 'build:client', host: 'build:host', both: 'build' }

/** Steps that end the process on failure; the `remove` step is allowed to fail. */
const TAIL_LINES = 12
const STEP_TIMEOUT_MS = 300_000

function parseArgs(argv) {
  const names = []
  const checks = []
  const options = { face: undefined, profile: 'web', harness: process.env.DSH_HARNESS_DIR, build: true, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') checks.push(argv[++i] ?? '')
    else if (arg === '--face') options.face = argv[++i]
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--harness') options.harness = argv[++i]
    else if (arg === '--no-build') options.build = false
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else names.push(arg)
  }
  if (names.length === 0) throw new Error(`no package given; expected one of ${Object.keys(PACKAGES).join(', ')}`)
  const unknown = names.filter(name => !(name in PACKAGES))
  if (unknown.length > 0) throw new Error(`unknown package ${unknown.join(', ')}; expected ${Object.keys(PACKAGES).join(', ')}`)
  if (options.face !== undefined && !(options.face in BUILD_SCRIPTS) && options.face !== 'none') {
    throw new Error(`unknown face ${options.face}; expected ${Object.keys(BUILD_SCRIPTS).join(', ')}, none`)
  }
  return { names: [...new Set(names)], checks, options }
}

/**
 * Run one child process, keeping its output out of the caller's context unless
 * it fails. `line` is a full command line run through the shell — the form
 * Windows `.cmd` shims (`npm` / `pnpm`) need, and a single string avoids the
 * DEP0190 warning that an args array under `shell: true` raises.
 */
function run(command, args, { cwd = ROOT, line } = {}) {
  const started = Date.now()
  const spawn = stdio => (line === undefined
    ? spawnSync(command, args, { cwd, timeout: STEP_TIMEOUT_MS, ...stdio })
    : spawnSync(line, { cwd, timeout: STEP_TIMEOUT_MS, shell: true, ...stdio }))
  let result = spawn({ encoding: 'utf8' })
  // A confined sandbox cannot open the pipes `spawnSync` defaults to: rerun with
  // inherited stdio (visible, uncaptured) rather than reporting a fake failure.
  if (result.error?.code === 'EPERM') result = spawn({ stdio: 'inherit' })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const error = result.error === undefined ? '' : `${result.error.code ?? 'ERROR'}: ${result.error.message}`
  return { ok: result.status === 0, stdout, stderr, output: `${stdout}${stderr}${error}`, seconds: (Date.now() - started) / 1_000 }
}

/** The `dsh` CLI as a spawnable command: the checkout's bin.js, else PATH. */
function dshCommand(harness) {
  const candidates = [harness, join(ROOT, '..', 'deepseek-harness')].filter(Boolean)
  for (const dir of candidates) {
    const bin = join(dir, 'apps', 'cli', 'lib', 'bin.js')
    if (existsSync(bin)) return { command: process.execPath, prefix: [bin] }
  }
  return { command: 'dsh', prefix: [] }
}

/** Every file under `dir` (empty when it does not exist). */
function filesUnder(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** How often `marker` occurs across the installed package's own lib/. */
function countMarker(packageDir, marker) {
  if (marker === '') return 0
  return filesUnder(join(packageDir, 'lib'))
    .reduce((sum, file) => sum + readFileSync(file, 'utf8').split(marker).length - 1, 0)
}

/** The last few lines of a failed step — the only build log that may enter context. */
function tail(output) {
  const lines = output.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  return lines.slice(-TAIL_LINES).map(line => `      | ${line}`).join('\n')
}

function main() {
  const { names, checks, options } = parseArgs(process.argv.slice(2))
  const entries = names.map(name => ({ name, ...PACKAGES[name], path: join(ROOT, PACKAGES[name].dir) }))

  const faces = new Set(options.build ? entries.map(entry => entry.face).filter(face => face !== 'none') : [])
  const face = options.face ?? (faces.size === 0 ? 'none' : faces.size === 1 ? [...faces][0] : 'both')
  const tarballDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'local-tarballs')
  const profileDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', options.profile)
  const dsh = dshCommand(options.harness)

  const plan = [
    `[dev] face ${face}${face === 'none' ? ' (no build)' : ` -> pnpm run ${BUILD_SCRIPTS[face]}`}`,
    ...entries.map(entry => `[dev] pack ${entry.name} from ${entry.dir}`),
    `[dev] install into profile ${options.profile} (remove + add)`,
    `[dev] checks: ${checks.length === 0 ? 'none' : checks.join(', ')}`,
  ]
  if (options.dryRun) {
    console.log(plan.join('\n'))
    return 0
  }

  if (face !== 'none') {
    const build = run('pnpm', [], { line: `pnpm run ${BUILD_SCRIPTS[face]}` })
    if (!build.ok) {
      console.log(`[dev] FAIL build (${BUILD_SCRIPTS[face]})\n${tail(build.output)}`)
      return 1
    }
    console.log(`[dev] build ${BUILD_SCRIPTS[face]} ok (${build.seconds.toFixed(1)}s)`)
  }

  mkdirSync(tarballDir, { recursive: true })
  const tarballs = []
  for (const entry of entries) {
    // `npm pack` prints the tarball name on STDOUT; its notices go to stderr, so
    // only stdout may be read for the name.
    const pack = run('npm', [], { cwd: entry.path, line: `npm pack --pack-destination "${tarballDir}"` })
    const name = pack.stdout.split('\n').map(line => line.trim()).filter(Boolean).pop() ?? ''
    const tarball = join(tarballDir, name)
    if (!pack.ok || !name.endsWith('.tgz') || !existsSync(tarball)) {
      console.log(`[dev] FAIL pack ${entry.name}\n${tail(pack.output)}`)
      return 1
    }
    tarballs.push(tarball)
    console.log(`[dev] pack ${entry.name} -> ${name}`)
  }

  const results = []
  const plugin = ['plugin', '--profile', options.profile]
  const invoke = (verb, value) => (dsh.prefix.length > 0
    ? run(dsh.command, [...dsh.prefix, ...plugin, verb, value])
    : run('dsh', [], { line: ['dsh', ...plugin, verb, value].join(' ') }))
  for (const [index, entry] of entries.entries()) {
    const removed = invoke('remove', entry.name)
    const added = invoke('add', tarballs[index])
    if (!added.ok) {
      console.log(`[dev] FAIL install ${entry.name}\n${tail(added.output)}`)
      return 1
    }
    results.push(`[dev] install ${entry.name} ok (remove ${removed.ok ? 'ok' : 'skipped'}, add ${added.seconds.toFixed(1)}s)`)
  }
  console.log(results.join('\n'))

  let failed = false
  for (const entry of entries) {
    const packageDir = join(profileDir, 'node_modules', ...entry.name.split('/'))
    if (!existsSync(packageDir)) {
      console.log(`[dev] FAIL check ${entry.name}: not installed under ${packageDir}`)
      failed = true
      continue
    }
    const counted = checks.map(marker => `${marker}=${countMarker(packageDir, marker)}`)
    const misses = checks.filter(marker => countMarker(packageDir, marker) === 0)
    console.log(`[dev] check ${entry.name}: ${counted.length === 0 ? 'installed' : counted.join(' ')}`)
    if (misses.length > 0) {
      console.log(`[dev] FAIL marker missing in installed lib/: ${misses.join(', ')}`)
      failed = true
    }
  }
  return failed ? 1 : 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.log(`[dev] FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
