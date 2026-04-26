'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RichTextDocument } from '../domain/types'
import { editCommentAction, openCommentEditSession } from '../server/actions/comments'
import { editPostAction, openPostEditSession } from '../server/actions/posts'
import { RichTextEditor } from './rich-text-editor'
import { friendlyErrorMessage } from './utils'
import type { EditSessionState, EditWindowSubject } from './edit-window-types'

type Props = {
  subject: EditWindowSubject
  onDone: () => void
}

/**
 * Formulario inline para editar Post o Comment del autor. Abre una
 * edit-session via server action (non-admin) o recibe `adminBypass`; luego
 * dispatcha `editPostAction` / `editCommentAction` con el token.
 */
export function EditWindowForm({ subject, onDone }: Props): React.ReactNode {
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
        className="mt-2 rounded border border-border bg-surface p-3 text-xs text-muted"
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
    <div className="mt-2 space-y-2 rounded border border-border bg-surface p-3">
      {subject.kind === 'post' ? (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Editar título"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-text focus:border-bg focus:outline-none"
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
          className="rounded-md bg-accent px-3 py-1 text-sm text-bg disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1 text-sm text-muted hover:text-text"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
