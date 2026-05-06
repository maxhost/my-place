'use client'

import * as React from 'react'
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'

/**
 * `ApplePodcastNode` — DecoratorNode para Apple Podcasts. Iframe de
 * `embed.podcasts.apple.com/...`. Altura: 175 si hay `episodeId`, 450
 * para el show entero (recomendado por Apple).
 */
export type ApplePodcastPayload = {
  region: string
  showSlug: string
  showId: string
  episodeId?: string | undefined
}

type SerializedApplePodcastNode = Spread<
  {
    region: string
    showSlug: string
    showId: string
    episodeId?: string | undefined
  },
  SerializedLexicalNode
>

export class ApplePodcastNode extends DecoratorNode<React.JSX.Element> {
  __region: string
  __showSlug: string
  __showId: string
  __episodeId?: string | undefined

  static override getType(): string {
    return 'apple-podcast'
  }

  static override clone(node: ApplePodcastNode): ApplePodcastNode {
    return new ApplePodcastNode(
      {
        region: node.__region,
        showSlug: node.__showSlug,
        showId: node.__showId,
        episodeId: node.__episodeId,
      },
      node.__key,
    )
  }

  constructor(payload: ApplePodcastPayload, key?: NodeKey) {
    super(key)
    this.__region = payload.region
    this.__showSlug = payload.showSlug
    this.__showId = payload.showId
    this.__episodeId = payload.episodeId
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = 'rich-text-embed-block'
    div.setAttribute('data-embed-type', 'apple-podcast')
    return div
  }

  override updateDOM(): boolean {
    return false
  }

  override isInline(): boolean {
    return false
  }

  override decorate(): React.JSX.Element {
    const isEpisode = !!this.__episodeId
    const src = `https://embed.podcasts.apple.com/${this.__region}/podcast/${this.__showSlug}/id${this.__showId}${
      isEpisode ? `?i=${this.__episodeId}` : ''
    }`
    return (
      <div className="rich-text-embed-apple-podcast" data-embed-type="apple-podcast">
        <iframe
          src={src}
          width="100%"
          height={isEpisode ? 175 : 450}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          loading="lazy"
          referrerPolicy="no-referrer"
          allow="autoplay *; encrypted-media *; clipboard-write"
          title={`Apple Podcasts ${this.__showSlug}`}
        />
      </div>
    )
  }

  override exportJSON(): SerializedApplePodcastNode {
    return {
      type: 'apple-podcast',
      version: 1,
      region: this.__region,
      showSlug: this.__showSlug,
      showId: this.__showId,
      episodeId: this.__episodeId,
    }
  }

  static override importJSON(serialized: SerializedApplePodcastNode): ApplePodcastNode {
    return $createApplePodcastNode({
      region: serialized.region,
      showSlug: serialized.showSlug,
      showId: serialized.showId,
      episodeId: serialized.episodeId,
    })
  }
}

export function $createApplePodcastNode(payload: ApplePodcastPayload): ApplePodcastNode {
  return $applyNodeReplacement(new ApplePodcastNode(payload))
}

export function $isApplePodcastNode(
  node: LexicalNode | null | undefined,
): node is ApplePodcastNode {
  return node instanceof ApplePodcastNode
}
