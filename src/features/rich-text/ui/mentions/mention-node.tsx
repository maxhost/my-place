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
 * `MentionNode` polimórfico (DecoratorNode). Un solo nodo con `kind`
 * discriminante representa mentions de:
 *  - usuarios (`kind: 'user'`, trigger `@`)
 *  - eventos (`kind: 'event'`, trigger `/event` — F.4)
 *  - items de biblioteca (`kind: 'library-item'`, trigger `/library` — F.4)
 *
 * Inline + atómico (no hay caret entre los chars), se serializa al shape
 * canónico `MentionNode` definido en `domain/types.ts` (snapshot defensivo
 * de `targetSlug` + `label` al momento de mencionar).
 *
 * F.3: el composer de `comment` usa este nodo. F.4 sumará triggers para
 * `event` y `library-item` sin necesidad de tocar la clase — sólo el
 * plugin de typeahead.
 */
export type MentionKind = 'user' | 'event' | 'library-item'

export type MentionPayload = {
  kind: MentionKind
  targetId: string
  targetSlug: string
  label: string
  placeId: string
}

type SerializedMentionNode = Spread<
  {
    kind: MentionKind
    targetId: string
    targetSlug: string
    label: string
    placeId: string
  },
  SerializedLexicalNode
>

export class MentionNode extends DecoratorNode<React.JSX.Element> {
  __kind: MentionKind
  __targetId: string
  __targetSlug: string
  __label: string
  __placeId: string

  static override getType(): string {
    return 'mention'
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(
      {
        kind: node.__kind,
        targetId: node.__targetId,
        targetSlug: node.__targetSlug,
        label: node.__label,
        placeId: node.__placeId,
      },
      node.__key,
    )
  }

  constructor(payload: MentionPayload, key?: NodeKey) {
    super(key)
    this.__kind = payload.kind
    this.__targetId = payload.targetId
    this.__targetSlug = payload.targetSlug
    this.__label = payload.label
    this.__placeId = payload.placeId
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    // Span placeholder. El contenido visible lo aporta `decorate()` via React.
    const span = document.createElement('span')
    span.className = 'rich-text-mention-token'
    span.setAttribute('data-mention-kind', this.__kind)
    span.setAttribute('data-mention-target', this.__targetId)
    return span
  }

  override updateDOM(): boolean {
    // Inmutable: una mention nunca se edita in-place. Si cambia, se reemplaza.
    return false
  }

  override isInline(): boolean {
    return true
  }

  override isKeyboardSelectable(): boolean {
    return true
  }

  override getTextContent(): string {
    return `@${this.__label}`
  }

  override decorate(): React.JSX.Element {
    const prefix = this.__kind === 'user' ? '@' : ''
    return <span className="rich-text-mention">{`${prefix}${this.__label}`}</span>
  }

  override exportJSON(): SerializedMentionNode {
    return {
      type: 'mention',
      version: 1,
      kind: this.__kind,
      targetId: this.__targetId,
      targetSlug: this.__targetSlug,
      label: this.__label,
      placeId: this.__placeId,
    }
  }

  static override importJSON(serialized: SerializedMentionNode): MentionNode {
    return $createMentionNode({
      kind: serialized.kind,
      targetId: serialized.targetId,
      targetSlug: serialized.targetSlug,
      label: serialized.label,
      placeId: serialized.placeId,
    })
  }
}

export function $createMentionNode(payload: MentionPayload): MentionNode {
  return $applyNodeReplacement(new MentionNode(payload))
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode
}
