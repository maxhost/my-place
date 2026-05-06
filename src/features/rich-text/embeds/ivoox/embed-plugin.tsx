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
import { $createIvooxNode } from './embed-node'
import { parseIvooxUrl } from './parse-url'

/** Plugin paste-handler para URLs de Ivoox. */
export function IvooxPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  const insertEmbed = useCallback(
    (externalId: string) => {
      editor.update(() => {
        $insertNodes([$createIvooxNode({ externalId })])
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
        const parsed = parseIvooxUrl(text)
        if (!parsed) return false
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false
        event.preventDefault()
        insertEmbed(parsed.externalId)
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, insertEmbed])

  return null
}

export function tryInsertIvooxFromUrl(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  url: string,
): boolean {
  const parsed = parseIvooxUrl(url)
  if (!parsed) return false
  editor.update(() => {
    $insertNodes([$createIvooxNode({ externalId: parsed.externalId })])
  })
  return true
}
