import type { Metadata } from 'next'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findLibraryCategoryById } from '@/features/library/public.server'
import { CategoryDetailContent } from '../_category-detail-content'

type Props = {
  params: Promise<{ placeSlug: string; categoryId: string }>
}

/**
 * Detalle de una categoría de biblioteca. Renderea como `{children}` del
 * layout master-detail (`../layout.tsx`). En desktop, el detail vive junto
 * a la lista master (split view); en mobile, full screen con back link.
 *
 * La lógica de gate + queries + render vive en `_category-detail-content.tsx`
 * para mantener este wrapper minimal y permitir futura reutilización (e.g.
 * un eventual `[categoryId]/access/page.tsx` sub-page para permisos).
 *
 * Sesión 3.1 del rediseño `/settings/library`: setup master-detail base.
 * Sesión 3.2 migrará los dialogs internos a `<EditPanel>`.
 *
 * Ver `docs/plans/2026-05-12-settings-library-redesign.md`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { placeSlug, categoryId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) return { title: 'Categoría · Settings' }
  const category = await findLibraryCategoryById(categoryId)
  if (!category || category.placeId !== place.id) return { title: 'Categoría · Settings' }
  return { title: `${category.emoji} ${category.title} · Biblioteca · Settings` }
}

export default async function SettingsLibraryCategoryDetailPage({
  params,
}: Props): Promise<React.ReactNode> {
  const { placeSlug, categoryId } = await params
  return <CategoryDetailContent placeSlug={placeSlug} categoryId={categoryId} />
}
