'use client'

import * as React from 'react'
import { useId } from 'react'
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import type { Klass, LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import type { LexicalDocument } from '../domain/types'
import { MentionNode } from './mentions/mention-node'
import {
  MentionPlugin,
  type ComposerMentionResolvers,
  type MentionResolversForEditor,
} from './mentions/mention-plugin'
import {
  ApplePodcastNode,
  ApplePodcastPlugin,
  IvooxNode,
  IvooxPlugin,
  SpotifyNode,
  SpotifyPlugin,
  YouTubeNode,
  YouTubePlugin,
} from '../embeds/public'

export type ComposerSurface = 'comment' | 'post' | 'event' | 'library-item'

type LexicalNodeKlass = Klass<LexicalNode>

/**
 * Lookup per-surface de los nodos que se cargan en el editor. Una surface
 * que no declara un nodo NO lo carga en el bundle ni en runtime — esa es
 * la palanca arquitectónica que motiva la migración a Lexical (ver
 * `docs/features/rich-text/spec.md` § "Surfaces consumidoras").
 *
 * `QuoteNode` se importa para satisfacer el dependency-tree de
 * `@lexical/rich-text` (lo expone como bloque por default), pero nuestro
 * subset Zod lo rechaza — el toolbar no lo expone al usuario. Así el
 * editor no tira si alguien pega un blockquote — pero el `commentDocumentSchema`
 * filtra el AST antes de persistir.
 */
const SURFACE_NODES: Record<ComposerSurface, ReadonlyArray<LexicalNodeKlass>> = {
  comment: [LinkNode, MentionNode],
  event: [LinkNode, MentionNode],
  post: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, MentionNode],
  'library-item': [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, MentionNode],
}

export type EnabledEmbeds = {
  youtube?: boolean
  spotify?: boolean
  applePodcasts?: boolean
  ivoox?: boolean
}

/**
 * Surfaces que admiten embeds. `comment` y `event` no — son superficies
 * conversacionales/breves. Spec § "Modelo del documento".
 */
function surfaceAllowsEmbeds(surface: ComposerSurface): boolean {
  return surface === 'post' || surface === 'library-item'
}

function buildNodes(
  surface: ComposerSurface,
  enabledEmbeds?: EnabledEmbeds,
): ReadonlyArray<LexicalNodeKlass> {
  const base = [...SURFACE_NODES[surface]]
  if (!surfaceAllowsEmbeds(surface) || !enabledEmbeds) return base
  if (enabledEmbeds.youtube) base.push(YouTubeNode)
  if (enabledEmbeds.spotify) base.push(SpotifyNode)
  if (enabledEmbeds.applePodcasts) base.push(ApplePodcastNode)
  if (enabledEmbeds.ivoox) base.push(IvooxNode)
  return base
}

export type BaseComposerProps = {
  surface: ComposerSurface
  initialDocument?: LexicalDocument | null
  onChange: (document: LexicalDocument) => void
  placeholder?: string
  /**
   * Resolvers para mentions. Forma legacy (`{ placeId, searchUsers }`) o
   * nueva (con triggers `/event` + `/library`). El plugin acepta ambas.
   */
  resolvers?: MentionResolversForEditor | ComposerMentionResolvers
  /**
   * Embeds toggleables por place (F.5: leer de `Place.editorPluginsConfig`).
   * Solo aplica a surfaces que admiten embeds (post / library-item).
   */
  enabledEmbeds?: EnabledEmbeds
  className?: string
  ariaLabel?: string
}

const EDITOR_THEME = {
  paragraph: 'rich-text-editor-paragraph',
  heading: {
    h1: 'rich-text-editor-h1',
    h2: 'rich-text-editor-h2',
    h3: 'rich-text-editor-h3',
  },
  list: {
    ul: 'rich-text-editor-ul',
    ol: 'rich-text-editor-ol',
    listitem: 'rich-text-editor-li',
  },
  link: 'rich-text-editor-link',
  text: {
    bold: 'rich-text-editor-bold',
    italic: 'rich-text-editor-italic',
    underline: 'rich-text-editor-underline',
  },
}

/**
 * Wrapper sobre `<LexicalComposer>` parametrizable per-surface. Carga los
 * nodos + plugins según `surface`. Los embeds (F.4) se activan vía
 * `enabledPlugins` — hoy solo se reciben para no romper el contrato cuando
 * F.4 los habilite.
 *
 * Cada montaje crea un editor independiente — Lexical mantiene su propio
 * `EditorState` y dispara `OnChangePlugin` con el JSON serializado al cambiar.
 * El consumer recibe el documento via `onChange` (debounce/transform es
 * problema del consumer — el composer no asume cadencia).
 */
export function BaseComposer({
  surface,
  initialDocument,
  onChange,
  placeholder,
  resolvers,
  enabledEmbeds,
  className,
  ariaLabel,
}: BaseComposerProps): React.JSX.Element {
  const placeholderId = useId()
  const embedsAllowed = surfaceAllowsEmbeds(surface)

  const initialConfig: InitialConfigType = {
    namespace: `place-${surface}`,
    nodes: buildNodes(surface, enabledEmbeds),
    onError: (error: Error) => {
      // El editor nunca debería propagar errores al render tree principal —
      // los logueamos en consola para diagnóstico y dejamos que LexicalErrorBoundary
      // muestre el fallback.
      console.error('[rich-text] Lexical editor error', error)
    },
    theme: EDITOR_THEME,
    ...(initialDocument ? { editorState: JSON.stringify(initialDocument) } : {}),
  }

  const containerCls = [
    'relative rounded-md border border-neutral-300 bg-white p-3 min-h-32 focus-within:border-neutral-500',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={containerCls}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="rich-text-editor-content text-base leading-relaxed outline-none"
              aria-label={ariaLabel ?? 'Editor de texto'}
              aria-placeholder={placeholder ?? 'Escribí algo…'}
              placeholder={
                <div
                  id={placeholderId}
                  className="pointer-events-none absolute left-3 top-3 text-neutral-400"
                >
                  {placeholder ?? 'Escribí algo…'}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <LinkPlugin />
        {(surface === 'post' || surface === 'library-item') && <ListPlugin />}
        {resolvers ? <MentionPlugin resolvers={resolvers} /> : null}
        {embedsAllowed && enabledEmbeds?.youtube ? <YouTubePlugin /> : null}
        {embedsAllowed && enabledEmbeds?.spotify ? <SpotifyPlugin /> : null}
        {embedsAllowed && enabledEmbeds?.applePodcasts ? <ApplePodcastPlugin /> : null}
        {embedsAllowed && enabledEmbeds?.ivoox ? <IvooxPlugin /> : null}
        <OnChangePlugin
          onChange={(editorState) => {
            // `toJSON()` produce el shape canónico `LexicalDocument` que validan
            // los schemas Zod del slice. Cualquier desincronización tira en el
            // server action al `safeParse(body)`.
            const json = editorState.toJSON() as unknown as LexicalDocument
            onChange(json)
          }}
        />
      </div>
    </LexicalComposer>
  )
}
