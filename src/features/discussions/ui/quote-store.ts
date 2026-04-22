'use client'

import { create } from 'zustand'
import type { QuoteSnapshot } from '../domain/types'

/**
 * Store global de "cita activa" para el composer de comments. Scope: browser tab.
 * El usuario tiene a lo sumo 1 composer de thread activo a la vez — si navega a
 * otro post, el quote queda stale; el composer resetea al montar para evitar
 * arrastrar citas cross-post.
 */
type QuoteEntry = {
  commentId: string
  postId: string
  snapshot: QuoteSnapshot
}

type QuoteState = {
  quote: QuoteEntry | null
  setQuote: (entry: QuoteEntry) => void
  clearQuote: () => void
}

export const useQuoteStore = create<QuoteState>((set) => ({
  quote: null,
  setQuote: (entry) => set({ quote: entry }),
  clearQuote: () => set({ quote: null }),
}))
