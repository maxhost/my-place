'use client'

import * as React from 'react'
import { useCallback, useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
} from 'lexical'
import { $createYouTubeNode } from './embed-node'
import { parseYoutubeUrl } from './parse-url'

/**
 * Plugin React para insertar/parsear embeds de YouTube. Dos canales:
 *  1. Toolbar: el `BaseComposer` toolbar invoca `insertYouTubeEmbed(url)` —
 *     esta función se expone como prop callback para integrar con un
 *     prompt input simple (F.4 lo conecta al toolbar real).
 *  2. Paste: si el usuario pega una URL de YouTube directamente en el
 *     editor, el plugin la captura y la transforma en un nodo.
 *
 * El plugin retorna `null` (no renderiza UI propia — hooks-only).
 */
export function YouTubePlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  const insertEmbed = useCallback(
    (videoId: string) => {
      editor.update(() => {
        const node = $createYouTubeNode({ videoId })
        $insertNodes([node])
      })
    },
    [editor],
  )

  // Listener de paste: si el clipboard contiene una URL de YouTube y no hay
  // selection rango (es una posición), insertamos el embed inline. Si hay
  // texto seleccionado, NO interceptamos (preserva el behavior por default
  // de paste-replace).
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false
        const text = event.clipboardData?.getData('text/plain')?.trim()
        if (!text) return false
        const parsed = parseYoutubeUrl(text)
        if (!parsed) return false
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false
        event.preventDefault()
        insertEmbed(parsed.videoId)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, insertEmbed])

  return null
}

/**
 * Helper exportable para uso desde un toolbar externo: prompt para URL,
 * parse, insert. Retorna `true` si insertó, `false` si la URL no matcheaba.
 */
export function tryInsertYouTubeFromUrl(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  url: string,
): boolean {
  const parsed = parseYoutubeUrl(url)
  if (!parsed) return false
  editor.update(() => {
    $insertNodes([$createYouTubeNode({ videoId: parsed.videoId })])
  })
  return true
}
