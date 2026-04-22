import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { FlagQueueItem, mapFlagToView } from '@/features/flags/public'
import type { FlagStatus } from '@/features/flags/public'
import { listFlagTargetSnapshots, listFlagsByPlace } from '@/features/flags/public.server'

export const metadata: Metadata = {
  title: 'Reportes · Settings',
}

type Tab = 'pending' | 'resolved'

type Props = {
  params: Promise<{ placeSlug: string }>
  searchParams: Promise<{ tab?: string; cursor?: string }>
}

const PENDING_STATUSES = ['OPEN'] as const satisfies readonly FlagStatus[]
const RESOLVED_STATUSES = [
  'REVIEWED_ACTIONED',
  'REVIEWED_DISMISSED',
] as const satisfies readonly FlagStatus[]

/**
 * Cola de reportes del place con dos tabs: Pendientes (`OPEN`) y Resueltos
 * (`REVIEWED_*`). Paginación cursor-based con page size 20. Gate admin/owner
 * ya aplicado por `settings/layout.tsx`.
 *
 * Ver `docs/features/discussions/spec.md` § 10.
 */
export default async function SettingsFlagsPage({ params, searchParams }: Props) {
  const { placeSlug } = await params
  const search = await searchParams

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const tab: Tab = search.tab === 'resolved' ? 'resolved' : 'pending'
  const cursor = decodeCursor(search.cursor)
  const status = tab === 'pending' ? PENDING_STATUSES : RESOLVED_STATUSES

  const { items, nextCursor } = await listFlagsByPlace({
    placeId: place.id,
    status,
    cursor,
  })
  const snapshots = await listFlagTargetSnapshots(items)
  const views = items.map((flag) => {
    const key = `${flag.targetType}:${flag.targetId}`
    return mapFlagToView(flag, snapshots.get(key) ?? null)
  })

  const nextHref = nextCursor
    ? `/settings/flags?tab=${tab}&cursor=${encodeCursor(nextCursor)}`
    : null

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <header>
        <p className="text-sm text-place-text-soft">Settings · {place.name}</p>
        <h1 className="font-serif text-3xl italic text-place-text">Reportes</h1>
      </header>

      <nav aria-label="Filtrar reportes" className="flex gap-1 border-b border-place-divider">
        <TabLink tab="pending" active={tab === 'pending'}>
          Pendientes
        </TabLink>
        <TabLink tab="resolved" active={tab === 'resolved'}>
          Resueltos
        </TabLink>
      </nav>

      {views.length === 0 ? (
        <p className="rounded-lg border border-place-divider bg-place-card p-6 text-sm italic text-place-text-soft">
          {tab === 'pending' ? 'No hay reportes pendientes.' : 'No hay reportes resueltos todavía.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {views.map((view) => (
            <FlagQueueItem key={view.id} view={view} />
          ))}
        </ul>
      )}

      {nextHref ? (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            className="rounded-md border border-place-divider bg-place-card px-4 py-2 text-sm text-place-text-soft hover:text-place-text"
          >
            Siguientes →
          </Link>
        </div>
      ) : null}
    </main>
  )
}

function TabLink({
  tab,
  active,
  children,
}: {
  tab: Tab
  active: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Link
      href={`/settings/flags?tab=${tab}`}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'border-b-2 border-place-mark-fg px-4 py-2 text-sm font-medium text-place-text'
          : 'px-4 py-2 text-sm text-place-text-soft hover:text-place-text'
      }
    >
      {children}
    </Link>
  )
}

function encodeCursor(cursor: { createdAt: Date; id: string }): string {
  return encodeURIComponent(`${cursor.createdAt.toISOString()}:${cursor.id}`)
}

function decodeCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null
  const decoded = decodeURIComponent(raw)
  const idx = decoded.indexOf(':')
  if (idx === -1) return null
  const iso = decoded.slice(0, idx)
  const id = decoded.slice(idx + 1)
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null
  return { createdAt, id }
}
