'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type { LibraryItemForm } from '@/features/library/public'

/**
 * Wrapper client-side de `<LibraryItemForm>` con carga diferida (copia local
 * del wrapper de `(gated)/library/library-item-form-lazy.tsx` para que las
 * pages bajo `[categorySlug]/...` puedan importar sin `../../` — la regla
 * de eslint `no-restricted-syntax` los bloquea).
 *
 * Razón del lazy: el form trae el editor TipTap (~190KB gz). Sólo lo
 * necesitan las pages de crear/editar item; el browse y los listings no.
 * Usamos `next/dynamic` con `ssr: false` para sacarlo del first-load JS
 * de cualquier ruta que no monte el form.
 */
const LibraryItemFormInner = dynamic(
  () => import('@/features/library/public').then((m) => ({ default: m.LibraryItemForm })),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 animate-pulse rounded-md bg-soft" aria-label="Cargando editor" />
    ),
  },
)

type LibraryItemFormProps = ComponentProps<typeof LibraryItemForm>

export function LibraryItemFormLazy(props: LibraryItemFormProps): React.ReactNode {
  return <LibraryItemFormInner {...props} />
}
