import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Config Vitest separada para tests directos de RLS.
 *
 * - `environment: 'node'` (no jsdom): `pg` usa TCP sockets nativos.
 * - `include` acotado a `tests/rls/**`.
 * - `globals: false` e import explícito de `describe/it/etc` en cada spec.
 * - `testTimeout: 15000`: la conexión a my-place Cloud + POC de RLS puede latir.
 *
 * Se corre vía `pnpm test:rls` (con `dotenv -e .env.local` por prefix).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/rls/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@/app': resolve(__dirname, 'src/app'),
      '@/features': resolve(__dirname, 'src/features'),
      '@/shared': resolve(__dirname, 'src/shared'),
      '@/db': resolve(__dirname, 'src/db'),
    },
  },
})
