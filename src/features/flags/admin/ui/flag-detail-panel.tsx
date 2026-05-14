'use client'

import { ExternalLink, EyeOff, Trash2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { TimeAgo } from '@/shared/ui/time-ago'
import { toast } from '@/shared/ui/toaster'
import { reviewFlagAction } from '@/features/flags/public'
import type { FlagView } from '@/features/flags/public'
import {
  CONTENT_STATUS_CLASSES,
  CONTENT_STATUS_LABEL,
  REASON_LABEL,
  TARGET_TYPE_LABEL,
} from '../lib/labels'
import { ConfirmReviewDialog, type ConfirmKind } from './confirm-review-dialog'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Flag a mostrar. `null` cuando el panel está cerrado y nunca se abrió. */
  view: FlagView | null
  /** Callback post-action exitosa — el orchestrator cierra el panel + dispara
   *  `router.refresh()` para sincronizar el listado. */
  onAfterReview: () => void
}

/**
 * Panel de detalle (read-only) de un reporte. Mirror de `<MemberDetailPanel>`
 * / `<GroupDetailPanel>`. EditPanel responsive (sidepanel 520px desktop /
 * bottom sheet mobile).
 *
 * Secciones:
 *  - **Reporte**: reason label + reasonNote (si presente) + reporter info
 *    (con fallback "ex-miembro" si `reporterUserId === null` post-erasure) +
 *    createdAt (TimeAgo).
 *  - **Contenido reportado**: title + preview completo + link "Ver en
 *    contexto" si `postSlug` existe.
 *  - **Resolución** (solo si !OPEN): reviewedAt + reviewNote + decisión.
 *
 * Footer (solo si OPEN):
 *  - **Ignorar**: dispara `reviewFlagAction({ decision: REVIEWED_DISMISSED })`.
 *    Sin confirm (acción suave, reversible re-flagging).
 *  - **Ocultar** (solo POST + no HIDDEN/DELETED): confirm dialog → action
 *    con `sideEffect: HIDE_TARGET`.
 *  - **Eliminar** (POST | COMMENT + no DELETED): destructive confirm dialog →
 *    action con `sideEffect: DELETE_TARGET`. Hard delete POST, soft COMMENT.
 *
 * Latch interno: preserva último `view` non-null para Radix Presence exit anim.
 */
export function FlagDetailPanel({
  open,
  onOpenChange,
  view,
  onAfterReview,
}: Props): React.ReactNode {
  const router = useRouter()
  const [latched, setLatched] = useState<FlagView | null>(null)
  useEffect(() => {
    if (view) setLatched(view)
  }, [view])

  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [pendingDismiss, startDismiss] = useTransition()
  const [pendingReview, startReview] = useTransition()

  const display = view ?? latched ?? null
  if (!display) return null

  const isOpen = display.status === 'OPEN'
  const isComment = display.targetType === 'COMMENT'
  const isPost = display.targetType === 'POST'
  const alreadyHidden = display.contentStatus === 'HIDDEN'
  const alreadyDeleted = display.contentStatus === 'DELETED'

  const canHide = isPost && !alreadyHidden && !alreadyDeleted
  const canDelete = !alreadyDeleted && (isPost || isComment)

  const targetHref =
    isPost && display.postSlug
      ? `/conversations/${display.postSlug}`
      : isComment && display.postSlug
        ? `/conversations/${display.postSlug}#comment-${display.targetId}`
        : null

  function handleDismiss(): void {
    if (!display || pendingDismiss) return
    startDismiss(async () => {
      try {
        await reviewFlagAction({ flagId: display.id, decision: 'REVIEWED_DISMISSED' })
        toast.success('Reporte ignorado.')
        router.refresh()
        onAfterReview()
      } catch {
        toast.error('No pudimos aplicar la revisión. Reintentá en un momento.')
      }
    })
  }

  function handleConfirmReview(): void {
    if (!display || !confirm || pendingReview) return
    const kind = confirm
    startReview(async () => {
      try {
        if (kind === 'hide') {
          await reviewFlagAction({
            flagId: display.id,
            decision: 'REVIEWED_ACTIONED',
            sideEffect: 'HIDE_TARGET',
          })
          toast.success('Post oculto y reporte actualizado.')
        } else {
          await reviewFlagAction({
            flagId: display.id,
            decision: 'REVIEWED_ACTIONED',
            sideEffect: 'DELETE_TARGET',
          })
          toast.success(isComment ? 'Comentario eliminado.' : 'Post eliminado.')
        }
        setConfirm(null)
        router.refresh()
        onAfterReview()
      } catch {
        toast.error('No pudimos aplicar la revisión. Reintentá en un momento.')
        setConfirm(null)
      }
    })
  }

  const reasonLabel = REASON_LABEL[display.reason]
  const targetTypeLabel = TARGET_TYPE_LABEL[display.targetType]

  return (
    <>
      <EditPanel open={open} onOpenChange={onOpenChange}>
        <EditPanelContent aria-describedby={undefined}>
          <EditPanelHeader>
            <EditPanelTitle>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-normal uppercase tracking-wide text-neutral-600">
                  {targetTypeLabel}
                </span>
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-700">
                  {reasonLabel}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${CONTENT_STATUS_CLASSES[display.contentStatus]}`}
                >
                  {CONTENT_STATUS_LABEL[display.contentStatus]}
                </span>
              </span>
            </EditPanelTitle>
          </EditPanelHeader>

          <EditPanelBody>
            <div className="space-y-5 py-2">
              <section className="space-y-2">
                <h3
                  className="border-b pb-2 font-serif text-base"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Reporte
                </h3>
                <p className="text-sm text-neutral-700">
                  Razón: <span className="font-medium">{reasonLabel}</span>
                </p>
                {display.reasonNote ? (
                  <p className="whitespace-pre-line rounded-md border-l-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    {display.reasonNote}
                  </p>
                ) : null}
                <p className="text-sm text-neutral-700">
                  Reportado <TimeAgo date={display.createdAt} /> por{' '}
                  {display.reporterUserId ? (
                    <span className="font-medium">{display.reporterUserId}</span>
                  ) : (
                    <span className="italic text-neutral-500">ex-miembro</span>
                  )}
                  .
                </p>
              </section>

              <section className="space-y-2">
                <h3
                  className="border-b pb-2 font-serif text-base"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Contenido reportado
                </h3>
                {display.title ? (
                  <h4 className="font-serif text-sm text-neutral-900">{display.title}</h4>
                ) : null}
                {display.preview ? (
                  <p className="whitespace-pre-line text-sm text-neutral-700">{display.preview}</p>
                ) : (
                  <p className="text-sm italic text-neutral-500">
                    El contenido ya no está disponible.
                  </p>
                )}
                {targetHref ? (
                  <a
                    href={targetHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
                  >
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    Ver en contexto
                  </a>
                ) : null}
              </section>

              {!isOpen ? (
                <section className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                  <h3 className="font-serif text-base text-emerald-900">Resolución</h3>
                  <p className="text-sm text-emerald-900">
                    {display.status === 'REVIEWED_ACTIONED'
                      ? 'Se tomó acción sobre el contenido.'
                      : 'Se ignoró el reporte sin tomar acción.'}
                    {display.reviewedAt ? (
                      <>
                        {' '}
                        <TimeAgo date={display.reviewedAt} />.
                      </>
                    ) : null}
                  </p>
                  {display.reviewNote ? (
                    <p className="whitespace-pre-line text-sm text-emerald-900">
                      <span className="mr-1 text-xs uppercase tracking-wide text-emerald-700">
                        Nota
                      </span>
                      {display.reviewNote}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          </EditPanelBody>

          {isOpen ? (
            <EditPanelFooter>
              <button
                type="button"
                onClick={handleDismiss}
                disabled={pendingDismiss}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60"
              >
                <X aria-hidden="true" className="h-4 w-4" />
                {pendingDismiss ? 'Ignorando…' : 'Ignorar reporte'}
              </button>
              {canHide ? (
                <button
                  type="button"
                  onClick={() => setConfirm('hide')}
                  disabled={pendingReview}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                >
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                  Ocultar post
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirm('delete')}
                  disabled={pendingReview}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Eliminar {isComment ? 'comentario' : 'post'}
                </button>
              ) : null}
            </EditPanelFooter>
          ) : null}
        </EditPanelContent>
      </EditPanel>

      <ConfirmReviewDialog
        kind={confirm}
        isComment={isComment}
        pending={pendingReview}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirmReview}
      />
    </>
  )
}
