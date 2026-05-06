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
 * `YouTubeNode` — DecoratorNode para embed de video YouTube. Bloque (no
 * inline). Render via `decorate()`: iframe de `youtube-nocookie.com` con
 * sandbox + lazy. El renderer SSR del slice padre hace lo mismo en JSX
 * directo (no instancia Lexical en server).
 *
 * Shape `YoutubeEmbed` definido en `domain/types.ts`.
 */
export type YouTubePayload = {
  videoId: string
}

type SerializedYouTubeNode = Spread<
  {
    videoId: string
  },
  SerializedLexicalNode
>

export class YouTubeNode extends DecoratorNode<React.JSX.Element> {
  __videoId: string

  static override getType(): string {
    return 'youtube'
  }

  static override clone(node: YouTubeNode): YouTubeNode {
    return new YouTubeNode({ videoId: node.__videoId }, node.__key)
  }

  constructor(payload: YouTubePayload, key?: NodeKey) {
    super(key)
    this.__videoId = payload.videoId
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = 'rich-text-embed-block'
    div.setAttribute('data-embed-type', 'youtube')
    div.setAttribute('data-video-id', this.__videoId)
    return div
  }

  override updateDOM(): boolean {
    return false
  }

  override isInline(): boolean {
    return false
  }

  override decorate(): React.JSX.Element {
    return (
      <div className="rich-text-embed-youtube" data-embed-type="youtube">
        <iframe
          className="aspect-video w-full"
          src={`https://www.youtube-nocookie.com/embed/${this.__videoId}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title={`YouTube video ${this.__videoId}`}
        />
      </div>
    )
  }

  override exportJSON(): SerializedYouTubeNode {
    return {
      type: 'youtube',
      version: 1,
      videoId: this.__videoId,
    }
  }

  static override importJSON(serialized: SerializedYouTubeNode): YouTubeNode {
    return $createYouTubeNode({ videoId: serialized.videoId })
  }
}

export function $createYouTubeNode(payload: YouTubePayload): YouTubeNode {
  return $applyNodeReplacement(new YouTubeNode(payload))
}

export function $isYouTubeNode(node: LexicalNode | null | undefined): node is YouTubeNode {
  return node instanceof YouTubeNode
}
