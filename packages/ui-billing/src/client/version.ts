/**
 * The plugin's own version, reported in the spend-hint bubble so a report can
 * name the build actually in use.
 *
 * The value is stamped in at build time rather than read at runtime: a browser
 * bundle has no manifest to read. `packages/tsdown.client.ts` defines
 * `__DSH_PLUGIN_VERSION__` from this package's own `package.json` (the three
 * published packages share one version), and `vitest.config.ts` defines the
 * same constant from the same manifest so the suites see what a release ships.
 * The `typeof` guard keeps a source run without either definition (a foreign
 * bundler, a bare `tsc` check) from throwing on the undeclared global.
 * @module @rayadesu/dsh-client-ui-billing/version
 */

declare const __DSH_PLUGIN_VERSION__: string

/** The installed plugin version, e.g. `0.3.10`; `dev` when nothing stamped one. */
export const PLUGIN_VERSION: string = typeof __DSH_PLUGIN_VERSION__ === 'string'
  ? __DSH_PLUGIN_VERSION__
  : 'dev'
