'use client'

import { useState, useTransition } from 'react'
import type { ContentTargetKind, ReactionEmoji } from '../domain/types'
import { reactAction, unreactAction } from '../server/actions/reactions'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { REACTION_EMOJI_DISPLAY } from '../domain/invariants'
import { friendlyErrorMessage } from './utils'

/**
 * Barra de 6 emojis. Optimistic toggle: actualiza el count local antes de
 * esperar la action; en error revierte y muestra copy amistoso.
 */
const EMOJI_GLYPHS: Record<ReactionEmoji, string> = {
  THUMBS_UP: '👍',
  HEART: '❤️',
  LAUGH: '😂',
  PRAY: '🙏',
  THINKING: '🤔',
  CRY: '😢',
}

const EMOJI_LABELS: Record<ReactionEmoji, string> = {
  THUMBS_UP: 'pulgar arriba',
  HEART: 'corazón',
  LAUGH: 'risa',
  PRAY: 'gracias',
  THINKING: 'pensativo',
  CRY: 'tristeza',
}

type Props = {
  targetType: ContentTargetKind
  targetId: string
  initial: AggregatedReaction[]
}

type ReactionState = Record<ReactionEmoji, { count: number; viewerReacted: boolean }>

function buildInitialState(initial: AggregatedReaction[]): ReactionState {
  const state = {} as ReactionState
  for (const e of REACTION_EMOJI_DISPLAY) {
    state[e] = { count: 0, viewerReacted: false }
  }
  for (const r of initial) {
    state[r.emoji] = { count: r.count, viewerReacted: r.viewerReacted }
  }
  return state
}

export function ReactionBar({ targetType, targetId, initial }: Props): React.ReactNode {
  const [state, setState] = useState<ReactionState>(() => buildInitialState(initial))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (emoji: ReactionEmoji) => {
    if (pending) return
    const prev = state[emoji]
    const next = {
      count: prev.viewerReacted ? Math.max(0, prev.count - 1) : prev.count + 1,
      viewerReacted: !prev.viewerReacted,
    }
    setState((s) => ({ ...s, [emoji]: next }))
    setError(null)

    startTransition(async () => {
      try {
        const action = prev.viewerReacted ? unreactAction : reactAction
        await action({ targetType, targetId, emoji })
      } catch (err) {
        setState((s) => ({ ...s, [emoji]: prev }))
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {REACTION_EMOJI_DISPLAY.map((emoji) => {
          const { count, viewerReacted } = state[emoji]
          return (
            <button
              key={emoji}
              type="button"
              aria-pressed={viewerReacted}
              aria-label={`Reaccionar con ${EMOJI_LABELS[emoji]}`}
              onClick={() => toggle(emoji)}
              className={`focus-visible:ring-accent/50 inline-flex min-h-[30px] items-center gap-1 rounded-full border-[0.5px] px-2.5 py-1 text-[13px] focus:outline-none focus-visible:ring-2 motion-safe:transition-colors ${
                viewerReacted
                  ? 'border-accent/40 bg-accent/10 text-text'
                  : 'border-border bg-surface text-muted hover:border-muted hover:text-text'
              }`}
            >
              <span aria-hidden="true">{EMOJI_GLYPHS[emoji]}</span>
              <span className="min-w-[1ch] tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>
      {error ? (
        <p role="alert" aria-live="polite" className="mt-1 text-xs text-amber-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
