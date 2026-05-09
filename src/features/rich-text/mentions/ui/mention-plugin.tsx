'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $createTextNode, $insertNodes, type TextNode } from 'lexical'
import { useMentionPrefetchSource } from './mention-prefetch-context'
import { GenericMenuOption, MAX_RESULTS } from './menu-option'
import { buildMentionFromPayload, fetchOptionsForTrigger, trySyncFromCache } from './mention-cache'
import { matchSlashCommand } from './trigger-detection'
import { MentionFeedbackMenu } from './mention-feedback-menu'
import { MentionMenu } from './mention-menu'
import type {
  ComposerMentionResolvers,
  MentionEventResult,
  MentionLibraryCategoryResult,
  MentionResolversForEditor,
  MentionUserResult,
  Trigger,
} from './mention-types'

/**
 * Umbral después del cual un fetch live "se siente lento". El spinner
 * cambia su label ("Sigue cargando…") para confirmar al viewer que el
 * cliente sigue trabajando — sin esto, fetches >5s parecen un cuelgue.
 */
const SLOW_THRESHOLD_MS = 5000

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
   * Estado de carga del fetch live:
   *  - `false`  → no hay fetch pendiente (cache hit o trigger vacío).
   *  - `true`   → fetch en curso, mostrar spinner normal.
   *  - `'slow'` → pasaron `SLOW_THRESHOLD_MS` y aún no resolvió. Mismo
   *    spinner pero label cambia a "Sigue cargando…" para que el viewer
   *    sepa que NO está colgado el cliente, sino la red.
   *
   * `error` se setea si el fetch live falla (red caída, action throw).
   * El menú entonces muestra "No pudimos cargar" en vez del spinner
   * forever.
   */
  const [loading, setLoading] = useState<false | true | 'slow'>(false)
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
    // Reset `options` para que `menuRenderFn` entre al branch del
    // placeholder (`options.length === 0 + loading`). Sin este reset,
    // los options del trigger anterior (ej: categorías cuando ahora el
    // trigger es `library-item`) tapaban el spinner — el viewer veía
    // la lista vieja por 1-3s hasta que llegaban los items nuevos.
    setOptions([])
    setLoading(true)
    setError(false)
    // Slow-state timer: si pasa SLOW_THRESHOLD_MS sin resolver, el
    // label del spinner cambia a "Sigue cargando…" — confirma al viewer
    // que el cliente NO está colgado. El timer se cancela en cleanup.
    const slowTimer = setTimeout(() => {
      if (active) setLoading('slow')
    }, SLOW_THRESHOLD_MS)
    void (async () => {
      try {
        // Usa composerRef en lugar de `composer` directo: el composer object
        // cambia identidad por render del wrapper. Si lo metiéramos en deps,
        // este useEffect se re-dispararía en cada keystroke → re-fetch storm
        // (medido: 15 requests al typear `/lib`).
        const results = await fetchOptionsForTrigger(trigger, composerRef.current)
        if (!active) return
        setOptions(results.slice(0, MAX_RESULTS))
      } catch (err) {
        if (!active) return
        // Si el action lanza (red caída, server error), mostramos un
        // mensaje en vez de dejar el spinner forever. El user puede
        // borrar el trigger y reintentar typeando de nuevo.
        // Telemetry: log estructurado para detectar tasa de errores en
        // prod sin esperar reportes manuales del user.
        console.warn('[mention] fetchOptionsForTrigger failed', {
          event: 'mentionFetchFailed',
          triggerKind: trigger.kind,
          err: err instanceof Error ? err.message : String(err),
        })
        setError(true)
      } finally {
        clearTimeout(slowTimer)
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
      clearTimeout(slowTimer)
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
          if (loading !== false) {
            return createPortal(
              <MentionFeedbackMenu kind="loading" trigger={trigger} slow={loading === 'slow'} />,
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

// MentionMenu, MentionFeedbackMenu y MentionRow extraídos en Step 3.
// Re-export al tope del archivo mantiene el path de import compat para
// tests del slice durante este step.

// Helpers extraídos al split (Step 1):
//   - matchSlashCommand + SlashMatch + SLASH_RE + SLASH_COMMANDS → trigger-detection.ts
//   - trySyncFromCache + filterByQuery + fetchOptionsForTrigger + buildMentionFromPayload + Caches → mention-cache.ts
// Re-exports al tope del archivo para no romper consumers durante el split.
