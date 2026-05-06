'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $insertNodes, type TextNode } from 'lexical'
import { $createMentionNode } from './mention-node'

// ---------------------------------------------------------------
// Resolver shapes
// ---------------------------------------------------------------

export type MentionUserResult = {
  userId: string
  displayName: string
  handle?: string | null
}

export type MentionEventResult = {
  eventId: string
  slug: string
  title: string
}

export type MentionLibraryCategoryResult = {
  categoryId: string
  slug: string
  name: string
}

export type MentionLibraryItemResult = {
  itemId: string
  slug: string
  title: string
}

/**
 * Forma legacy (F.3): un único resolver para users. El plugin lo acepta para
 * no romper consumers que ya están en producción (CommentComposer y la
 * superficie comment).
 */
export type MentionResolversForEditor = {
  placeId: string
  searchUsers: (q: string) => Promise<MentionUserResult[]>
}

/**
 * Forma extendida (F.4): 4 resolvers + `placeId`. Cubre `@user`,
 * `/event ` y `/library/<cat>[/<q>]`. La forma legacy es un subset.
 */
export type ComposerMentionResolvers = {
  placeId: string
  searchUsers: (q: string) => Promise<MentionUserResult[]>
  searchEvents?: (q: string) => Promise<MentionEventResult[]>
  listCategories?: () => Promise<MentionLibraryCategoryResult[]>
  searchLibraryItems?: (categorySlug: string, q: string) => Promise<MentionLibraryItemResult[]>
}

// ---------------------------------------------------------------
// Trigger union
// ---------------------------------------------------------------

type Trigger =
  | { kind: 'user'; query: string }
  | { kind: 'event'; query: string }
  | { kind: 'library-category'; query: string }
  | { kind: 'library-item'; categorySlug: string; query: string }

const MAX_RESULTS = 8

class GenericMenuOption extends MenuOption {
  payload: MenuPayload
  constructor(payload: MenuPayload) {
    super(payload.id)
    this.payload = payload
  }
}

type MenuPayload =
  | { id: string; type: 'user'; user: MentionUserResult }
  | { id: string; type: 'event'; event: MentionEventResult }
  | {
      id: string
      type: 'library-category'
      category: MentionLibraryCategoryResult
    }
  | {
      id: string
      type: 'library-item'
      item: MentionLibraryItemResult
      categorySlug: string
    }

// ---------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------

/**
 * Plugin de mentions polimórfico. Detecta 3 triggers:
 *  - `@<query>` → usuarios.
 *  - `/event <query>` → eventos del place.
 *  - `/library` → categorías; `/library/<categorySlug>[ <q>]` → items de la
 *    categoría seleccionada.
 *
 * Cada confirmación inserta un `MentionNode` con el `kind` correcto,
 * snapshot de label + slug al momento.
 */
export function MentionPlugin({
  resolvers,
}: {
  resolvers: MentionResolversForEditor | ComposerMentionResolvers
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [options, setOptions] = useState<GenericMenuOption[]>([])

  // El typeahead `@user` usa el matcher built-in (mantiene comportamiento
  // de F.3). Triggers `/event` y `/library` los detectamos manualmente
  // via callback.
  const userTriggerFn = useBasicTypeaheadTriggerMatch('@', { minLength: 0, maxLength: 50 })

  // Capabilities derivadas: si la forma legacy no provee, los triggers
  // `/event` y `/library` quedan inertes.
  const composer = resolvers as ComposerMentionResolvers
  const supportsEvents = typeof composer.searchEvents === 'function'
  const supportsLibrary =
    typeof composer.listCategories === 'function' &&
    typeof composer.searchLibraryItems === 'function'

  // -----------------------------
  // Match function combinada
  // -----------------------------

  const triggerFn = useCallback(
    (text: string) => {
      // 1. Probamos `/library/<cat>` y `/library/<cat>/<q>` antes que `/library`
      //    bare — la forma con cat es más específica.
      if (supportsLibrary) {
        const libItem = matchLibraryItem(text)
        if (libItem) {
          setTrigger({
            kind: 'library-item',
            categorySlug: libItem.categorySlug,
            query: libItem.query,
          })
          return libItem.match
        }
        const libCat = matchLibraryCategory(text)
        if (libCat) {
          setTrigger({ kind: 'library-category', query: libCat.query })
          return libCat.match
        }
      }
      // 2. `/event <query>`
      if (supportsEvents) {
        const ev = matchEvent(text)
        if (ev) {
          setTrigger({ kind: 'event', query: ev.query })
          return ev.match
        }
      }
      // 3. fallback `@<query>`
      const userMatch = userTriggerFn(text, editor)
      if (userMatch) {
        setTrigger({ kind: 'user', query: userMatch.matchingString })
      } else {
        setTrigger(null)
      }
      return userMatch
    },
    [editor, supportsEvents, supportsLibrary, userTriggerFn],
  )

  // -----------------------------
  // Resultados según trigger
  // -----------------------------

  useEffect(() => {
    if (trigger === null) {
      setOptions([])
      return
    }
    let active = true
    void (async () => {
      const results = await fetchOptionsForTrigger(trigger, composer)
      if (!active) return
      setOptions(results.slice(0, MAX_RESULTS))
    })()
    return () => {
      active = false
    }
  }, [trigger, composer])

  // -----------------------------
  // Selección
  // -----------------------------

  const onSelectOption = useCallback(
    (selected: GenericMenuOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const node = buildMentionFromPayload(selected.payload, composer.placeId)
        if (nodeToReplace) {
          nodeToReplace.replace(node)
        } else {
          $insertNodes([node])
        }
      })
      closeMenu()
    },
    [editor, composer.placeId],
  )

  // -----------------------------
  // Render
  // -----------------------------

  return (
    <LexicalTypeaheadMenuPlugin<GenericMenuOption>
      onQueryChange={() => {
        /* trigger state lo manejamos en triggerFn */
      }}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (anchorElementRef.current === null || options.length === 0) return null
        return createPortal(
          <MentionMenu
            options={options}
            selectedIndex={selectedIndex}
            onMouseEnter={setHighlightedIndex}
            onClick={selectOptionAndCleanUp}
          />,
          anchorElementRef.current,
        )
      }}
    />
  )
}

// ---------------------------------------------------------------
// Menu component (split por LOC + reuso testing)
// ---------------------------------------------------------------

function MentionMenu({
  options,
  selectedIndex,
  onMouseEnter,
  onClick,
}: {
  options: ReadonlyArray<GenericMenuOption>
  selectedIndex: number | null
  onMouseEnter: (idx: number) => void
  onClick: (option: GenericMenuOption) => void
}): React.JSX.Element {
  return (
    <div className="rich-text-mention-menu rounded-md border border-neutral-200 bg-white py-1 shadow-md">
      <ul role="listbox" className="m-0 list-none p-0">
        {options.map((option, idx) => (
          <li
            key={option.payload.id}
            ref={option.setRefElement}
            role="option"
            tabIndex={-1}
            aria-selected={selectedIndex === idx}
            onMouseEnter={() => onMouseEnter(idx)}
            onClick={() => {
              onMouseEnter(idx)
              onClick(option)
            }}
            className={[
              'cursor-pointer px-3 py-2 text-sm',
              selectedIndex === idx ? 'bg-neutral-100' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <MentionRow payload={option.payload} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function MentionRow({ payload }: { payload: MenuPayload }): React.JSX.Element {
  if (payload.type === 'user') {
    return (
      <>
        <span className="font-medium">{payload.user.displayName}</span>
        {payload.user.handle ? (
          <span className="ml-2 text-neutral-500">@{payload.user.handle}</span>
        ) : null}
      </>
    )
  }
  if (payload.type === 'event') {
    return (
      <span>
        <span className="mr-1" aria-hidden>
          🎉
        </span>
        <span>{payload.event.title}</span>
      </span>
    )
  }
  if (payload.type === 'library-category') {
    return <span>{payload.category.name}</span>
  }
  return <span>{payload.item.title}</span>
}

// ---------------------------------------------------------------
// Helpers — match patterns por trigger
// ---------------------------------------------------------------

type LibraryItemMatch = {
  match: { leadOffset: number; matchingString: string; replaceableString: string }
  categorySlug: string
  query: string
}

type Match = {
  match: { leadOffset: number; matchingString: string; replaceableString: string }
  query: string
}

const EVENT_RE = /(^|[\s\n])(\/event[ ]([\w-]*))$/
const LIBRARY_BARE_RE = /(^|[\s\n])(\/library)$/
const LIBRARY_CAT_RE = /(^|[\s\n])(\/library\/([\w-]+)([ ]([\w-]*))?)$/

function matchEvent(text: string): Match | null {
  const m = text.match(EVENT_RE)
  if (!m || m[3] === undefined) return null
  const replaceable = m[2] ?? ''
  const leadOffset = (m.index ?? 0) + (m[1]?.length ?? 0)
  return {
    match: { leadOffset, matchingString: m[3], replaceableString: replaceable },
    query: m[3],
  }
}

function matchLibraryCategory(text: string): Match | null {
  const m = text.match(LIBRARY_BARE_RE)
  if (!m) return null
  const replaceable = m[2] ?? ''
  const leadOffset = (m.index ?? 0) + (m[1]?.length ?? 0)
  return {
    match: { leadOffset, matchingString: '', replaceableString: replaceable },
    query: '',
  }
}

function matchLibraryItem(text: string): LibraryItemMatch | null {
  const m = text.match(LIBRARY_CAT_RE)
  if (!m) return null
  const categorySlug = m[3] ?? ''
  const query = m[5] ?? ''
  if (!categorySlug) return null
  const replaceable = m[2] ?? ''
  const leadOffset = (m.index ?? 0) + (m[1]?.length ?? 0)
  return {
    match: { leadOffset, matchingString: query, replaceableString: replaceable },
    categorySlug,
    query,
  }
}

// ---------------------------------------------------------------
// Fetch helpers + payload builders
// ---------------------------------------------------------------

async function fetchOptionsForTrigger(
  trigger: Trigger,
  resolvers: ComposerMentionResolvers,
): Promise<GenericMenuOption[]> {
  if (trigger.kind === 'user') {
    const users = await resolvers.searchUsers(trigger.query)
    return users.map(
      (u) => new GenericMenuOption({ id: u.userId, type: 'user', user: u } satisfies MenuPayload),
    )
  }
  if (trigger.kind === 'event' && resolvers.searchEvents) {
    const events = await resolvers.searchEvents(trigger.query)
    return events.map(
      (e) =>
        new GenericMenuOption({ id: e.eventId, type: 'event', event: e } satisfies MenuPayload),
    )
  }
  if (trigger.kind === 'library-category' && resolvers.listCategories) {
    const cats = await resolvers.listCategories()
    return cats.map(
      (c) =>
        new GenericMenuOption({
          id: c.categoryId,
          type: 'library-category',
          category: c,
        } satisfies MenuPayload),
    )
  }
  if (trigger.kind === 'library-item' && resolvers.searchLibraryItems) {
    const items = await resolvers.searchLibraryItems(trigger.categorySlug, trigger.query)
    return items.map(
      (i) =>
        new GenericMenuOption({
          id: i.itemId,
          type: 'library-item',
          item: i,
          categorySlug: trigger.categorySlug,
        } satisfies MenuPayload),
    )
  }
  return []
}

function buildMentionFromPayload(payload: MenuPayload, placeId: string) {
  if (payload.type === 'user') {
    return $createMentionNode({
      kind: 'user',
      targetId: payload.user.userId,
      targetSlug: payload.user.handle ?? payload.user.userId,
      label: payload.user.displayName,
      placeId,
    })
  }
  if (payload.type === 'event') {
    return $createMentionNode({
      kind: 'event',
      targetId: payload.event.eventId,
      targetSlug: payload.event.slug,
      label: payload.event.title,
      placeId,
    })
  }
  if (payload.type === 'library-category') {
    // Category mentions: re-link al landing de la categoría usando
    // `kind: library-item` con `targetId === categoryId` y label = nombre.
    // El renderer no distingue (categoría se muestra como recurso); F.5+
    // puede agregar un kind dedicado si UX lo pide.
    return $createMentionNode({
      kind: 'library-item',
      targetId: payload.category.categoryId,
      targetSlug: payload.category.slug,
      label: payload.category.name,
      placeId,
    })
  }
  return $createMentionNode({
    kind: 'library-item',
    targetId: payload.item.itemId,
    targetSlug: `${payload.categorySlug}/${payload.item.slug}`,
    label: payload.item.title,
    placeId,
  })
}

// Memoize stable resolvers for unit tests / consumers wiring (no-op runtime).
export function useStableResolvers<T>(value: T): T {
  return useMemo(() => value, [value])
}
