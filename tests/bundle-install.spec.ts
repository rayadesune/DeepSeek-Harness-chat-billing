import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The install contract of the root bundle `@rayadesu/dsh-billing`: the official
 * DeepSeek Harness "Add plugin" dialog installs ONE spec (`pnpm add <spec>`),
 * and a profile initializes with `nodeLinker: hoisted` + `autoInstallPeers:
 * false` — so peer dependencies are never installed into the profile. The two
 * plugin rows must therefore travel with the bundle as regular `dependencies`
 * (hoisted into the profile's flat node_modules, where the row names resolve);
 * declaring them as peers silently breaks single-spec installation.
 */
const root = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  dsh?: { bundle?: { patch?: string } }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
const patch = readFileSync(
  fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)),
  'utf8',
)
const ROW_PACKAGES = ['@rayadesu/dsh-client-ui-billing', '@rayadesu/dsh-llm-billing'] as const

describe('bundle install contract', () => {
  it('declares the bundle patch the plugin manager inspects', () => {
    expect(root.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('installs both plugin rows as dependencies, never as peers', () => {
    for (const name of ROW_PACKAGES) {
      expect(root.dependencies?.[name], `${name} must be a dependency`).toEqual(expect.any(String))
      expect(root.peerDependencies?.[name], `${name} must not be a peer`).toBeUndefined()
    }
  })

  it('mounts exactly those two rows in the patch', () => {
    for (const name of ROW_PACKAGES) {
      expect(patch).toContain(`name: '${name}'`)
    }
  })
})
