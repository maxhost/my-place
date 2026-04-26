import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import type {
  RichTextBlockNode,
  RichTextCodeBlock,
  RichTextDocument,
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
  }
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
