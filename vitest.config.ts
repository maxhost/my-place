import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/shared/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/rls/**', 'node_modules/**', '.next/**'],
    css: false,
  },
  resolve: {
    alias: {
      '@/app': resolve(__dirname, 'src/app'),
      '@/features': resolve(__dirname, 'src/features'),
      '@/shared': resolve(__dirname, 'src/shared'),
      '@/db': resolve(__dirname, 'src/db'),
      'server-only': resolve(__dirname, 'src/shared/test/server-only-stub.ts'),
    },
  },
})
