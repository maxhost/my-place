'use client'

import { ExternalLink, Trash2, X } from 'lucide-react'
import { RowActions } from '@/shared/ui/row-actions'
import { TimeAgo } from '@/shared/ui/time-ago'
import type { FlagView } from '@/features/flags/public'
import {
  CONTENT_STATUS_CLASSES,
  CONTENT_STATUS_LABEL,
  REASON_LABEL,
  TARGET_TYPE_LABEL,
} from '../lib/labels'

type Props = {
  view: FlagView
  onSelect: () => void
  /** Atajo kebab "Ignorar". Si null, NO se muestra (target ya resuelto). */
  onDismiss: (() => void) | null
  /** Atajo kebab "Eliminar". Si null, NO se muestra (resuelto o ya DELETED). */
  onDelete: (() => void) | null
}

/**
 * Row de un reporte en `/settings/flags`.
 *
 * Patrón canónico `detail-from-list` (mirror de `<MemberRow>`, `<TierCard>`):
 * el button principal cubre toda el área tappable y dispara `onSelect` (abre
 * detail panel). El kebab vive como sibling fuera del button.
 *
 * Layout de la row:
 *  - Chip targetType (POST/COMMENT/EVENT) + chip reason + chip contentStatus.
 *  - Title del POST/EVENT si aplica + preview truncado (160 chars del mapper).
 *  - TimeAgo del createdAt + estado resuelto si !OPEN.
 *
 * Kebab actions (solo OPEN):
 *  - Ver en contexto: link externo al post/comment (si `postSlug` existe).
 *  - Ignorar: action no-confirm, marca DISMISSED.
 *  - Eliminar: destructive con confirm dialog automático del primitive.
 *
 * Resueltos: row sin kebab — el detail panel muestra reviewedAt + reviewNote.
 */
export function FlagRow({ view, onSelect, onDismiss, onDelete }: Props): React.ReactNode {
  const reasonLabel = REASON_LABEL[view.reason]
  const contentStatusLabel = CONTENT_STATUS_LABEL[view.contentStatus]
  const targetTypeLabel = TARGET_TYPE_LABEL[view.targetType]
  const isResolved = view.status !== 'OPEN'

  const targetHref =
    view.targetType === 'POST' && view.postSlug
      ? `/conversations/${view.postSlug}`
      : view.targetType === 'COMMENT' && view.postSlug
        ? `/conversations/${view.postSlug}#comment-${view.targetId}`
        : null

  const actions: Array<{
    icon: React.ReactNode
    label: string
    destructive?: boolean
    confirmTitle?: string
    confirmDescription?: string
    confirmActionLabel?: string
    onSelect: () => void
  }> = []
  if (targetHref) {
    actions.push({
      icon: <ExternalLink aria-hidden="true" className="h-4 w-4" />,
      label: 'Ver en contexto',
      onSelect: () => {
        window.open(targetHref, '_blank', 'noopener,noreferrer')
      },
    })
  }
  if (onDismiss) {
    actions.push({
      icon: <X aria-hidden="true" className="h-4 w-4" />,
      label: 'Ignorar',
      onSelect: onDismiss,
    })
  }
  if (onDelete) {
    const isComment = view.targetType === 'COMMENT'
    actions.push({
      icon: <Trash2 aria-hidden="true" className="h-4 w-4" />,
      label: 'Eliminar',
      destructive: true,
      confirmTitle: isComment ? '¿Eliminar este comentario?' : '¿Eliminar este post?',
      confirmDescription: isComment
        ? 'El texto se reemplaza por «mensaje eliminado»; la posición queda en el thread.'
        : 'El post desaparece del foro junto con sus comentarios y reacciones. Acción no reversible.',
      confirmActionLabel: 'Sí, eliminar',
      onSelect: onDelete,
    })
  }

  return (
    <li className="flex min-h-[56px] items-center gap-2">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left hover:bg-neutral-50"
        aria-label={`Ver detalle del reporte ${view.id}`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 uppercase tracking-wide text-neutral-600">
              {targetTypeLabel}
            </span>
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-neutral-700">
              {reasonLabel}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${CONTENT_STATUS_CLASSES[view.contentStatus]}`}
            >
              {contentStatusLabel}
            </span>
            {isResolved ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                resuelto
              </span>
            ) : null}
          </div>
          {view.title ? (
            <h3 className="truncate font-serif text-base text-neutral-900">{view.title}</h3>
          ) : null}
          {view.preview ? (
            <p className="line-clamp-2 text-sm text-neutral-600">{view.preview}</p>
          ) : (
            <p className="text-sm italic text-neutral-500">[contenido no disponible]</p>
          )}
          <p className="text-xs text-neutral-500">
            <TimeAgo date={view.createdAt} />
          </p>
        </div>
      </button>
      {actions.length > 0 ? (
        <div className="shrink-0 pr-2">
          <RowActions
            triggerLabel={`Acciones para el reporte ${view.id}`}
            chipClassName="hidden"
            forceOverflow={true}
            actions={actions}
          >
            <span aria-hidden />
          </RowActions>
        </div>
      ) : null}
    </li>
  )
}
