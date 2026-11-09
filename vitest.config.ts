import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the Whop / Cloudflare / TanStack Start plugins are build-time
// only and must not load in unit tests. The `#/` and `@/` aliases mirror tsconfig.json.
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: { alias: [{ find: /^#\//, replacement: `${src}/` }, { find: /^@\//, replacement: `${src}/` }] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    testTimeout: 20000,
  },
})
