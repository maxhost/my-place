'use client'

import { NodeViewWrapper } from '@tiptap/react'
import { ExternalLink, FileText, Link as LinkIcon, Sheet, Video } from 'lucide-react'
import type { EmbedProvider } from '@/features/library/domain/embed-parser'
import { parseEmbedUrl } from '@/features/library/domain/embed-parser'

// Tipo mínimo para NodeViewProps (evita conflicto entre node_modules
// duplicados en dev — TS detecta dos versiones de prosemirror-model).
type EmbedNodeAttrs = { url: string; provider: EmbedProvider; title: string }
type MinimalNodeViewProps = {
  node: { attrs: EmbedNodeAttrs }
  editor?: { isEditable?: boolean } | null
  deleteNode: () => void
}

/**
 * NodeView del embed (R.7.7). Renderiza inline en el body del item:
 *
 *   - youtube/vimeo/gdoc/gsheet → iframe con aspect 16:9
 *   - drive/dropbox/generic → card con icon + título + botón "Abrir"
 *
 * Usa el mismo componente para modo edit (en el composer) y modo
 * read (PostBodyRenderer del item detail). La diferencia es solo
 * el overlay de "eliminar" que se muestra cuando `editor.isEditable`.
 *
 * El parser se invoca acá runtime para resolver `canonicalUrl`. Si
 * el AST guarda `url` raw del provider (ej. youtube.com/watch?v=X),
 * el iframe necesita el `embed/X` — el parser lo deriva. Esto
 * preserva flexibilidad: si el author edita la URL, no hay que
 * recalcular nada en el AST.
 */
export function EmbedNodeView(props: MinimalNodeViewProps): React.ReactNode {
  const { node, editor, deleteNode } = props
  const url = node.attrs.url ?? ''
  const provider = node.attrs.provider ?? 'generic'
  const title = node.attrs.title ?? ''

  const isEditable = editor?.isEditable ?? false

  return (
    <NodeViewWrapper
      data-embed
      data-embed-provider={provider}
      className="my-3 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="relative">
        {renderEmbedBody({ url, provider, title })}
        {isEditable ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              deleteNode()
            }}
            className="bg-bg/80 absolute right-2 top-2 rounded-md px-2 py-1 text-xs text-muted backdrop-blur hover:text-text"
            aria-label="Eliminar contenido"
          >
            Eliminar
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

function renderEmbedBody({
  url,
  provider,
  title,
}: {
  url: string
  provider: EmbedProvider
  title: string
}): React.ReactNode {
  if (url.length === 0) {
    return <UnsupportedCard message="URL inválida" />
  }

  let parsed: ReturnType<typeof parseEmbedUrl> | null = null
  try {
    parsed = parseEmbedUrl(url)
  } catch {
    return <UnsupportedCard message="No pudimos procesar este link." url={url} />
  }

  switch (provider) {
    case 'youtube':
    case 'vimeo':
    case 'gdoc':
    case 'gsheet':
      return (
        <div className="aspect-video w-full bg-bg">
          <iframe
            src={parsed.canonicalUrl}
            title={title || parsed.canonicalUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full"
            loading="lazy"
          />
        </div>
      )
    case 'drive':
      return (
        <ExternalCard
          icon={<FileText size={20} aria-hidden="true" />}
          providerLabel="Google Drive"
          title={title || url}
          url={url}
        />
      )
    case 'dropbox':
      return (
        <ExternalCard
          icon={<FileText size={20} aria-hidden="true" />}
          providerLabel="Dropbox"
          title={title || url}
          url={url}
        />
      )
    case 'generic':
      return (
        <ExternalCard
          icon={<LinkIcon size={20} aria-hidden="true" />}
          providerLabel="Link"
          title={title || url}
          url={url}
        />
      )
    default: {
      // Exhaustive defensive — TS verifica el resto.
      const _exhaustive: never = provider
      void _exhaustive
      return <UnsupportedCard message="Tipo de embed no soportado" />
    }
  }
}

function ExternalCard({
  icon,
  providerLabel,
  title,
  url,
}: {
  icon: React.ReactNode
  providerLabel: string
  title: string
  url: string
}): React.ReactNode {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 hover:bg-soft"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{title}</p>
        <p className="truncate text-xs text-muted">{providerLabel}</p>
      </div>
      <ExternalLink size={16} aria-hidden="true" className="shrink-0 text-muted" />
    </a>
  )
}

function UnsupportedCard({ message, url }: { message: string; url?: string }): React.ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg text-muted">
        <Video size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muted">{message}</p>
        {url ? <p className="truncate text-xs text-muted">{url}</p> : null}
      </div>
      <Sheet size={16} aria-hidden="true" className="hidden" />
    </div>
  )
}
