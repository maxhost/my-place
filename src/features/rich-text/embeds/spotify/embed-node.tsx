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
 * `SpotifyNode` — DecoratorNode para embed de Spotify (5 tipos: track,
 * episode, show, playlist, album). Iframe de `open.spotify.com/embed/...`
 * con sandbox + lazy. Altura: 152 para tracks compactos no aplica en MVP
 * (todos los kinds usan 352, el mismo que Spotify recomienda en su
 * generador oficial).
 */
export type SpotifyKind = 'track' | 'episode' | 'show' | 'playlist' | 'album'

export type SpotifyPayload = {
  kind: SpotifyKind
  externalId: string
}

type SerializedSpotifyNode = Spread<
  {
    kind: SpotifyKind
    externalId: string
  },
  SerializedLexicalNode
>

export class SpotifyNode extends DecoratorNode<React.JSX.Element> {
  __kind: SpotifyKind
  __externalId: string

  static override getType(): string {
    return 'spotify'
  }

  static override clone(node: SpotifyNode): SpotifyNode {
    return new SpotifyNode({ kind: node.__kind, externalId: node.__externalId }, node.__key)
  }

  constructor(payload: SpotifyPayload, key?: NodeKey) {
    super(key)
    this.__kind = payload.kind
    this.__externalId = payload.externalId
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = 'rich-text-embed-block'
    div.setAttribute('data-embed-type', 'spotify')
    div.setAttribute('data-spotify-kind', this.__kind)
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
      <div className="rich-text-embed-spotify" data-embed-type="spotify">
        <iframe
          src={`https://open.spotify.com/embed/${this.__kind}/${this.__externalId}`}
          width="100%"
          height={352}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          loading="lazy"
          referrerPolicy="no-referrer"
          title={`Spotify ${this.__kind} ${this.__externalId}`}
        />
      </div>
    )
  }

  override exportJSON(): SerializedSpotifyNode {
    return {
      type: 'spotify',
      version: 1,
      kind: this.__kind,
      externalId: this.__externalId,
    }
  }

  static override importJSON(serialized: SerializedSpotifyNode): SpotifyNode {
    return $createSpotifyNode({ kind: serialized.kind, externalId: serialized.externalId })
  }
}

export function $createSpotifyNode(payload: SpotifyPayload): SpotifyNode {
  return $applyNodeReplacement(new SpotifyNode(payload))
}

export function $isSpotifyNode(node: LexicalNode | null | undefined): node is SpotifyNode {
  return node instanceof SpotifyNode
}
