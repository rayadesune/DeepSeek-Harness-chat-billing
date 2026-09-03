import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** Local copies of the renderer src files the published test-runtime imports. */
const rendererSrcClient = fileURLToPath(
  new URL('./packages/ui-billing/tests/fixtures/renderer-src/client', import.meta.url),
)

/** Lower standard TypeScript decorators before Vite's default parser sees source files. */
function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    // The linked DSH package sources resolve their own react copies from the
    // harness checkout; dedupe pins every react/react-dom import to this
    // repo's copy so hooks and JSX runtime are one engine in jsdom suites.
    dedupe: ['react', 'react-dom', 'use-sync-external-store'],
    alias: [
      // The linked DSH package sources resolve their own react copies from
      // the harness checkout; pin every react/react-dom/use-sync-external-
      // store import to this repo's copies so hooks and JSX runtime are one
      // engine in jsdom suites (dedupe does not reach paths outside the
      // project root, which the junctions are).
      {
        find: 'react',
        replacement: fileURLToPath(
          new URL('./packages/ui-billing/node_modules/react', import.meta.url),
        ),
      },
      {
        find: 'react-dom',
        replacement: fileURLToPath(
          new URL('./packages/ui-billing/node_modules/react-dom', import.meta.url),
        ),
      },
      {
        find: 'use-sync-external-store',
        replacement: fileURLToPath(
          new URL('./packages/ui-billing/node_modules/use-sync-external-store', import.meta.url),
        ),
      },
      // The published test-runtime imports renderer src files that the npm
      // renderer does not ship (bind.ts / scoped-slots.tsx /
      // session-provider.tsx). Resolve them to local fixture copies: files
      // under node_modules would hit Node's refusal to strip types there.
      {
        find: '@deepseek-ai/dsh-client-ui-renderer/src/client',
        replacement: rendererSrcClient,
      },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['packages/ui-billing/tests/module-loader.setup.ts'],
    // The published test-runtime must be processed by Vite (not externalized
    // to native Node): its renderer-src imports are aliased to local fixture
    // copies above, and its client-bundle imports need the ModuleLoader shim.
    // The primitives package must also go through Vite: our BalanceBadge
    // imports it directly, and its lib imports .module.css files, which native
    // Node cannot load (vitest stubs CSS imports).
    // RegExp (not string) patterns: vitest joins string patterns with
    // path.join, which breaks on Windows backslash ids.
    server: {
      deps: {
        inline: [
          /@deepseek-ai\/dsh-client-test-runtime/,
          /@deepseek-ai\/dsh-client-ui-primitives/,
        ],
      },
    },
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.tsx'],
  },
})
