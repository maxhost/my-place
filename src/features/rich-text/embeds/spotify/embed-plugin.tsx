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
import { $createSpotifyNode } from './embed-node'
import { parseSpotifyUrl } from './parse-url'

/** Plugin paste-handler para URLs de Spotify (ver `youtube/embed-plugin` § comments). */
export function SpotifyPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  const insertEmbed = useCallback(
    (kind: 'track' | 'episode' | 'show' | 'playlist' | 'album', externalId: string) => {
      editor.update(() => {
        $insertNodes([$createSpotifyNode({ kind, externalId })])
      })
    },
    [editor],
  )

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false
        const text = event.clipboardData?.getData('text/plain')?.trim()
        if (!text) return false
        const parsed = parseSpotifyUrl(text)
        if (!parsed) return false
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false
        event.preventDefault()
        insertEmbed(parsed.kind, parsed.externalId)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, insertEmbed])

  return null
}

export function tryInsertSpotifyFromUrl(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  url: string,
): boolean {
  const parsed = parseSpotifyUrl(url)
  if (!parsed) return false
  editor.update(() => {
    $insertNodes([$createSpotifyNode({ kind: parsed.kind, externalId: parsed.externalId })])
  })
  return true
}
