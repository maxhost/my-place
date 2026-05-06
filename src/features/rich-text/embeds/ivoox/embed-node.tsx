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
 * `IvooxNode` — DecoratorNode para Ivoox. Iframe del player oficial:
 * `https://www.ivoox.com/player_ej_<id>_4_1.html`. Altura 200 según
 * el embed code que Ivoox provee. (`_4_` es el modo del player, `_1`
 * el formato horizontal.)
 */
export type IvooxPayload = {
  externalId: string
}

type SerializedIvooxNode = Spread<
  {
    externalId: string
  },
  SerializedLexicalNode
>

export class IvooxNode extends DecoratorNode<React.JSX.Element> {
  __externalId: string

  static override getType(): string {
    return 'ivoox'
  }

  static override clone(node: IvooxNode): IvooxNode {
    return new IvooxNode({ externalId: node.__externalId }, node.__key)
  }

  constructor(payload: IvooxPayload, key?: NodeKey) {
    super(key)
    this.__externalId = payload.externalId
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.className = 'rich-text-embed-block'
    div.setAttribute('data-embed-type', 'ivoox')
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
      <div className="rich-text-embed-ivoox" data-embed-type="ivoox">
        <iframe
          src={`https://www.ivoox.com/player_ej_${this.__externalId}_4_1.html`}
          width="100%"
          height={200}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          loading="lazy"
          referrerPolicy="no-referrer"
          title={`Ivoox podcast ${this.__externalId}`}
        />
      </div>
    )
  }

  override exportJSON(): SerializedIvooxNode {
    return {
      type: 'ivoox',
      version: 1,
      externalId: this.__externalId,
    }
  }

  static override importJSON(serialized: SerializedIvooxNode): IvooxNode {
    return $createIvooxNode({ externalId: serialized.externalId })
  }
}

export function $createIvooxNode(payload: IvooxPayload): IvooxNode {
  return $applyNodeReplacement(new IvooxNode(payload))
}

export function $isIvooxNode(node: LexicalNode | null | undefined): node is IvooxNode {
  return node instanceof IvooxNode
}
