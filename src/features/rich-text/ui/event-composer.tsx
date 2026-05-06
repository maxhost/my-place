'use client'

import * as React from 'react'
import { useState } from 'react'
import { BaseComposer } from './base-composer'
import type { LexicalDocument } from '../domain/types'
import type { ComposerMentionResolvers } from './mentions/mention-plugin'

export type EventComposerProps = {
  placeId: string
  /** Emite cambios al parent form (`<EventForm>`) — el submit lo orquesta el form. */
  onChange: (description: LexicalDocument | null) => void
  composerResolvers: ComposerMentionResolvers
  initialDocument?: LexicalDocument
  placeholder?: string
}

/**
 * Composer de descripción de evento. Surface `event`: subset minimal
 * (text + link + mention, sin headings/listas/embeds). Está pensado
 * como sub-componente de `<EventForm>`: NO incluye título ni submit
 * — sólo emite el AST al parent.
 */
export function EventComposer({
  placeId,
  onChange,
  composerResolvers,
  initialDocument,
  placeholder,
}: EventComposerProps): React.JSX.Element {
  const [, setDoc] = useState<LexicalDocument | null>(initialDocument ?? null)

  return (
    <BaseComposer
      surface="event"
      {...(initialDocument ? { initialDocument } : {})}
      onChange={(next) => {
        setDoc(next)
        onChange(next)
      }}
      placeholder={placeholder ?? 'Qué traer, cómo llegar, intenciones, links útiles…'}
      resolvers={{ ...composerResolvers, placeId }}
      ariaLabel="Editor de descripción del evento"
    />
  )
}
