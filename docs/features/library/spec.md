# Biblioteca — Especificación

> **Alcance v1 (R.5.1, 2026-04-30)**: UI scaffold sin backend.
> Construye los componentes y la zona en el shell para que estén
> listos cuando se sume el backend (R.5.X follow-up). Hoy solo el
> empty state se ve en producción.

> **Referencias:** `handoff/library/`, `handoff/library-category/`
> (design canónico), `docs/architecture.md`, `docs/features/shell/spec.md`
> § 16 (zonas + swipe), `CLAUDE.md` (principios no negociables).

## 1. Modelo mental

La Biblioteca es la **memoria compartida** del place — recursos
relevantes (links, PDFs, imágenes, docs) organizados por categorías
que el admin define. NO es un drive ni un wiki — es una colección
curada y modesta de cosas útiles que el lugar quiere preservar.

Tres niveles previstos:

1. **Zona Biblioteca** (`/library`): grid de categorías + bento
   "Recientes" con últimos docs.
2. **Categoría** (`/library/[categorySlug]`): lista de docs en
   esa categoría, filtrable por tipo.
3. **Item detail** (`/library/[categorySlug]/[itemSlug]`): vista
   del recurso (preview / descarga / link). **NO incluido en R.5**
   (sin design del handoff).

NO es:

- Un sistema de uploads abierto donde cualquiera sube. Quién puede
  subir lo decide producto cuando se sume backend.
- Un buscador. La búsqueda viene con R.4 (search overlay global).
- Un feed con timeline. Recientes muestra solo top-N globales,
  sin paginación infinita.

## 2. Vocabulario

- **Categoría**: agrupador con emoji + título. Único per-place.
  Slug inmutable (mismo patrón que Place.slug, Post.slug).
- **Recurso / Doc**: cualquier item subido (PDF, link, imagen,
  Google Doc, Google Sheet). El handoff usa "doc" como término
  abreviado; "recurso" en copy user-facing.
- **Tipo / DocType**: discriminador de UI — `pdf | link | image |
doc | sheet`.
- **Recientes**: top-N docs globales del place ordenados por
  `uploadedAt DESC`.

**Idioma**: UI en español ("Biblioteca", "Recursos", "Recientes",
"Sin resultados"). Código en inglés (`LibraryCategory`, `DocType`,
`uploadedAt`, etc.).

## 3. Scope v1 (R.5.1) — UI-only

**Sí en v1**:

- Slice `src/features/library/` con tipos del dominio
  (`LibraryCategory`, `LibraryDoc`, `DocType`) + componentes UI
  scaffolded + tests con mock data.
- 4ª zona en el shell (`Biblioteca` con emoji 📚, label en español).
- Routes `/library` y `/library/[categorySlug]` con páginas
  minimales (data hardcoded vacía).
- Empty state production-ready en `/library`: "Tu comunidad
  todavía no agregó recursos."
- Sub-page `/library/[categorySlug]` retorna `notFound()` (sin
  backend, ningún slug es válido).
- TypeFilterPills con URL state (`?type=`), pattern idéntico a
  `<ThreadFilterPills>` de discussions.

**NO en v1** (deferred a R.5.X follow-ups, listados explícitos):

- **Backend**: schema Prisma `LibraryCategory`/`LibraryDoc`,
  migrations, queries, server actions, RLS. Cuando se sume, se
  agrega `src/features/library/server/queries.ts` con las queries
  reales y se actualizan las pages para llamarlas.
- **Uploads**: storage Supabase, file processing, type detection,
  permission gating (¿quién puede subir?).
- **Item detail**: `/library/[categorySlug]/[itemSlug]/page.tsx`.
  Sin design del handoff. Cuando producto lo defina, se agrega.
- **Open behavior por type**: el handoff define preview / abrir
  link / descargar según type. Vive con backend (URLs reales).
- **`<ZoneFab>` item "Subir documento"**: se suma cuando uploads
  existan.
- **Search en library**: depende de R.4 search overlay.
- **Realtime** (lectura en vivo, contadores en vivo).
- **Admin CRUD de categorías** (crear / editar / archivar).
- **Reordering manual**: orden de categorías default ASC por slug
  o creación; admin reordering vía drag &amp; drop diferido.

## 4. Routes y comportamiento

### `/library` (zona root)

Server Component. Estructura JSX completa con conditionals para
pluggear backend mañana sin cambios en componentes:

```tsx
const categories: LibraryCategory[] = [] // future: await listLibraryCategories(place.id)
const recents: LibraryDoc[] = [] // future: await listRecentDocs(place.id)

return (
  <section className="flex flex-col gap-4 pb-6">
    <LibrarySectionHeader />
    {categories.length === 0 ? <EmptyLibrary /> : <CategoryGrid categories={categories} />}
    {recents.length > 0 ? <RecentsList docs={recents} /> : null}
  </section>
)
```

Hoy: solo `<LibrarySectionHeader>` + `<EmptyLibrary>`. Cuando
backend exista, sin cambios estructurales — solo el data source.

### `/library/[categorySlug]` (sub-page)

Server Component. Hoy llama `notFound()` directo (no hay backend
para resolver slug). Cuando exista backend:

```tsx
const category = await findCategoryBySlug(place.id, categorySlug)
if (!category) notFound()

const docs = await listCategoryDocs(category.id)
const filter = parseTypeFilter(searchParams.get('type'))
const filteredDocs = applyTypeFilter(docs, filter)
const availableTypes = computeAvailableTypes(docs)

return (
  <div className="pb-6">
    <CategoryHeaderBar />
    <header className="mt-4 px-3">
      <h1 className="font-title text-[28px] font-bold text-text">{category.title}</h1>
      <p className="mt-1 text-sm text-muted">{docs.length} documentos</p>
    </header>
    <TypeFilterPills available={availableTypes} />
    {filteredDocs.length === 0 ? (
      <EmptyDocList hasFilter={filter !== 'all'} />
    ) : (
      <DocList docs={filteredDocs} />
    )}
  </div>
)
```

### `/library/[categorySlug]/[itemSlug]`

NO existe la route en R.5. Next devuelve 404 standard si el user
intenta acceder via URL manual.

## 5. Componentes UI

Listado completo en `src/features/library/ui/`. Server Components
salvo `<TypeFilterPills>` (usa `useSearchParams` + `useRouter`).

| Componente             | Tipo   | Props                    | Reuse                                      |
| ---------------------- | ------ | ------------------------ | ------------------------------------------ |
| `LibrarySectionHeader` | Server | none                     | `<PageIcon emoji="📚" />`                  |
| `CategoryGrid`         | Server | `categories`             | nuevo                                      |
| `CategoryCard`         | Server | `category`               | nuevo                                      |
| `RecentsList`          | Server | `docs`, `max?=5`         | nuevo                                      |
| `RecentDocRow`         | Server | `doc`, `hairline?=false` | reusa `<TimeAgo>`                          |
| `FileIcon`             | Server | `type`, `size?=36`       | lucide icons                               |
| `EmptyLibrary`         | Server | none                     | layout `<EmptyThreads>`                    |
| `CategoryHeaderBar`    | Server | `rightSlot?`             | `<BackButton>` cuadrado                    |
| `DocList`              | Server | `docs`                   | reusa `<RecentDocRow>`                     |
| `TypeFilterPills`      | Client | `available: DocType[]`   | URL state pattern de `<ThreadFilterPills>` |
| `EmptyDocList`         | Server | `hasFilter?=false`       | layout EmptyThreads                        |

**Reuse de primitives existentes**:

- `<PageIcon>` de `shared/ui/page-icon.tsx`.
- `<BackButton>` de `shared/ui/back-button.tsx`.
- `<TimeAgo>` de `shared/ui/time-ago.tsx`.
- Patrón `useSearchParams + router.replace` para filter pills.
- Patrón `mx-3 divide-y divide-border` (DocList) idéntico al
  ThreadRow listado.

**Cross-slice imports**: library NO importa de discussions/events/
members. Solo de `shared/`. `tests/boundaries.test.ts` enforce.

## 6. Empty states

3 escenarios:

1. **Zona vacía** (`/library` sin categorías):
   - Emoji 📭, título "Tu comunidad todavía no agregó recursos",
     subtitle "Cuando alguien suba un documento o un link, lo vas
     a ver acá organizado por categoría.". **Sin CTA**.

2. **Categoría vacía** (sub-page con 0 docs):
   - Emoji 🪶, título "Todavía no hay recursos en esta categoría",
     subtitle invitando a subir. **Sin CTA**.

3. **Filter sin matches** (sub-page con docs pero filter activo
   no matchea):
   - Emoji 🔎, título "Sin resultados", subtitle "Probá con otro
     filtro o quitá los filtros". **Sin CTA**.

CTAs ausentes alineadas con la decisión user 2026-04-30 — no
inducimos a accionar uploads que aún no existen. Cuando uploads
lleguen, evaluar agregar CTA "Subir el primero" en los casos 1 y 2.

## 7. Principios no negociables aplicados (CLAUDE.md)

- **"Nada parpadea, nada grita"**: empty states calmos, sin
  spinners agresivos. Filter pills con `motion-safe:transition-colors`.
- **"Sin métricas vanidosas"**: "n documentos" en card es
  contador útil (cuántos hay en esa categoría) — no ranking ni
  vanity. NO mostramos "X uploads esta semana" ni "más visto".
- **"Sin urgencia artificial"**: empty states sin "¡SUBÍ AHORA!",
  sin badges de "nuevo", sin countdowns.
- **"Sin gamificación"**: no hay leaderboards, "más subido del
  mes", achievements por uploads.
- **"Sin algoritmo"**: orden de categorías default por slug ASC
  (cuando admin pueda reordenar, será orden manual). Recents por
  `uploadedAt DESC` — no por popularidad ni clicks.
- **"Presencia silenciosa"**: library es contenido pasivo. Sin
  notificaciones de "nuevo recurso", sin badges live.
- **"Customización activa, no algorítmica"**: las categorías y
  emojis son decisión del admin (cuando exista CRUD).

## 8. Sub-fases de implementación

| Sub       | Deliverable                                                                                        | Estado          |
| --------- | -------------------------------------------------------------------------------------------------- | --------------- |
| **R.5.0** | Plan + decisiones del user.                                                                        | ✅ (2026-04-30) |
| **R.5.1** | Spec (este doc) + slice scaffolding (domain/types + 11 componentes UI + 5 tests + public.ts).      | en curso        |
| **R.5.2** | Routes `/library` + `/library/[categorySlug]` + 4ª zona en `ZONES` + tests del shell actualizados. | pendiente       |
| **R.5.3** | Cleanup + roadmap.md con R.5 ✅.                                                                   | pendiente       |

## 9. R.5.X follow-ups (post-R.5)

Para que el PM/dev futuro tenga contexto cuando llegue el momento:

- **Backend**: schema Prisma `LibraryCategory` (id, placeId, slug,
  emoji, title, position, createdAt) + `LibraryDoc` (id,
  categoryId, slug, type, title, url/storagePath, uploadedByUserId,
  uploadedAt + authorSnapshot para erasure 365d). Migrations + RLS
  policies + queries + server actions.
- **Uploads**: integración Supabase Storage. Permission gating
  (¿solo admin? ¿cualquier miembro? — decisión producto). Type
  detection con fallback. Tamaño máximo por archivo.
- **Item detail page**: `/library/[categorySlug]/[itemSlug]`.
  Diseño aún no entregado por handoff. Comportamiento por type
  (preview embed para PDF/image, abrir link en nueva tab para
  link, descarga directa o redirect a Workspace para doc/sheet).
- **`<ZoneFab>` item "Subir documento"**: se suma cuando uploads
  existan. URL: `/library/upload` (o flow modal — decisión UX).
- **Admin CRUD categorías**: crear / editar emoji+título /
  archivar. Reordering manual con drag &amp; drop.
- **Search integration**: cuando R.4 search overlay esté activo,
  indexar title + categoría de cada doc + body si type permite.
- **Bulk actions** (admin): mover docs entre categorías,
  archivar bulk.
- **Stats internas** (no user-facing — solo admin): docs más
  abiertos por mes para audit, NO para gamificación.
