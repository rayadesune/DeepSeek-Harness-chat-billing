import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Reject an unknown build face instead of silently building the wrong half. */
function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * Workspace build: the host pass compiles each package's lib/types entries and
 * runs the typert generator (host face), which emits lib/typert.host.js and
 * lib/typert.remote-client.* for packages exporting ./typert. The client pass
 * lets package-local configs emit browser bundles.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: ['packages/*'],
    entry: client ? '' : ['lib/types/{index,invariant}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
