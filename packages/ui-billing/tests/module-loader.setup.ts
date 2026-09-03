/**
 * jsdom ModuleLoader shim for the DSH client bundles.
 *
 * The published @deepseek-ai/dsh-client-* packages ship their browser halves
 * as DSH client bundles: `window.__ModuleLoader__.load({ id, factory })`
 * registrations that only the web shell's module system executes. This setup
 * installs a minimal loader that runs each factory with a synchronous
 * `require` (anchored in packages/ui-billing's node_modules) and records the
 * bundle exports under `window.__DSH_BUNDLE_EXPORTS__[id]`, so specs can pull
 * the real SlotRegistry / locale plugin faces without reimplementing the
 * harness's client module system.
 *
 * Only the jsdom suites (ui-billing) install the shim; the node suites
 * (llm-billing) never see a window.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

type BundleRegistration = {
  id: string
  factory: (require: (specifier: string) => unknown) => unknown
}

type ModuleLoaderTarget = {
  load: (registration: BundleRegistration) => void
}

declare global {
  interface Window {
    __ModuleLoader__?: ModuleLoaderTarget
    __DSH_BUNDLE_EXPORTS__?: Record<string, unknown>
  }
}

if (typeof window !== 'undefined') {
  // Anchored inside packages/ui-billing so node resolution walks that
  // package's node_modules first (react, react-dom, cordis, slots, …).
  const requireFromUiBilling = createRequire(
    join(process.cwd(), 'packages/ui-billing/tests/module-loader.setup.ts'),
  )
  const bundleExports: Record<string, unknown> = {}
  window.__DSH_BUNDLE_EXPORTS__ = bundleExports
  // The locale bundle renders through two primitives components, but its
  // package cannot be required natively: lib/index.js imports .module.css
  // files. The tests never render locale UI, so inert component stubs are
  // enough to keep the bundle's factory loadable.
  const primitivesStub = {
    IconChevronDownOutline14: () => null,
    Menu: () => null,
  }
  window.__ModuleLoader__ = {
    load(registration) {
      const requireFn = (specifier: string): unknown => {
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
        // A bundle requiring another client bundle resolves to the already
        // registered exports (loader ids are package names; the caller may
        // spell the /client subpath).
        const bundleId = specifier.endsWith('/client')
          ? specifier.slice(0, -'/client'.length)
          : specifier
        if (bundleId in bundleExports) return bundleExports[bundleId]
        // The specifier may name a bundle that has not been imported yet:
        // requiring its package /client entry executes its ModuleLoader
        // registration, which this shim runs synchronously and records under
        // the package id — recheck the table before returning the raw module
        // (a Node require of a bundle file yields an empty exports object,
        // because the factory's exports live in the registration table).
        const resolved = requireFromUiBilling(specifier)
        if (bundleId in bundleExports) return bundleExports[bundleId]
        return resolved
      }
      bundleExports[registration.id] = registration.factory(requireFn)
    },
  }
}
