import 'server-only'
import type { ReactNode } from 'react'
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
 * Resolvers inyectados por la page consumer para resolver mentions a su href
 * canónico. El slice `rich-text` no importa de `members/`, `events/` ni
 * `library/` — las pages que sí pueden importarlos construyen estos resolvers
 * y los pasan al renderer.
 *
 * Cada resolver retorna `null` si el target ya no es visible (eliminado,
 * archivado, no accesible) — el renderer pinta entonces el fallback textual
 * estipulado en `docs/features/rich-text/spec.md` § "Snapshot defensivo".
 */
export type MentionResolvers = {
  user: (id: string, placeId: string) => Promise<{ label: string; href: string } | null>
  event: (id: string, placeId: string) => Promise<{ label: string; href: string } | null>
  libraryItem: (id: string, placeId: string) => Promise<{ label: string; href: string } | null>
}

type RichTextRendererProps = {
  document: LexicalDocument | null
  resolvers: MentionResolvers
  className?: string
}

/**
 * Server Component que renderiza un `LexicalDocument` a JSX directo (visitor
 * pattern), sin instanciar el runtime de Lexical en el servidor. Las reglas
 * estilísticas (italic en links, mention bold, prosa) viven en `globals.css`
 * bajo `.rich-text`.
 *
 * Async porque los resolvers de mention pueden tirar queries (ej:
 * `findMember`, `findEvent`). Las mentions se resuelven en paralelo via
 * `Promise.all` por bloque.
 */
export async function RichTextRenderer({
  document,
  resolvers,
  className,
}: RichTextRendererProps): Promise<ReactNode> {
  const cls = ['rich-text', className].filter(Boolean).join(' ')
  if (!document || document.root.children.length === 0) {
    return <div className={cls} />
  }
  const blocks = await Promise.all(
    document.root.children.map((node, idx) => renderBlock(node, idx, resolvers)),
  )
  return <div className={cls}>{blocks}</div>
}

async function renderBlock(
  block: BlockNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block, key, resolvers)
    case 'heading':
      return renderHeading(block, key, resolvers)
    case 'list':
      return renderList(block, key, resolvers)
    case 'youtube':
    case 'spotify':
    case 'apple-podcast':
    case 'ivoox':
      return renderEmbed(block, key)
  }
}

async function renderParagraph(
  node: ParagraphNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  const children = await renderInlines(node.children, resolvers)
  return <p key={key}>{children}</p>
}

async function renderHeading(
  node: HeadingNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  const children = await renderInlines(node.children, resolvers)
  switch (node.tag) {
    case 'h1':
      return <h1 key={key}>{children}</h1>
    case 'h2':
      return <h2 key={key}>{children}</h2>
    case 'h3':
      return <h3 key={key}>{children}</h3>
  }
}

async function renderList(
  node: ListNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  const items = await Promise.all(
    node.children.map((item, idx) => renderListItem(item, idx, resolvers)),
  )
  if (node.tag === 'ol') {
    return (
      <ol key={key} start={node.start}>
        {items}
      </ol>
    )
  }
  return <ul key={key}>{items}</ul>
}

async function renderListItem(
  item: ListItemNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  // ListItem puede mezclar inlines + sub-listas; renderizamos en orden de
  // aparición para preservar la semántica del AST.
  const children: ReactNode[] = []
  for (let idx = 0; idx < item.children.length; idx++) {
    const child = item.children[idx]
    if (!child) continue
    if (child.type === 'list') {
      children.push(await renderList(child, idx, resolvers))
    } else {
      children.push(await renderInline(child, idx, resolvers))
    }
  }
  return <li key={key}>{children}</li>
}

async function renderInlines(
  nodes: ReadonlyArray<InlineNode>,
  resolvers: MentionResolvers,
): Promise<ReactNode[]> {
  return Promise.all(nodes.map((node, idx) => renderInline(node, idx, resolvers)))
}

async function renderInline(
  node: InlineNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  switch (node.type) {
    case 'text':
      return renderText(node, key)
    case 'link':
      return renderLink(node, key)
    case 'mention':
      return renderMention(node, key, resolvers)
    case 'linebreak':
      return <br key={key} />
  }
}

function renderText(node: TextNode, key: number): ReactNode {
  // Bitmask de Lexical: bold=1, italic=2, strike=4, underline=8, code=16.
  // Composamos los wrappers desde el más interno hacia afuera.
  let result: ReactNode = node.text
  if ((node.format & 16) !== 0) result = <code>{result}</code>
  if ((node.format & 4) !== 0) result = <s>{result}</s>
  if ((node.format & 8) !== 0) result = <u>{result}</u>
  if ((node.format & 2) !== 0) result = <em>{result}</em>
  if ((node.format & 1) !== 0) result = <strong>{result}</strong>
  return <span key={key}>{result}</span>
}

function renderLink(node: LinkNode, key: number): ReactNode {
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

async function renderMention(
  node: MentionNode,
  key: number,
  resolvers: MentionResolvers,
): Promise<ReactNode> {
  const resolved =
    node.kind === 'user'
      ? await resolvers.user(node.targetId, node.placeId)
      : node.kind === 'event'
        ? await resolvers.event(node.targetId, node.placeId)
        : await resolvers.libraryItem(node.targetId, node.placeId)
  if (!resolved) {
    if (node.kind === 'event') {
      return (
        <span key={key} className="rich-text-mention-fallback">
          [EVENTO NO DISPONIBLE]
        </span>
      )
    }
    if (node.kind === 'library-item') {
      return (
        <span key={key} className="rich-text-mention-fallback">
          [RECURSO NO DISPONIBLE]
        </span>
      )
    }
    // user: preserva snapshot label sin link (asimetría histórica con
    // quotedSnapshot.authorLabel — ver spec § Snapshot defensivo).
    return (
      <span key={key} className="rich-text-mention-fallback">
        @{node.label}
      </span>
    )
  }
  return (
    <a key={key} href={resolved.href} className="rich-text-mention">
      @{resolved.label}
    </a>
  )
}

function renderEmbed(node: EmbedNode, key: number): ReactNode {
  // F.4: render real con iframes sandbox + lazy. CSP debe whitelistar los
  // hosts (`next.config.ts` § frame-src). El renderer NO chequea feature
  // flags del place — eso es F.5; acá renderiza todo embed que aparezca
  // en el AST (Opción A: sin censura post-hoc).
  switch (node.type) {
    case 'youtube':
      return (
        <div key={key} className="rich-text-embed-youtube" data-embed-type="youtube">
          <iframe
            className="aspect-video w-full"
            src={`https://www.youtube-nocookie.com/embed/${node.videoId}`}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy"
            referrerPolicy="no-referrer"
            allowFullScreen
            title={`YouTube video ${node.videoId}`}
          />
        </div>
      )
    case 'spotify':
      return (
        <div key={key} className="rich-text-embed-spotify" data-embed-type="spotify">
          <iframe
            src={`https://open.spotify.com/embed/${node.kind}/${node.externalId}`}
            width="100%"
            height={352}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy"
            referrerPolicy="no-referrer"
            title={`Spotify ${node.kind} ${node.externalId}`}
          />
        </div>
      )
    case 'apple-podcast': {
      const isEpisode = !!node.episodeId
      const src = `https://embed.podcasts.apple.com/${node.region}/podcast/${node.showSlug}/id${node.showId}${
        isEpisode ? `?i=${node.episodeId}` : ''
      }`
      return (
        <div key={key} className="rich-text-embed-apple-podcast" data-embed-type="apple-podcast">
          <iframe
            src={src}
            width="100%"
            height={isEpisode ? 175 : 450}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy"
            referrerPolicy="no-referrer"
            allow="autoplay *; encrypted-media *; clipboard-write"
            title={`Apple Podcasts ${node.showSlug}`}
          />
        </div>
      )
    }
    case 'ivoox':
      return (
        <div key={key} className="rich-text-embed-ivoox" data-embed-type="ivoox">
          <iframe
            src={`https://www.ivoox.com/player_ej_${node.externalId}_4_1.html`}
            width="100%"
            height={200}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            loading="lazy"
            referrerPolicy="no-referrer"
            title={`Ivoox podcast ${node.externalId}`}
          />
        </div>
      )
  }
}
