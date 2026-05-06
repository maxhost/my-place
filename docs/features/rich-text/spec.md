# Rich-text spec

Modelo unificado del editor de texto enriquecido en Place. El slice `src/features/rich-text/` provee un composer Lexical configurable per-surface y per-place, más un renderer SSR para mostrar contenido persistido.

Decisión arquitectónica: `docs/decisions/2026-05-06-tiptap-to-lexical.md`.

## Surfaces consumidoras

El editor se usa en 4 surfaces. Cada uno declara su set de nodos vía `initialConfig.nodes` de Lexical. Una superficie no carga (ni en bundle ni en runtime) los nodos que no declara — esa es la palanca arquitectónica que motiva la migración a Lexical.

| Surface             | Nodos del schema                                                       | Embeds (toggleables por place)          |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| Comment / respuesta | text, link, mention                                                    | —                                       |
| Post (thread)       | text, mention, heading h1/h2/h3, bold, ordered list, bullet list, link | YouTube, Spotify, Apple Podcasts, Ivoox |
| Evento              | text, link, mention                                                    | —                                       |
| Library item        | text, mention, heading h1/h2/h3, bold, ordered list, bullet list, link | YouTube, Spotify, Apple Podcasts, Ivoox |

Italic NO es toggle del usuario. Se aplica vía CSS al texto contenido en un `LinkNode` para comunicar "interactivo" (ver § "Estilo de links").

## Modelo del documento

El editor persiste un `LexicalDocument` (JSON) en la columna correspondiente:

- `Post.body Json?` (nullable; un post sin body es válido si tiene library item asociado)
- `Comment.body Json` (NOT NULL)
- `Comment.quotedSnapshot Json?` (incluye `body` del comment citado, congelado al momento de citar)
- `Event.description Json?`

Shape canónico: el AST de Lexical es un árbol con un `RootNode` que contiene `ElementNode`s (paragraphs, headings, lists, etc.) y hojas `TextNode` / `LineBreakNode` / `MentionNode` / `LinkNode` / `<Embed>Node`. Schema serializado vía `editor.toJSON()`. La validación Zod del slice `rich-text` valida el shape completo + el subset por-surface.

### Caps del documento

- Tamaño máximo: **20 KB** post-`JSON.stringify`. Mismo cap que TipTap. Justificación previa en `docs/decisions/2026-04-20-discussions-size-exception.md`.
- Profundidad máxima de listas anidadas: **5 niveles**.
- Validación se ejecuta en server actions vía `assertRichTextSize(doc)` (re-implementado sobre Lexical AST).

## Estilo de links

Los links se renderizan en el viewer con la siguiente regla CSS:

```css
.rich-text a {
  font-style: italic;
  text-decoration: underline;
  text-underline-offset: 3px;
}
```

No hay un `italic` toggleable en el toolbar de ningún surface. Si el usuario quiere énfasis sin ser link, debe usar bold (sólo disponible en post/library). Esta decisión nace de mantener el toolbar minimalista (cozytech): menos opciones → menos paralelo de uso, edición más rápida.

## Mention polimórfico

Un solo `MentionNode` con shape:

```ts
type MentionNode = {
  type: 'mention'
  kind: 'user' | 'event' | 'library-item'
  targetId: string
  targetSlug: string // snapshot al momento de mencionar
  label: string // snapshot del texto display al momento de mencionar
  placeId: string // contexto (mentions no cruzan places)
}
```

### Triggers

| Trigger         | Comportamiento                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@`             | Autocompletar usuarios del place. Lista de hasta 8 candidatos por nombre/handle.                                    |
| `/event`        | Autocompletar eventos del place. Filtro por título.                                                                 |
| `/library`      | Two-step: primero `/library/` muestra categorías. Tras escoger categoría, `/library/<cat>/` muestra items dentro.   |
| `/library<cat>` | Si el usuario escribe directamente `/library/audiovisual`, el autocomplete ya filtra items dentro de `audiovisual`. |

### Snapshot defensivo en el renderer

Al render, el renderer:

1. Toma el `targetId` y `kind` del mention.
2. Llama al mapper público del slice correspondiente: `userCanonicalLabel(userId)`, `eventCanonicalLabel(eventId, placeId)`, `libraryItemCanonicalLabel(itemId, placeId)`.
3. Si el lookup retorna `null` (archivado, eliminado, no visible para el viewer), renderiza el placeholder textual:
   - `kind === 'event'` → `[EVENTO NO DISPONIBLE]`
   - `kind === 'library-item'` → `[RECURSO NO DISPONIBLE]`
   - `kind === 'user'` → mantiene el `label` snapshot pero pierde el link (asimetría con `quotedSnapshot.authorLabel`, ver `CLAUDE.md` § Gotchas — la convención de mostrar el snapshot del autor es histórica).
4. Si el lookup retorna data, renderiza un `<a>` con href canónico:
   - `user` → `/m/{userId}` (gated zone)
   - `event` → `/events/{slug}` (gated zone)
   - `library-item` → `/library/{categorySlug}/{itemSlug}` (gated zone)

Boundary: el slice `rich-text` NO importa de `members/` ni `events/` ni `library/`. Los mappers vienen vía `public.ts` de cada slice y se inyectan al renderer vía un objeto `mentionResolvers` (ver § "Renderer SSR").

### Threads (mención de posts)

Los threads no son trigger nuevo. Si el producto los habilita en el futuro, se agrega `kind: 'post'` al MentionNode. Hoy no está en MVP — la lectura de un post se llega vía link explícito, no mention.

## Embeds (DecoratorNodes)

Cuatro plugins de embed en MVP, implementados como `DecoratorNode` (primitive de Lexical para renderizar React components arbitrarios — ideal para iframes externos):

| Plugin         | Trigger en composer                                                                                  | Soporta                                             | URL pattern del iframe                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| YouTube        | Botón en toolbar / paste de URL `youtube.com/watch` o `youtu.be/<id>`                                | Videos individuales (no playlists ni shorts en MVP) | `https://www.youtube-nocookie.com/embed/{id}`                                       |
| Spotify        | Botón / paste de `open.spotify.com/<kind>/<id>`                                                      | Tracks, episodios, shows, playlists, álbumes        | `https://open.spotify.com/embed/{kind}/{id}`                                        |
| Apple Podcasts | Botón / paste de `podcasts.apple.com/<region>/podcast/<slug>/id<showId>` (opcional `?i=<episodeId>`) | Show o episodio individual                          | `https://embed.podcasts.apple.com/{region}/podcast/{slug}/id{showId}?i={episodeId}` |
| Ivoox          | Botón / paste de `www.ivoox.com/<slug>_rf_<id>_1.html`                                               | Episodio individual                                 | `https://www.ivoox.com/player_ej_{id}_4_1.html`                                     |

### Shape común

```ts
type EmbedNode = {
  type: 'youtube' | 'spotify' | 'apple-podcast' | 'ivoox'
  externalId: string // id parseado de la URL
  // Spotify-only:
  kind?: 'track' | 'episode' | 'show' | 'playlist' | 'album'
  // Apple-only:
  region?: string
  showSlug?: string
  showId?: string
  episodeId?: string
}
```

### Validación de URL

Cada plugin tiene un parser que valida la URL contra la regex del host y extrae el `externalId`. URLs que no matchean → toast de error en el composer ("Esta URL no es válida para Spotify"). El parser vive en `rich-text/plugins/<plugin>/parse-url.ts` y se testea con TDD (cases positivos + negativos).

### CSP

`next.config.ts` extiende `frame-src` con los 4 hosts canonicales:

```
frame-src https://www.youtube.com https://www.youtube-nocookie.com
         https://player.vimeo.com https://docs.google.com
         https://open.spotify.com https://embed.podcasts.apple.com
         https://www.ivoox.com
```

(Vimeo y Google Docs se mantienen por compat con library item links pre-existentes.)

### Sandbox del iframe

Todos los embeds usan `<iframe sandbox="allow-scripts allow-same-origin allow-presentation" loading="lazy" referrerpolicy="no-referrer">`. El `loading="lazy"` evita que un thread con 5 embeds dispare 5 requests cross-origin antes de scroll.

## Feature flags por place

Nueva columna en la tabla `Place`:

```sql
ALTER TABLE "Place" ADD COLUMN "editorPluginsConfig" JSONB
  NOT NULL
  DEFAULT '{"youtube":true,"spotify":true,"applePodcasts":true,"ivoox":true}';
```

Schema Zod: `EditorPluginsConfigSchema` exportado desde `@/features/editor-config/public`.

### Semántica

- El config se lee al montar cualquier composer del place. El array `nodes` y la lista de plugins se computan condicionalmente.
- **Controla creación, no rendering**: posts/comments/events/library-items pre-existentes con embed Ivoox siguen renderizando aunque el admin haya desactivado Ivoox después.
- Default al crear un place: todos los toggles `true`.

### UI de admin

Page nueva: `src/app/[placeSlug]/settings/editor/page.tsx`. Alineada con `docs/ux-patterns.md`:

- **Page padding**: `<div className="space-y-6 px-3 py-6 md:px-4 md:py-8">`.
- **Header**: `<PageHeader title="Editor" description="Plugins habilitados al crear contenido nuevo" />`.
- **Section única**: `<section aria-labelledby="embeds">` con `<h2>Embeds permitidos</h2>` (border-b font-serif text-xl).
- **Lista de toggles**: cada uno `<li className="flex min-h-[56px] items-center justify-between py-2">` con label a la izquierda + `<input type="checkbox">` o `<button role="switch">` a la derecha.
- **Save**: botón `bg-neutral-900 text-white` al pie, disabled si `!isDirty`. `formState.isDirty` controla.
- **Toast**: `toast.success("Configuración guardada")` al cerrar.
- **No BottomSheet** (no son forms con múltiples inputs, son toggles directos con autosave + soft barrier).
- **Soft barrier**: si hay otros cambios pendientes, el toggle aplica local + `toast.info(DEFER_HINT)`.

### Cache + invalidación

`getEditorConfigForPlace(placeId)` cacheado con `unstable_cache` + tag `editor-config:{placeId}` + `revalidate: 60s`. Server action `updateEditorConfig` invalida el tag al persistir.

Patrón heredado de `findInviterPermissions` (Sesión 2.3 perf).

## Renderer SSR

El renderer NO corre Lexical runtime en el servidor (overhead innecesario para sólo serializar JSX). En su lugar, parsea el AST directo a JSX con un visitor pattern:

```ts
function RichTextRenderer({
  document,
  resolvers,
}: {
  document: LexicalDocument | null
  resolvers: MentionResolvers
}) {
  if (!document) return null
  return <div className="rich-text">{renderRoot(document.root, resolvers)}</div>
}
```

`MentionResolvers` es un objeto inyectado con tres funciones:

```ts
type MentionResolvers = {
  user: (id: string) => Promise<{ label: string; href: string } | null>
  event: (id: string, placeId: string) => Promise<{ label: string; href: string } | null>
  libraryItem: (id: string, placeId: string) => Promise<{ label: string; href: string } | null>
}
```

Cada page del consumer construye `resolvers` importando los mappers de `members/public`, `events/public`, `library/public`. El slice `rich-text` queda agnóstico al dominio.

Performance: el renderer hace lookup de mentions en paralelo con `Promise.all` por documento. Para un comment con 3 mentions, son 3 queries paralelas (cacheadas por `React.cache` en cada `public` mapper).

## Tests requeridos

- `domain/__tests__/schema.test.ts`: shape canónico válido + 10+ shapes inválidos rechazados.
- `domain/__tests__/size.test.ts`: caps de bytes + depth.
- `domain/__tests__/snapshot.test.ts`: `buildQuoteSnapshot` reescrito sobre AST nuevo.
- `plugins/<each>/parse-url.test.ts`: URLs válidas + inválidas por plugin (4 plugins × ~6 cases = ~24 tests).
- `ui/__tests__/renderer.test.tsx`: SSR del shape canónico + fallback de mention sin target.
- `ui/__tests__/composer-comment.test.tsx`: smoke + submit de doc válido.
- E2E (manual al cierre): 5 escenarios listados en el ADR.

## Tamaño del slice

Estimación inicial (target ≤1500 LOC para no requerir excepción):

- `domain/`: ~250 LOC (types + schemas + size + snapshot)
- `ui/base-composer.tsx`: ~100 LOC
- `ui/renderer.tsx`: ~150 LOC
- `plugins/<each>/`: ~80 LOC × 4 plugins (YT/Spotify/Apple/Ivoox) = 320 LOC
- `plugins/mention/`: ~250 LOC (autocomplete + node + 3 trigger handlers)
- `public.ts` + `public.server.ts`: ~50 LOC
- Tests: ~500 LOC

Total: ~1620 LOC. Si supera el cap, evaluar split del slice (`rich-text/embeds/` como sub-slice como hace `discussions/flags`). Por ahora cabe en un solo slice.

### Conteo real post-F.4 (2026-05-06)

- Slice principal `src/features/rich-text/` (excluye `embeds/`, sin tests): **~2581 LOC**
- Sub-slice `src/features/rich-text/embeds/` (sin tests): **~906 LOC**
- Combined sin tests: **~3487 LOC**

Sub-slice ya creado (`embeds/`) absorbe los 4 plugins de embed (~906 LOC). Aún así el slice principal supera el cap 1500. F.6 evaluará:

- Split de `ui/mentions/` (~600 LOC con plugin polimórfico extendido) en sub-slice propio.
- ADR de excepción análogo a `2026-04-20-discussions-size-exception.md` documentando que el slice rich-text es densidad inherente del dominio (4 surfaces + AST polimórfico + 4 embeds + 3 triggers de mention + renderer SSR sin Lexical runtime).

## Boundary

`rich-text` exporta vía `public.ts`:

- Tipos: `LexicalDocument`, `MentionNode`, `EmbedNode` (públicos), helpers `assertRichTextSize`, `buildQuoteSnapshot`, `richTextDocumentSchema`.
- Componentes client: `<CommentComposer>`, `<PostComposer>`, `<EventComposer>`, `<LibraryItemComposer>`.
- Renderer: `<RichTextRenderer>`.

Vía `public.server.ts`:

- Server-only nada por ahora (los composers son client). Si en el futuro hay queries server, va acá.

Imports cruzados: `rich-text` consume mappers de `members/`, `events/`, `library/` SOLO al instanciar `MentionResolvers` en cada page consumer — el slice no los importa directamente.
