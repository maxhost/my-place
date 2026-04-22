'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EDIT_WINDOW_MS } from '../domain/invariants'
import type { RichTextDocument } from '../domain/types'
import {
  deleteCommentAction,
  editCommentAction,
  openCommentEditSession,
} from '../server/actions/comments'
import { deletePostAction, editPostAction, openPostEditSession } from '../server/actions/posts'
import { RichTextEditor } from './rich-text-editor'
import { friendlyErrorMessage } from './utils'

type EditSessionState =
  | { state: 'loading' }
  | { state: 'ready'; session: { token: string; openedAt: string } | null }
  | { state: 'error'; message: string }

/**
 * Acciones editar/eliminar para el autor dentro de los 60s. Tras expirar la
 * ventana, el componente deja de renderizar. Admin tiene flujos separados
 * (no aplica acá — lo cubre C.G).
 */

type PostSubject = {
  kind: 'post'
  postId: string
  title: string
  body: RichTextDocument | null
  createdAt: Date
  version: number
  placeSlug: string
}

type CommentSubject = {
  kind: 'comment'
  commentId: string
  body: RichTextDocument
  createdAt: Date
  version: number
}

type Props = { subject: PostSubject | CommentSubject }

export function EditWindowActions({ subject }: Props): React.ReactNode {
  const [remaining, setRemaining] = useState(() => remainingMs(subject.createdAt, new Date()))
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm-delete'>('idle')

  useEffect(() => {
    if (remaining <= 0) return
    const id = setInterval(() => {
      setRemaining(remainingMs(subject.createdAt, new Date()))
    }, 2_000)
    return () => clearInterval(id)
  }, [subject.createdAt, remaining])

  if (mode === 'edit') {
    return <EditForm subject={subject} onDone={() => setMode('idle')} />
  }

  if (mode === 'confirm-delete') {
    return <ConfirmDelete subject={subject} onCancel={() => setMode('idle')} />
  }

  if (remaining <= 0) return null

  const seconds = Math.ceil(remaining / 1000)
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-place-text-whisper">
      <button
        type="button"
        onClick={() => setMode('edit')}
        className="text-place-text-soft hover:text-place-text focus:outline-none focus-visible:underline"
      >
        Editar
      </button>
      <button
        type="button"
        onClick={() => setMode('confirm-delete')}
        className="text-place-text-soft hover:text-place-text focus:outline-none focus-visible:underline"
      >
        Eliminar
      </button>
      <span aria-live="polite">{seconds}s restantes</span>
    </div>
  )
}

function remainingMs(createdAt: Date, now: Date): number {
  return Math.max(0, EDIT_WINDOW_MS - (now.getTime() - createdAt.getTime()))
}

function EditForm({
  subject,
  onDone,
}: {
  subject: PostSubject | CommentSubject
  onDone: () => void
}): React.ReactNode {
  const router = useRouter()
  const [body, setBody] = useState<RichTextDocument | null>(
    subject.kind === 'post' ? subject.body : subject.body,
  )
  const [title, setTitle] = useState(subject.kind === 'post' ? subject.title : '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [session, setSession] = useState<EditSessionState>({ state: 'loading' })

  const subjectKey =
    subject.kind === 'post' ? `post:${subject.postId}` : `comment:${subject.commentId}`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result =
          subject.kind === 'post'
            ? await openPostEditSession({ postId: subject.postId })
            : await openCommentEditSession({ commentId: subject.commentId })
        if (cancelled) return
        if ('adminBypass' in result) {
          setSession({ state: 'ready', session: null })
          return
        }
        setSession({
          state: 'ready',
          session: { token: result.session.token, openedAt: result.session.openedAt },
        })
      } catch (err) {
        if (cancelled) return
        setSession({ state: 'error', message: friendlyErrorMessage(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [subjectKey, subject])

  if (session.state === 'loading') {
    return (
      <div
        className="mt-2 rounded border border-place-divider bg-place-card p-3 text-xs text-place-text-soft"
        aria-live="polite"
      >
        Abriendo edición…
      </div>
    )
  }

  if (session.state === 'error') {
    return (
      <div className="mt-2 space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p role="alert" aria-live="polite">
          {session.message}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1 text-xs text-amber-900 hover:underline"
        >
          Cerrar
        </button>
      </div>
    )
  }

  const sessionPayload = session.session

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        if (subject.kind === 'post') {
          await editPostAction({
            postId: subject.postId,
            title,
            body: body ?? null,
            expectedVersion: subject.version,
            ...(sessionPayload ? { session: sessionPayload } : {}),
          })
        } else {
          if (!body) {
            setError('El comentario no puede estar vacío.')
            return
          }
          await editCommentAction({
            commentId: subject.commentId,
            body,
            expectedVersion: subject.version,
            ...(sessionPayload ? { session: sessionPayload } : {}),
          })
        }
        router.refresh()
        onDone()
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-place-divider bg-place-card p-3">
      {subject.kind === 'post' ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Editar título"
          className="w-full rounded border border-place-divider bg-place-card px-2 py-1 text-place-text focus:border-place-mark-fg focus:outline-none"
        />
      ) : null}
      <RichTextEditor content={body} onChange={setBody} />
      {error ? (
        <p role="alert" aria-live="polite" className="text-xs text-amber-700">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-place-mark-bg px-3 py-1 text-sm text-place-mark-fg disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1 text-sm text-place-text-soft hover:text-place-text"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function ConfirmDelete({
  subject,
  onCancel,
}: {
  subject: PostSubject | CommentSubject
  onCancel: () => void
}): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        if (subject.kind === 'post') {
          await deletePostAction({
            postId: subject.postId,
            expectedVersion: subject.version,
          })
          router.replace(`/conversations`)
        } else {
          await deleteCommentAction({
            commentId: subject.commentId,
            expectedVersion: subject.version,
          })
        }
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>¿Eliminar definitivamente? No se puede deshacer.</span>
      {error ? (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-amber-700 px-3 py-1 text-xs text-white disabled:opacity-60"
        >
          {pending ? 'Eliminando…' : 'Sí, eliminar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-xs text-amber-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
