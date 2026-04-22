import { test as base } from '@playwright/test'
import path from 'node:path'
import type { E2ERole } from '../fixtures/e2e-data'

/**
 * Devuelve el path absoluto al `storageState` generado por `tests/global-setup.ts`
 * para el rol indicado. Uso en specs:
 *
 *   test.use({ storageState: storageStateFor('memberA') })
 *
 * globalSetup regenera estos archivos en cada run — no se commitean (gitignored).
 * Paths se resuelven contra `process.cwd()` (raíz del repo).
 */
export function storageStateFor(role: E2ERole): string {
  return path.resolve(process.cwd(), 'tests', '.auth', `${role}.json`)
}

/**
 * Factory de `test` con storageState pre-bindeado por rol. Uso:
 *
 *   const test = testAsRole('memberA')
 *   test('user flow', async ({ page }) => { ... })
 */
export function testAsRole(role: E2ERole) {
  return base.extend<{ storageState: string }>({
    storageState: storageStateFor(role),
  })
}

export const ROLES_WITH_PLACE_MEMBERSHIP: E2ERole[] = ['owner', 'admin', 'memberA', 'memberB']
