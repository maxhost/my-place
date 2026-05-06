'use client'

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $insertNodes, type TextNode } from 'lexical'
import { $createMentionNode } from './mention-node'

export type MentionUserResult = {
  userId: string
  displayName: string
  handle?: string | null
}

export type MentionResolversForEditor = {
  placeId: string
  searchUsers: (q: string) => Promise<MentionUserResult[]>
}

class UserMentionOption extends MenuOption {
  user: MentionUserResult
  constructor(user: MentionUserResult) {
    super(user.userId)
    this.user = user
  }
}

const MAX_RESULTS = 8

/**
 * Plugin de mention para `@user` (trigger `@`). F.4 agregará triggers
 * `/event` y `/library` con sus propios resolvers — esos viven en sus
 * propios plugins consumidores de `MentionNode` para no acoplar slices.
 *
 * Usa `LexicalTypeaheadMenuPlugin`: detecta el patrón `@<query>`,
 * dispara `searchUsers(query)` debounced via React state + paint, y al
 * confirmar inserta un `MentionNode(kind: 'user', ...)` reemplazando el
 * texto del trigger.
 */
export function MentionPlugin({
  resolvers,
}: {
  resolvers: MentionResolversForEditor
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const [options, setOptions] = useState<UserMentionOption[]>([])

  const triggerFn = useBasicTypeaheadTriggerMatch('@', { minLength: 0, maxLength: 50 })

  // Cargar resultados al cambiar la query. Cancela el efecto previo via
  // boolean local (no AbortController — la API de `searchUsers` no lo
  // requiere y sería over-engineering para un autocomplete de 8 hits).
  useEffect(() => {
    if (query === null) {
      setOptions([])
      return
    }
    let active = true
    void resolvers.searchUsers(query).then((results) => {
      if (!active) return
      setOptions(results.slice(0, MAX_RESULTS).map((u) => new UserMentionOption(u)))
    })
    return () => {
      active = false
    }
  }, [query, resolvers])

  const onSelectOption = useCallback(
    (selectedOption: UserMentionOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const mention = $createMentionNode({
          kind: 'user',
          targetId: selectedOption.user.userId,
          targetSlug: selectedOption.user.handle ?? selectedOption.user.userId,
          label: selectedOption.user.displayName,
          placeId: resolvers.placeId,
        })
        if (nodeToReplace) {
          nodeToReplace.replace(mention)
        } else {
          $insertNodes([mention])
        }
      })
      closeMenu()
    },
    [editor, resolvers.placeId],
  )

  return (
    <LexicalTypeaheadMenuPlugin<UserMentionOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (anchorElementRef.current === null || options.length === 0) return null
        return createPortal(
          <div className="rich-text-mention-menu rounded-md border border-neutral-200 bg-white py-1 shadow-md">
            <ul role="listbox" className="m-0 list-none p-0">
              {options.map((option, idx) => (
                <li
                  key={option.user.userId}
                  ref={option.setRefElement}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selectedIndex === idx}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => {
                    setHighlightedIndex(idx)
                    selectOptionAndCleanUp(option)
                  }}
                  className={[
                    'cursor-pointer px-3 py-2 text-sm',
                    selectedIndex === idx ? 'bg-neutral-100' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="font-medium">{option.user.displayName}</span>
                  {option.user.handle ? (
                    <span className="ml-2 text-neutral-500">@{option.user.handle}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>,
          anchorElementRef.current,
        )
      }}
    />
  )
}
