'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type { LibraryItemForm } from '@/features/library/public'

/**
 * Wrapper client-side de `<LibraryItemForm>` con carga diferida (copia local
 * para evitar `../../` desde `[itemSlug]/edit/page.tsx`; ver gemelo en
 * `(gated)/library/library-item-form-lazy.tsx`).
 *
 * Saca el editor TipTap (~190KB gz) del first-load JS de pages que no
 * montan el form. Usamos `next/dynamic` con `ssr: false`.
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
