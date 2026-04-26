'use client'

import React, { useState } from 'react'
import { FlagModal } from './flag-modal'

type Props = {
  targetType: 'POST' | 'COMMENT' | 'EVENT'
  targetId: string
  className?: string
}

/**
 * Trigger discreto para reportar un Post, Comment o Event. Abre el `FlagModal`
 * interno. Se monta en `PostDetail` (junto a `ReactionBar`), `CommentItem`
 * (junto a `ReactionBar`) y `EventDetail` (F.D Fase 6). Por principio de
 * producto no va en `<ThreadRow>` / `<FeaturedThreadCard>` ni en
 * `EventListItem` — ver `docs/decisions/2026-04-21-flags-subslice-split.md` §5.
 */
export function FlagButton({ targetType, targetId, className }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Reportar este contenido"
        className={
          className ??
          'inline-flex items-center justify-center rounded p-1 text-muted transition-colors hover:text-text'
        }
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 2v12" />
          <path d="M3 3h9l-2 3 2 3H3" />
        </svg>
      </button>
      <FlagModal targetType={targetType} targetId={targetId} open={open} onOpenChange={setOpen} />
    </>
  )
}
