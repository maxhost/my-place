'use client'

import { createContext, useContext } from 'react'
import type {
  LibraryCategoryKind,
  LibraryReadAccessKind,
  WriteAccessKind,
} from '@/features/library/public'

/**
 * Tipos compartidos del wizard de creación/edición de categoría library.
 *
 * Vive aparte del orquestador (`category-form-sheet.tsx`) y de los step
 * components para evitar dependencias circulares y mantener cada archivo
 * bajo el cap de 300 LOC.
 *
 * Decisión de diseño: el wizard usa **un único `value: T`** que cada step
 * lee y escribe parcialmente. Más simple que un discriminated union por
 * step (el primitive es agnóstico al shape — ver
 * `src/shared/ui/wizard/wizard.tsx`).
 */

export type GroupOption = {
  id: string
  name: string
  /** Visual hint en el picker — el preset se muestra primero. */
  isPreset: boolean
}

export type MemberOption = {
  userId: string
  displayName: string
  handle: string | null
}

export type TierOption = {
  id: string
  name: string
}

/**
 * Shape del state del wizard. Cada step lee/escribe el slice que le
 * compete.
 */
export type CategoryFormValue = {
  // Step 1 — identidad
  emoji: string
  title: string
  // Step 2 — acceso de escritura (S2, 2026-05-13)
  writeAccessKind: WriteAccessKind
  writeAccessGroupIds: ReadonlyArray<string>
  writeAccessTierIds: ReadonlyArray<string>
  writeAccessUserIds: ReadonlyArray<string>
  // Step 3 — acceso de lectura. Write implica read: el step Lectura
  // pre-checkea los IDs del scope de escritura (sólo aplica si el kind
  // matchea entre los 2 steps; ej: si escritura=USERS y lectura=USERS,
  // los users del write set aparecen pre-checked en read).
  readAccessKind: LibraryReadAccessKind
  readAccessGroupIds: ReadonlyArray<string>
  readAccessTierIds: ReadonlyArray<string>
  readAccessUserIds: ReadonlyArray<string>
  // Step 4 — tipo de categoría
  kind: LibraryCategoryKind
}

/**
 * Props comunes que el orquestador pasa a los steps via Context (catalogs
 * cargados desde el page padre).
 */
export type CategoryFormCatalogs = {
  groups: ReadonlyArray<GroupOption>
  members: ReadonlyArray<MemberOption>
  tiers: ReadonlyArray<TierOption>
}

/**
 * Context para que los step components accedan a los catalogs sin que
 * el `value: T` del wizard los contenga (el value es state mutable; los
 * catalogs son read-only y vienen del server). Evita pasar catalogs por
 * props del Wizard primitive (que es agnóstico).
 */
export const CategoryFormCatalogContext = createContext<CategoryFormCatalogs | null>(null)

export function useCategoryFormCatalogs(): CategoryFormCatalogs {
  const ctx = useContext(CategoryFormCatalogContext)
  if (ctx === null) {
    throw new Error(
      'useCategoryFormCatalogs debe usarse dentro de <CategoryFormCatalogContext.Provider>',
    )
  }
  return ctx
}
