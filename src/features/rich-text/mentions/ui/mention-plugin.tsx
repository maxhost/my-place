'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $createTextNode, $insertNodes, type TextNode } from 'lexical'
import { $createMentionNode } from './mention-node'
import { useMentionPrefetchSource } from './mention-prefetch-context'

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
  /**
   * Indica fetch live in-flight con cache miss. Cuando es `true` y
   * `options` aún está vacío, renderizamos un placeholder "Cargando…"
   * en el menú para que el viewer vea respuesta inmediata al teclado
   * (defensa UX cold start). Cache hit → loading queda `false` y se
   * muestran items directo, sin placeholder visible.
   *
   * `error` se setea si el fetch live falla (red caída, action throw).
   * El menú entonces muestra "No pudimos cargar" en vez del spinner
   * forever.
   */
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // Cache prefetcheado externo (Provider en `discussions/composers/` que vive
  // en el shell `(gated)/layout.tsx`). Si el viewer entró al shell hace ≥100ms,
  // estos arrays ya están poblados → typeahead instant. Si el Provider no está
  // montado (tests isolated, futuras pages sin shell), el hook retorna null →
  // caemos al prefetch propio + fetch live (fallback intacto).
  // Ver `docs/plans/2026-05-09-mention-prefetch-background.md`.
  const externalCache = useMentionPrefetchSource()

  // Caches client-side: prefetch al mount los listados base (top-N
  // sin filtro). Cuando el trigger se dispara con query vacía
  // ("/event", "/library", "@") devolvemos el cache instantáneamente,
  // sin Server Action round-trip. Con `connection_limit=1` en prod el
  // RTT serializado costaba ~500-1000ms — el cache lo hace inmediato.
  // Seed inicial desde el cache externo si está disponible.
  const [cachedUsers, setCachedUsers] = useState<MentionUserResult[] | null>(
    externalCache?.users ?? null,
  )
  const [cachedEvents, setCachedEvents] = useState<MentionEventResult[] | null>(
    externalCache?.events ?? null,
  )
  const [cachedCategories, setCachedCategories] = useState<MentionLibraryCategoryResult[] | null>(
    externalCache?.categories ?? null,
  )

  // Sync cuando el Provider emite nuevos valores (refresh por TTL/visibility).
  // Sólo escribe si el externalCache trae data — null no pisa el cache propio.
  useEffect(() => {
    if (externalCache?.users) setCachedUsers(externalCache.users)
  }, [externalCache?.users])
  useEffect(() => {
    if (externalCache?.events) setCachedEvents(externalCache.events)
  }, [externalCache?.events])
  useEffect(() => {
    if (externalCache?.categories) setCachedCategories(externalCache.categories)
  }, [externalCache?.categories])

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

  // Stable ref del `composer` — los wrappers (CommentComposer en particular)
  // construyen el objeto `resolvers={{...}}` inline en cada render, así que
  // su identidad cambia con cada keystroke de Lexical. Sin ref, los
  // `useEffect` que dependen de `composer` re-disparan en cada render →
  // re-fetch storm (medido: 15 requests al typear `/lib`). El ref captura
  // siempre el último composer sin ser dep — `composer.placeId` sí es dep
  // de los useEffect porque cambiar de place SÍ debe invalidar caches.
  const composerRef = useRef(composer)
  useEffect(() => {
    composerRef.current = composer
  })

  // Prefetch on mount — fuego una sola vez por placeId. Errores se
  // silencian: si la red falla, el cache queda null y el flujo cae al
  // fetch live como fallback.
  // Dep `composer.placeId` (NO `composer`): el composer object cambia
  // identidad por render del wrapper; sin esta restricción el prefetch
  // se re-disparaba en cada keystroke (re-fetch storm).
  useEffect(() => {
    let active = true
    void (async () => {
      const c = composerRef.current
      const tasks: Array<Promise<unknown>> = [
        c
          .searchUsers('')
          .then((r) => active && setCachedUsers(r))
          .catch(() => {}),
      ]
      if (supportsEvents && c.searchEvents) {
        tasks.push(
          c
            .searchEvents('')
            .then((r) => active && setCachedEvents(r))
            .catch(() => {}),
        )
      }
      if (supportsLibrary && c.listCategories) {
        tasks.push(
          c
            .listCategories()
            .then((r) => active && setCachedCategories(r))
            .catch(() => {}),
        )
      }
      await Promise.all(tasks)
    })()
    return () => {
      active = false
    }
  }, [composer.placeId, supportsEvents, supportsLibrary])

  // -----------------------------
  // Match function combinada
  // -----------------------------

  const triggerFn = useCallback(
    (text: string) => {
      // 1. Slash commands (/event, /library, prefix matching).
      const slash = matchSlashCommand(text)
      if (slash) {
        const t = slash.trigger
        if (t.kind === 'library-item' || t.kind === 'library-category') {
          if (!supportsLibrary) return null
        }
        if (t.kind === 'event' && !supportsEvents) return null
        setTrigger(t)
        return slash.match
      }
      // 2. fallback `@<query>` (user mentions).
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
      setLoading(false)
      setError(false)
      return
    }
    // Cache-first para query vacía: armamos opciones desde el state
    // cacheado al mount. Saltea el round-trip al server. Si el cache
    // todavía no llegó (mount race), cae al fetch live abajo.
    const sync = trySyncFromCache(trigger, {
      users: cachedUsers,
      events: cachedEvents,
      categories: cachedCategories,
    })
    if (sync !== null) {
      setOptions(sync.slice(0, MAX_RESULTS))
      setLoading(false)
      setError(false)
      return
    }
    let active = true
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        // Usa composerRef en lugar de `composer` directo: el composer object
        // cambia identidad por render del wrapper. Si lo metiéramos en deps,
        // este useEffect se re-dispararía en cada keystroke → re-fetch storm
        // (medido: 15 requests al typear `/lib`).
        const results = await fetchOptionsForTrigger(trigger, composerRef.current)
        if (!active) return
        setOptions(results.slice(0, MAX_RESULTS))
      } catch {
        if (!active) return
        // Si el action lanza (red caída, server error), mostramos un
        // mensaje en vez de dejar el spinner forever. El user puede
        // borrar el trigger y reintentar typeando de nuevo.
        setError(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [trigger, cachedUsers, cachedEvents, cachedCategories])

  // -----------------------------
  // Selección
  // -----------------------------

  const onSelectOption = useCallback(
    (selected: GenericMenuOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      // Two-step library: seleccionar categoría no inserta mention todavía,
      // sustituye el texto typeado por `/library/<slug>/` y deja que el
      // typeahead re-trigger automáticamente con LIBRARY_CAT_RE → muestra
      // items de la categoría. El user selecciona ahí el item para insertar
      // la mention final.
      if (selected.payload.type === 'library-category') {
        const slug = selected.payload.category.slug
        editor.update(() => {
          const replacement = $createTextNode(`/library/${slug}/`)
          if (nodeToReplace) {
            nodeToReplace.replace(replacement)
          } else {
            $insertNodes([replacement])
          }
          replacement.select()
        })
        return
      }
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
        if (anchorElementRef.current === null) return null
        // Loading / error placeholder: trigger activo + sin items todavía.
        // Mostramos respuesta inmediata al teclado aunque la red tarde
        // (o mensaje claro si falla, en vez de spinner forever).
        if (options.length === 0) {
          if (trigger === null) return null
          if (error) {
            return createPortal(
              <MentionFeedbackMenu kind="error" trigger={trigger} />,
              anchorElementRef.current,
            )
          }
          if (loading) {
            return createPortal(
              <MentionFeedbackMenu kind="loading" trigger={trigger} />,
              anchorElementRef.current,
            )
          }
          return null
        }
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
    <div className="rich-text-mention-menu min-w-[280px] max-w-md overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
      <ul role="listbox" className="m-0 max-h-72 list-none overflow-y-auto p-0">
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
              'flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-2 text-sm leading-tight',
              selectedIndex === idx ? 'bg-neutral-100' : 'bg-white hover:bg-neutral-50',
            ].join(' ')}
          >
            <MentionRow payload={option.payload} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Placeholder visual mientras el `fetchOptionsForTrigger` resuelve, o
 * mensaje claro si el fetch falló (kind="error"). Aparece sólo en cache
 * miss; cache hit muestra los items directo. Texto contextual al trigger
 * para que el viewer sepa qué está pasando. Spinner / icon CSS puro
 * (sin dep externa).
 */
/** Exportado sólo para tests del slice — no consumir desde fuera. */
export function MentionFeedbackMenu({
  kind,
  trigger,
}: {
  kind: 'loading' | 'error'
  trigger: Trigger
}): React.JSX.Element {
  const target =
    trigger.kind === 'user'
      ? 'miembros'
      : trigger.kind === 'event'
        ? 'eventos'
        : trigger.kind === 'library-category'
          ? 'categorías'
          : 'recursos'
  const label =
    kind === 'error'
      ? `No pudimos cargar ${target}. Probá de nuevo.`
      : trigger.kind === 'user' || trigger.kind === 'event'
        ? `Buscando ${target}…`
        : `Cargando ${target}…`
  return (
    <div
      data-mention-feedback={kind}
      className="rich-text-mention-menu min-w-[260px] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
    >
      <div
        role={kind === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500"
      >
        {kind === 'loading' ? (
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600"
          />
        ) : (
          <span aria-hidden className="text-amber-600">
            ⚠
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
    </div>
  )
}

function MentionRow({ payload }: { payload: MenuPayload }): React.JSX.Element {
  if (payload.type === 'user') {
    return (
      <>
        <span aria-hidden className="text-neutral-400">
          @
        </span>
        <span className="truncate font-medium text-neutral-900">{payload.user.displayName}</span>
        {payload.user.handle ? (
          <span className="ml-auto truncate text-xs text-neutral-500">@{payload.user.handle}</span>
        ) : null}
      </>
    )
  }
  if (payload.type === 'event') {
    return (
      <>
        <span aria-hidden>🎉</span>
        <span className="truncate text-neutral-900">{payload.event.title}</span>
      </>
    )
  }
  if (payload.type === 'library-category') {
    return (
      <>
        <span aria-hidden>📚</span>
        <span className="truncate text-neutral-900">{payload.category.name}</span>
      </>
    )
  }
  return (
    <>
      <span aria-hidden>📄</span>
      <span className="truncate text-neutral-900">{payload.item.title}</span>
    </>
  )
}

// ---------------------------------------------------------------
// Helpers — match patterns por trigger
// ---------------------------------------------------------------

type SlashMatch = {
  match: { leadOffset: number; matchingString: string; replaceableString: string }
} & (
  | { trigger: { kind: 'event'; query: string } }
  | { trigger: { kind: 'library-category'; query: string } }
  | { trigger: { kind: 'library-item'; categorySlug: string; query: string } }
)

/**
 * Regex unificada para slash commands. Capturas:
 *   m[3] = comando (ej: "event", "library", "lib", "eve")
 *   m[4] = sub-segmento opcional después de "/" (ej: "/library/recursos" → "recursos")
 *   m[5] = query opcional después de espacio (ej: "/event hola" → "hola")
 *
 * Triggers en prefix: typear `/eve` muestra eventos, `/lib` muestra
 * categorías. Apenas el prefix es único hacia algún comando, el menú
 * aparece (no hace falta escribir el comando completo).
 *
 * `\/?` después del sub-segment: el plugin reemplaza la categoría
 * seleccionada por `/library/<slug>/` (con slash trailing como UX hint
 * de "ahora typeá para filtrar"). Sin el `\/?` la regex se rompía con
 * el slash trailing → typeahead se cerraba al instante post-selección
 * y no mostraba los items de la categoría. El `\/?` lo absorbe.
 */
const SLASH_RE = /(^|[\s\n])(\/([a-z]+)(?:\/([\w-]+))?\/?(?:[ ]([\w-]*))?)$/

function matchSlashCommand(text: string): SlashMatch | null {
  const m = SLASH_RE.exec(text)
  if (!m) return null
  const cmd = m[3] ?? ''
  const sub = m[4] ?? ''
  const after = m[5] ?? ''
  const replaceable = m[2] ?? ''
  const leadOffset = (m.index ?? 0) + (m[1]?.length ?? 0)
  const matchObj = { leadOffset, matchingString: '', replaceableString: replaceable }

  // /library/<cat>[ <q>]: paso 2 del flujo de biblioteca.
  if (cmd === 'library' && sub.length > 0) {
    return {
      trigger: { kind: 'library-item', categorySlug: sub, query: after },
      match: { ...matchObj, matchingString: after },
    }
  }
  // /event exacto + query opcional.
  if (cmd === 'event') {
    return {
      trigger: { kind: 'event', query: after },
      match: { ...matchObj, matchingString: after },
    }
  }
  // /library exacto sin sub.
  if (cmd === 'library' && sub === '') {
    return { trigger: { kind: 'library-category', query: '' }, match: matchObj }
  }
  // Prefijo de /event (ej: /e, /ev, /eve). Sólo si no hay sub ni query —
  // un usuario escribiendo no llegó todavía al comando completo.
  if (cmd.length > 0 && sub === '' && after === '' && 'event'.startsWith(cmd)) {
    return { trigger: { kind: 'event', query: '' }, match: matchObj }
  }
  // Prefijo de /library.
  if (cmd.length > 0 && sub === '' && after === '' && 'library'.startsWith(cmd)) {
    return { trigger: { kind: 'library-category', query: '' }, match: matchObj }
  }
  return null
}

// ---------------------------------------------------------------
// Fetch helpers + payload builders
// ---------------------------------------------------------------

type Caches = {
  users: MentionUserResult[] | null
  events: MentionEventResult[] | null
  categories: MentionLibraryCategoryResult[] | null
}

/**
 * Devuelve opciones desde el cache local cuando es seguro (cache hit
 * inmediato, sin round-trip). Casos cubiertos:
 *  - `@`, `/event`, `/library` con query vacía → lista cacheada al mount.
 *  - `@<q>`, `/event <q>` → filter case-insensitive sobre el cache (top-N).
 *
 * `library-item` siempre fetch live: items dependen de la categoría
 * seleccionada, no se prefetchean para no inflar el payload de mount.
 *
 * Retorna `null` si el cache no está poblado o no aplica — el caller
 * cae al fetch live como fallback.
 */
function trySyncFromCache(trigger: Trigger, caches: Caches): GenericMenuOption[] | null {
  if (trigger.kind === 'user' && caches.users !== null) {
    const filtered = filterByQuery(caches.users, trigger.query, (u) => u.displayName)
    return filtered.map(
      (u) => new GenericMenuOption({ id: u.userId, type: 'user', user: u } satisfies MenuPayload),
    )
  }
  if (trigger.kind === 'event' && caches.events !== null) {
    const filtered = filterByQuery(caches.events, trigger.query, (e) => e.title)
    return filtered.map(
      (e) =>
        new GenericMenuOption({ id: e.eventId, type: 'event', event: e } satisfies MenuPayload),
    )
  }
  if (trigger.kind === 'library-category' && caches.categories !== null) {
    return caches.categories.map(
      (c) =>
        new GenericMenuOption({
          id: c.categoryId,
          type: 'library-category',
          category: c,
        } satisfies MenuPayload),
    )
  }
  return null
}

function filterByQuery<T>(items: ReadonlyArray<T>, query: string, label: (t: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...items]
  return items.filter((i) => label(i).toLowerCase().includes(q))
}

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
