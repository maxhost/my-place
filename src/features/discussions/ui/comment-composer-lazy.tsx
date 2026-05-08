'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

const CommentComposerForm = dynamic(
  () => import('./comment-composer-form').then((m) => ({ default: m.CommentComposerForm })),
  {
    ssr: false,
    loading: () => <ComposerLoading />,
  },
)

type Props = {
  placeId: string
  postId: string
}

/**
 * Patrón Reddit mobile. Idle: button con look de input ("Sumate a la
 * conversación"). Al tap, dynamic-importa el `<CommentComposerForm>`
 * real (que arrastra Lexical + extensiones, ~126 kB gzip) y le pasa el
 * foco al contenteditable interno.
 *
 * En el primer paint del thread no hay editor — hay un placeholder
 * estático. El bundle Lexical sólo viaja al cliente cuando el viewer
 * activa el composer. Mismo patrón que Reddit, Hacker News mobile, etc.
 *
 * Trade-off UX: el primer comment de la sesión tiene un breve loading
 * (~150ms a 4G) entre tap y editor visible. Aceptable a cambio de un
 * thread page mucho más liviano (cozytech: nada parpadea, nada grita).
 */
export function CommentComposerLazy({ placeId, postId }: Props): React.JSX.Element {
  const [active, setActive] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    // Doble RAF: tras el primer frame `next/dynamic` aún muestra el
    // fallback. El segundo garantiza que `<CommentComposerForm>` ya
    // montó y el contenteditable de Lexical existe en el DOM.
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        const editable = containerRef.current?.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        )
        editable?.focus()
      })
    })
    return () => {
      cancelled = true
    }
  }, [active])

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="text-muted-foreground hover:bg-card/80 bg-card w-full rounded-md border border-border px-4 py-3 text-left text-sm"
      >
        Sumate a la conversación
      </button>
    )
  }

  return (
    <div ref={containerRef}>
      <CommentComposerForm placeId={placeId} postId={postId} />
    </div>
  )
}

function ComposerLoading(): React.JSX.Element {
  return (
    <div
      className="text-muted-foreground bg-card rounded-md border border-border px-4 py-3 text-sm"
      aria-hidden="true"
    >
      Cargando editor…
    </div>
  )
}
