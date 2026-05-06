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
import { $createApplePodcastNode, type ApplePodcastPayload } from './embed-node'
import { parseApplePodcastUrl } from './parse-url'

/** Plugin paste-handler para URLs de Apple Podcasts. */
export function ApplePodcastPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  const insertEmbed = useCallback(
    (payload: ApplePodcastPayload) => {
      editor.update(() => {
        $insertNodes([$createApplePodcastNode(payload)])
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
        const parsed = parseApplePodcastUrl(text)
        if (!parsed) return false
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false
        event.preventDefault()
        insertEmbed(parsed)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, insertEmbed])

  return null
}

export function tryInsertApplePodcastFromUrl(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  url: string,
): boolean {
  const parsed = parseApplePodcastUrl(url)
  if (!parsed) return false
  editor.update(() => {
    $insertNodes([$createApplePodcastNode(parsed)])
  })
  return true
}
