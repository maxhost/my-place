'use client'

import * as React from 'react'
import type {
  BlockNode,
  EmbedNode,
  HeadingNode,
  InlineNode,
  LexicalDocument,
  LinkNode,
  ListItemNode,
  ListNode,
  MentionNode,
  ParagraphNode,
  TextNode,
} from '../domain/types'

/**
 * Client renderer ligero del Lexical AST. Usado por las islas client que
 * appendean comments en tiempo real (`CommentThreadLive`) — el SSR usa
 * `RichTextRenderer` con resolvers async (queries Prisma).
 *
 * Diferencias con el server renderer:
 *  - Las mentions se renderean siempre con su `label` snapshot (no se
 *    resuelven a href). El próximo `revalidatePath` re-rendea el comment
 *    en SSR con resolvers reales y los enriquece a links.
 *  - No es async — el render es síncrono.
 *  - Misma marca CSS (`.rich-text`) para que el estilo sea consistente.
 */
export function RichTextRendererClient({
  document,
  className,
}: {
  document: LexicalDocument | null
  className?: string
}): React.JSX.Element {
  const cls = ['rich-text', className].filter(Boolean).join(' ')
  if (!document || document.root.children.length === 0) {
    return <div className={cls} />
  }
  return (
    <div className={cls}>{document.root.children.map((block, idx) => renderBlock(block, idx))}</div>
  )
}

function renderBlock(block: BlockNode, key: number): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block, key)
    case 'heading':
      return renderHeading(block, key)
    case 'list':
      return renderList(block, key)
    case 'youtube':
    case 'spotify':
    case 'apple-podcast':
    case 'ivoox':
      return renderEmbed(block, key)
  }
}

function renderParagraph(node: ParagraphNode, key: number): React.ReactNode {
  return <p key={key}>{node.children.map((c, i) => renderInline(c, i))}</p>
}

function renderHeading(node: HeadingNode, key: number): React.ReactNode {
  const children = node.children.map((c, i) => renderInline(c, i))
  switch (node.tag) {
    case 'h1':
      return <h1 key={key}>{children}</h1>
    case 'h2':
      return <h2 key={key}>{children}</h2>
    case 'h3':
      return <h3 key={key}>{children}</h3>
  }
}

function renderList(node: ListNode, key: number): React.ReactNode {
  const items = node.children.map((item, idx) => renderListItem(item, idx))
  if (node.tag === 'ol') {
    return (
      <ol key={key} start={node.start}>
        {items}
      </ol>
    )
  }
  return <ul key={key}>{items}</ul>
}

function renderListItem(item: ListItemNode, key: number): React.ReactNode {
  const children: React.ReactNode[] = []
  for (let idx = 0; idx < item.children.length; idx++) {
    const child = item.children[idx]
    if (!child) continue
    if (child.type === 'list') {
      children.push(renderList(child, idx))
    } else {
      children.push(renderInline(child, idx))
    }
  }
  return <li key={key}>{children}</li>
}

function renderInline(node: InlineNode, key: number): React.ReactNode {
  switch (node.type) {
    case 'text':
      return renderText(node, key)
    case 'link':
      return renderLink(node, key)
    case 'mention':
      return renderMention(node, key)
    case 'linebreak':
      return <br key={key} />
  }
}

function renderText(node: TextNode, key: number): React.ReactNode {
  let result: React.ReactNode = node.text
  if ((node.format & 16) !== 0) result = <code>{result}</code>
  if ((node.format & 4) !== 0) result = <s>{result}</s>
  if ((node.format & 8) !== 0) result = <u>{result}</u>
  if ((node.format & 2) !== 0) result = <em>{result}</em>
  if ((node.format & 1) !== 0) result = <strong>{result}</strong>
  return <span key={key}>{result}</span>
}

function renderLink(node: LinkNode, key: number): React.ReactNode {
  const text = node.children.map((child, idx) => renderText(child, idx))
  return (
    <a
      key={key}
      href={node.url}
      rel={node.rel ?? undefined}
      target={node.target ?? undefined}
      title={node.title ?? undefined}
    >
      {text}
    </a>
  )
}

function renderMention(node: MentionNode, key: number): React.ReactNode {
  const prefix = node.kind === 'user' ? '@' : ''
  return (
    <span key={key} className="rich-text-mention">
      {`${prefix}${node.label}`}
    </span>
  )
}

function renderEmbed(node: EmbedNode, key: number): React.ReactNode {
  return (
    <div key={key} className="rich-text-embed-placeholder" data-embed-type={node.type}>
      <span>[{node.type}]</span>
    </div>
  )
}
