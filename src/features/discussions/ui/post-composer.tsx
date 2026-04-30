'use client'

import { useEffect, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import { POST_TITLE_MAX_LENGTH, POST_TITLE_MIN_LENGTH } from '../domain/invariants'
import { createPostInputSchema, editPostInputSchema } from '../schemas'
import { createPostAction, editPostAction, openPostEditSession } from '../server/actions/posts'
import type { RichTextDocument } from '../domain/types'
import { RichTextEditor } from './rich-text-editor'
import { friendlyErrorMessage } from './utils'

type EditSessionState =
  | { state: 'loading' }
  | { state: 'ready'; session: { token: string; openedAt: string } | null }
  | { state: 'error'; message: string }

type FormValues = { title: string }

type Feedback = { kind: 'ok' | 'err'; message: string }

type CreateMode = {
  kind: 'create'
  placeId: string
}

type EditMode = {
  kind: 'edit'
  postId: string
  initialTitle: string
  initialBody: RichTextDocument | null
  expectedVersion: number
  /** Slug actual del post — para volver al detalle tras guardar. */
  slug: string
}

type Props = { mode: CreateMode | EditMode }

/**
 * Form de crear / editar Post. La misma UI sirve ambos modos: `mode.kind` decide
 * qué action se invoca, adónde navegar al terminar, y qué pre-carga arrastra.
 * El slug se preserva en edits (regenerarlo rompería links ya compartidos).
 */
export function PostComposer({ mode }: Props): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'title' | 'body', string>> | null>(
    null,
  )
  const [body, setBody] = useState<RichTextDocument | null>(
    mode.kind === 'edit' ? mode.initialBody : null,
  )
  const [editSession, setEditSession] = useState<EditSessionState>(() =>
    mode.kind === 'edit' ? { state: 'loading' } : { state: 'ready', session: null },
  )

  const editPostId = mode.kind === 'edit' ? mode.postId : null
  useEffect(() => {
    if (!editPostId) return
    let cancelled = false
    void (async () => {
      try {
        const result = await openPostEditSession({ postId: editPostId })
        if (cancelled) return
        if ('adminBypass' in result) {
          setEditSession({ state: 'ready', session: null })
          return
        }
        setEditSession({
          state: 'ready',
          session: {
            token: result.session.token,
            openedAt: result.session.openedAt,
          },
        })
      } catch (err) {
        if (cancelled) return
        setEditSession({ state: 'error', message: friendlyErrorMessage(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editPostId])

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { title: mode.kind === 'edit' ? mode.initialTitle : '' },
  })

  function onSubmit(values: FormValues) {
    setFeedback(null)
    setFieldErrors(null)

    if (mode.kind === 'create') {
      const parsed = createPostInputSchema.safeParse({
        placeId: mode.placeId,
        title: values.title,
        body: body ?? null,
      })
      if (!parsed.success) {
        setFieldErrors(collectFieldErrors(parsed.error.issues))
        return
      }
      startTransition(async () => {
        try {
          const result = await createPostAction(parsed.data)
          reset({ title: '' })
          setBody(null)
          // `replace` (no `push`): el form `/conversations/new` queda
          // obsoleto tras el submit. Reemplazar evita que el BackButton
          // del thread recién creado vuelva al form vacío.
          router.replace(`/conversations/${result.slug}`)
        } catch (err) {
          setFeedback({ kind: 'err', message: friendlyErrorMessage(err) })
        }
      })
      return
    }

    const sessionPayload = editSession.state === 'ready' ? editSession.session : null
    const parsed = editPostInputSchema.safeParse({
      postId: mode.postId,
      title: values.title,
      body: body ?? null,
      expectedVersion: mode.expectedVersion,
      ...(sessionPayload ? { session: sessionPayload } : {}),
    })
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error.issues))
      return
    }
    startTransition(async () => {
      try {
        await editPostAction(parsed.data)
        // `replace` por la misma razón que en create: el form
        // `/conversations/new?edit=<id>` queda obsoleto tras editar.
        router.replace(`/conversations/${mode.slug}`)
        router.refresh()
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyErrorMessage(err) })
      }
    })
  }

  const sessionBlocked = mode.kind === 'edit' && editSession.state !== 'ready'
  const submitLabel =
    mode.kind === 'create'
      ? pending
        ? 'Publicando…'
        : 'Publicar'
      : pending
        ? 'Guardando…'
        : editSession.state === 'loading'
          ? 'Abriendo edición…'
          : 'Guardar cambios'

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
      {feedback?.kind === 'err' ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {feedback.message}
        </div>
      ) : null}

      {mode.kind === 'edit' && editSession.state === 'error' ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {editSession.message}
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-sm text-muted">Título</span>
        <input
          type="text"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
          maxLength={POST_TITLE_MAX_LENGTH}
          aria-invalid={fieldErrors?.title ? true : undefined}
          {...register('title', {
            required: true,
            minLength: POST_TITLE_MIN_LENGTH,
          })}
        />
        {fieldErrors?.title ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.title}</span>
        ) : null}
      </label>

      <div>
        <span className="mb-1 block text-sm text-muted">Contenido</span>
        <RichTextEditor content={body} onChange={setBody} ariaLabel="Escribir contenido del post" />
        {fieldErrors?.body ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.body}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || sessionBlocked}
          className="rounded-md bg-accent px-4 py-2 text-bg disabled:opacity-60"
        >
          {submitLabel}
        </button>
        {mode.kind === 'edit' ? (
          <button
            type="button"
            onClick={() => {
              // Smart back: si hay history (caso típico — user llegó al
              // form via kebab desde el thread), `router.back()` pops el
              // entry sin pollutar history. Si vino por deep link (history
              // length 1), fallback a router.push del thread. Sin esto,
              // BackButton del thread post-cancel terminaba volviendo al
              // form (router.push agregaba entry doble al history).
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back()
              } else {
                router.push(`/conversations/${mode.slug}`)
              }
            }}
            disabled={pending}
            className="rounded-md px-3 py-2 text-sm text-muted hover:text-text"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  )
}

function collectFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<'title' | 'body', string>> {
  const errs: Partial<Record<'title' | 'body', string>> = {}
  for (const issue of issues) {
    const key = issue.path[0] as 'title' | 'body' | undefined
    if (key && !errs[key]) errs[key] = issue.message
  }
  return errs
}
