import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { ExternalLink, FileText, Link as LinkIcon } from 'lucide-react'
import type {
  RichTextBlockNode,
  RichTextCodeBlock,
  RichTextDocument,
  RichTextEmbed,
  RichTextInlineNode,
  RichTextListItem,
  RichTextMark,
  RichTextText,
} from '../domain/types'

/**
 * SSR-seguro: camina el AST y emite JSX puro. Sin `dangerouslySetInnerHTML`,
 * sin TipTap del lado server. El AST ya está validado por `richTextDocumentSchema`
 * — acá sólo mapeamos tipos conocidos.
 *
 * Mentions se renderizan como `<Link>` al perfil contextual cuando `placeSlug`
 * está disponible; si no, caen a texto plano `@label` (previene links rotos en
 * contextos sin place).
 */
export function RichTextRenderer({
  doc,
  placeSlug,
}: {
  doc: RichTextDocument
  placeSlug?: string
}): ReactNode {
  return (
    <>
      {doc.content.map((node, i) => (
        <Fragment key={i}>{renderBlock(node, placeSlug)}</Fragment>
      ))}
    </>
  )
}

function renderBlock(node: RichTextBlockNode, placeSlug?: string): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p className="my-2 leading-relaxed">{renderInline(node.content ?? [], placeSlug)}</p>
    case 'heading': {
      const level = node.attrs.level
      const cls =
        level === 2 ? 'mt-4 mb-2 text-xl font-semibold' : 'mt-3 mb-2 text-lg font-semibold'
      return level === 2 ? (
        <h2 className={cls}>{renderInline(node.content ?? [], placeSlug)}</h2>
      ) : (
        <h3 className={cls}>{renderInline(node.content ?? [], placeSlug)}</h3>
      )
    }
    case 'bulletList':
      return (
        <ul className="my-2 list-disc space-y-1 pl-6">
          {renderListItems(node.content, placeSlug)}
        </ul>
      )
    case 'orderedList':
      return (
        <ol className="my-2 list-decimal space-y-1 pl-6">
          {renderListItems(node.content, placeSlug)}
        </ol>
      )
    case 'blockquote':
      return (
        <blockquote className="my-3 border-l-4 border-border pl-4 text-muted">
          {node.content.map((child, i) => (
            <Fragment key={i}>{renderBlock(child, placeSlug)}</Fragment>
          ))}
        </blockquote>
      )
    case 'codeBlock':
      return renderCodeBlock(node)
    case 'embed':
      return renderEmbed(node)
  }
}

/**
 * Render SSR del embed node. La URL canonical ya viene guardada en
 * `attrs.url` (post-parse en EmbedToolbar de library) — el renderer
 * usa el switch de provider directo sin parser. Genérico: discussions
 * NO importa de library, solo conoce el shape del nodo.
 */
function renderEmbed(node: RichTextEmbed): ReactNode {
  const { url, provider, title } = node.attrs
  const safeTitle = title?.trim() ?? ''

  switch (provider) {
    case 'youtube':
    case 'vimeo':
    case 'gdoc':
    case 'gsheet':
      return (
        <div className="my-3 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="aspect-video w-full bg-bg">
            <iframe
              src={url}
              title={safeTitle || url}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full"
              loading="lazy"
            />
          </div>
        </div>
      )
    case 'drive':
      return (
        <EmbedExternalCard
          icon={<FileText size={20} aria-hidden="true" />}
          providerLabel="Google Drive"
          title={safeTitle || url}
          url={url}
        />
      )
    case 'dropbox':
      return (
        <EmbedExternalCard
          icon={<FileText size={20} aria-hidden="true" />}
          providerLabel="Dropbox"
          title={safeTitle || url}
          url={url}
        />
      )
    case 'generic':
    default:
      return (
        <EmbedExternalCard
          icon={<LinkIcon size={20} aria-hidden="true" />}
          providerLabel="Link"
          title={safeTitle || url}
          url={url}
        />
      )
  }
}

function EmbedExternalCard({
  icon,
  providerLabel,
  title,
  url,
}: {
  icon: ReactNode
  providerLabel: string
  title: string
  url: string
}): ReactNode {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="my-3 flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface px-4 py-3 hover:bg-soft"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg text-muted">
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

function renderListItems(items: RichTextListItem[], placeSlug?: string): ReactNode {
  return items.map((item, i) => (
    <li key={i}>
      {item.content.map((child, j) => (
        <Fragment key={j}>{renderBlock(child, placeSlug)}</Fragment>
      ))}
    </li>
  ))
}

function renderCodeBlock(node: RichTextCodeBlock): ReactNode {
  const text = (node.content ?? []).map((t) => t.text).join('')
  return (
    <pre className="my-3 overflow-x-auto rounded bg-accent p-3 text-sm text-bg">
      <code>{text}</code>
    </pre>
  )
}

function renderInline(nodes: RichTextInlineNode[], placeSlug?: string): ReactNode {
  return nodes.map((node, i) => <Fragment key={i}>{renderInlineNode(node, placeSlug)}</Fragment>)
}

function renderInlineNode(node: RichTextInlineNode, placeSlug?: string): ReactNode {
  if (node.type === 'mention') {
    const label = `@${node.attrs.label}`
    if (placeSlug) {
      return (
        <Link href={`/m/${node.attrs.userId}`} className="place-mention text-bg hover:underline">
          {label}
        </Link>
      )
    }
    return <span className="place-mention">{label}</span>
  }
  if (node.type === 'hardBreak') {
    return <br />
  }
  return renderTextWithMarks(node)
}

function renderTextWithMarks(node: RichTextText): ReactNode {
  const marks = node.marks ?? []
  return marks.reduceRight<ReactNode>((acc, mark) => wrapMark(acc, mark), node.text)
}

function wrapMark(children: ReactNode, mark: RichTextMark): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>
    case 'italic':
      return <em>{children}</em>
    case 'code':
      return (
        <code className="rounded bg-accent px-1 py-[1px] text-[0.95em] text-bg">{children}</code>
      )
    case 'link':
      return (
        <a
          href={mark.attrs.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-bg underline underline-offset-2"
        >
          {children}
        </a>
      )
  }
}
