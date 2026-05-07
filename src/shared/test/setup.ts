import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

/**
 * Mock global de `next/cache`. Los queries del repo que usan
 * `unstable_cache` (loadPlaceBySlug/Id, listMyPlaces, findInviterPermissions,
 * etc.) corren bajo `unstable_cache` real en prod; en tests usamos
 * pass-through. Tests que necesiten capturar los args de `unstable_cache`
 * (ej: `find-inviter-permissions.test.ts`) declaran su propio
 * `vi.mock('next/cache', ...)` que sobrescribe este global.
 *
 * `revalidatePath` y `revalidateTag` se mockean como spies por defecto;
 * tests que afirmen sobre las invocaciones lo redeclaran con su propia
 * `vi.fn()` capturable.
 */
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))
