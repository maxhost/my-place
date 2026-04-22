'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { TimeAgo } from '@/shared/ui/time-ago'
import { toast } from '@/shared/ui/toaster'
import { reviewFlagAction } from '../server/actions'
import type { FlagView } from '../domain/types'

const REASON_LABEL: Record<FlagView['reason'], string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Acoso',
  OFFTOPIC: 'Fuera de tema',
  MISINFO: 'Desinformación',
  OTHER: 'Otro',
}

const CONTENT_STATUS_LABEL: Record<FlagView['contentStatus'], string> = {
  VISIBLE: 'visible',
  HIDDEN: 'oculto',
  DELETED: 'eliminado',
}

type Props = {
  view: FlagView
}

type ConfirmState = { kind: 'dismiss' } | { kind: 'hide' } | { kind: 'delete' } | null

export function FlagQueueItem({ view }: Props): React.ReactElement {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [pending, startTransition] = useTransition()

  const isComment = view.targetType === 'COMMENT'
  const alreadyGone = view.contentStatus === 'DELETED'
  const alreadyHidden = view.contentStatus === 'HIDDEN'
  const isResolved = view.status !== 'OPEN'

  function submit(
    decision: 'REVIEWED_ACTIONED' | 'REVIEWED_DISMISSED',
    sideEffect: 'HIDE_TARGET' | 'DELETE_TARGET' | null,
    successCopy: string,
  ): void {
    startTransition(async () => {
      try {
        await reviewFlagAction({ flagId: view.id, decision, sideEffect })
        toast.success(successCopy)
        setConfirm(null)
        router.refresh()
      } catch {
        toast.error('No pudimos aplicar la revisión. Reintentá en un momento.')
      }
    })
  }

  const targetHref =
    view.targetType === 'POST' && view.postSlug
      ? `/conversations/${view.postSlug}`
      : view.targetType === 'COMMENT' && view.postSlug
        ? `/conversations/${view.postSlug}#comment-${view.targetId}`
        : null

  return (
    <li className="rounded-lg border border-place-divider bg-place-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs text-place-text-soft">
            <span className="rounded-full border border-place-divider px-2 py-0.5 uppercase tracking-wide">
              {view.targetType}
            </span>
            <span>·</span>
            <span className="font-medium">{REASON_LABEL[view.reason]}</span>
            <span>·</span>
            <TimeAgo date={view.createdAt} />
            <span>·</span>
            <span className="italic">{CONTENT_STATUS_LABEL[view.contentStatus]}</span>
          </div>
          {view.title ? (
            <h3 className="font-serif text-base text-place-text">{view.title}</h3>
          ) : null}
          {view.preview ? (
            <p className="text-sm text-place-text-soft">{view.preview}</p>
          ) : (
            <p className="text-sm italic text-place-text-soft">[contenido no disponible]</p>
          )}
          {view.reasonNote ? (
            <p className="bg-place-mark-bg/30 mt-2 rounded border-l-2 border-place-divider px-3 py-1.5 text-sm text-place-text">
              <span className="mr-1 text-xs uppercase text-place-text-soft">Nota:</span>
              {view.reasonNote}
            </p>
          ) : null}
          {targetHref ? (
            <a
              href={targetHref}
              className="inline-block text-xs text-place-text-soft underline hover:text-place-text"
            >
              Ver en contexto
            </a>
          ) : null}
          {isResolved ? (
            <p className="mt-2 text-xs italic text-place-text-soft">
              Resuelto {view.status === 'REVIEWED_ACTIONED' ? 'con acción' : 'sin acción'}
              {view.reviewedAt ? ' · ' : null}
              {view.reviewedAt ? <TimeAgo date={view.reviewedAt} /> : null}
            </p>
          ) : null}
        </div>
      </div>

      {!isResolved ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirm({ kind: 'dismiss' })}
            disabled={pending}
            className="rounded px-3 py-1.5 text-sm text-place-text-soft hover:text-place-text"
          >
            Ignorar
          </button>
          {!isComment ? (
            <button
              type="button"
              onClick={() => setConfirm({ kind: 'hide' })}
              disabled={pending || alreadyHidden || alreadyGone}
              className="hover:bg-place-mark-bg/30 rounded border border-place-divider px-3 py-1.5 text-sm text-place-text disabled:opacity-50"
            >
              Ocultar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirm({ kind: 'delete' })}
            disabled={pending || alreadyGone}
            className="rounded bg-[color:var(--place-mark-bg)] px-3 py-1.5 text-sm font-medium text-[color:var(--place-mark-fg)] disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (pending) return
          if (!next) setConfirm(null)
        }}
      >
        <DialogContent>
          {confirm?.kind === 'dismiss' ? (
            <>
              <DialogTitle>Ignorar este reporte</DialogTitle>
              <DialogDescription>
                Se marca el reporte como revisado sin acción. El contenido queda como está.
              </DialogDescription>
              <ConfirmActions
                pending={pending}
                onCancel={() => setConfirm(null)}
                onConfirm={() => submit('REVIEWED_DISMISSED', null, 'Reporte ignorado.')}
                confirmLabel="Ignorar reporte"
              />
            </>
          ) : null}
          {confirm?.kind === 'hide' ? (
            <>
              <DialogTitle>Ocultar este post</DialogTitle>
              <DialogDescription>
                Los miembros dejarán de ver el post. Admin puede des-ocultarlo después.
              </DialogDescription>
              <ConfirmActions
                pending={pending}
                onCancel={() => setConfirm(null)}
                onConfirm={() =>
                  submit('REVIEWED_ACTIONED', 'HIDE_TARGET', 'Post oculto y cola actualizada.')
                }
                confirmLabel="Ocultar post"
              />
            </>
          ) : null}
          {confirm?.kind === 'delete' ? (
            <>
              <DialogTitle>Eliminar {isComment ? 'este comentario' : 'este post'}</DialogTitle>
              <DialogDescription>
                {isComment
                  ? 'El texto del comentario se reemplaza por «mensaje eliminado»; la posición queda en el thread.'
                  : 'El post desaparece del foro junto con sus comentarios y reacciones. La acción no es reversible.'}
              </DialogDescription>
              <ConfirmActions
                pending={pending}
                onCancel={() => setConfirm(null)}
                onConfirm={() =>
                  submit(
                    'REVIEWED_ACTIONED',
                    'DELETE_TARGET',
                    isComment ? 'Comentario eliminado.' : 'Post eliminado.',
                  )
                }
                confirmLabel="Eliminar"
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </li>
  )
}

function ConfirmActions({
  pending,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
}): React.ReactElement {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded px-3 py-1.5 text-sm text-place-text-soft hover:text-place-text"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="rounded bg-[color:var(--place-mark-bg)] px-3 py-1.5 text-sm font-medium text-[color:var(--place-mark-fg)] disabled:opacity-60"
      >
        {pending ? 'Aplicando…' : confirmLabel}
      </button>
    </div>
  )
}
