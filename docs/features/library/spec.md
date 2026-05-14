# Biblioteca — Especificación

> **Actualización v2.1 (2026-05-12, S0–S3 done 2026-05-13)**: modelo de
> permisos rediseñado a `ReadAccessKind` + `WriteAccessKind` simétricos
> con 6 tablas pivote. Reemplaza el modelo `ContributionPolicy +
LibraryCategoryContributor`. Decisión documentada en ADR
> `2026-05-12-library-permissions-model`. Implementación completa en
> `docs/plans/2026-05-12-library-permissions-redesign.md` (S0 ADR + spec
> patch · S1a additive · S1b drop legacy · S2 wizard 4-step write+read ·
> S3 admin page EditPanel + lista plana).
>
> Estado actual:
>
> - Backend: schema, queries, actions, RLS coordinada.
> - UI admin: `/settings/library` con `<LibraryCategoriesPanel>` (flat
>   list + RowActions + dashed-border "+ Nueva categoría").
> - Wizard 4-step: Identidad → Escritura → Lectura → Tipo, con
>   write-implica-read en el step Lectura.
> - Sub-fase 14.4 (designated contributors UI) **eliminada** —
>   reemplazada por el step "Escritura" del wizard.

> **Alcance v1 (R.5, 2026-04-30)**: UI scaffold sin backend. Empty
> state production-ready en `/library`; componentes UI listos para
> recibir data real.

> **Alcance v2 (R.7, spec 2026-04-30 → implementación en sub-fases
> R.7.1 → R.7.11)**: backend completo + admin CRUD de categorías +
> items editoriales tipo "thread documento" (Post enriquecido con
> cover + categoría) con embeds intercalados via TipTap custom node.
> Sin uploads — los recursos descargables/visualizables son embeds
> de provider externo (YouTube, Vimeo, Drive, Dropbox, Google
> Doc/Sheet, link genérico). Storage propio diferido a R.7.X
> (decisión user 2026-04-30: evitar costos incrementales de storage
> hasta integrar BYO storage tipo Wasabi).

> **Referencias:** `handoff/library/`, `handoff/library-category/`
> (design canónico R.5), `docs/architecture.md`,
> `docs/features/shell/spec.md` § 16 (zonas + swipe),
> `docs/features/discussions/spec.md` (TipTap editor + Post +
> Comments — reuse masivo en R.7),
> `docs/features/events/spec.md` § F.F (precedente "evento ES
> thread", patrón cross-zona reusado),
> `CLAUDE.md` (principios no negociables).

## 1. Modelo mental

La Biblioteca es la **memoria compartida** del place — contenido
editorial (guías, tutoriales, cursos) y recursos referenciados por
embed externo (videos, docs descargables, links útiles) organizados
por categorías que el admin define. NO es un drive ni un wiki — es
una colección curada y modesta de cosas útiles que el lugar quiere
preservar.

**El item ES thread documento.** Cada item de biblioteca es un
`Post` enriquecido con metadata de biblioteca (categoría + cover
opcional). Reusa toda la infraestructura de discusiones: editor
TipTap, comments, reactions, reading presence, erasure 365d, slugs,
snapshots. Los embeds (videos, links a docs) viven intercalados en
el body como nodos custom de TipTap — el author escribe contexto +
embed + más contexto + embed, en lugar de tener attachments
separados sin contexto. Mismo patrón conceptual que F.F en eventos
("evento ES thread"), aplicado a la biblioteca.

Tres niveles previstos:

1. **Zona Biblioteca** (`/library`): grid de categorías + bento
   "Recientes" con últimos items.
2. **Categoría** (`/library/[categorySlug]`): lista de items en
   esa categoría.
3. **Item detail** (`/library/[categorySlug]/[itemSlug]`): el
   thread documento — header (categoría + cover desktop +
   título + author) + body TipTap con embeds intercalados +
   comments + reactions + readers.

NO es:

- Un sistema de uploads de archivos al storage propio. Los
  recursos viven en provider externo (YouTube, Drive, Dropbox,
  etc.) referenciados por URL. R.7.X+ puede sumar BYO storage
  (Wasabi) si producto lo prioriza.
- Un buscador. La búsqueda viene con R.4 (search overlay global)
  e indexará title + body de cada item (los nodos TipTap
  estándar son texto plano; embed nodes se indexan por su
  `title` interno).
- Un feed con timeline. Recientes muestra solo top-N globales,
  sin paginación infinita.
- Un sistema versionado. Editar un item modifica `updatedAt` y
  pisa el body — sin historial. Si producto pide versionado,
  R.7.X+.

## 2. Vocabulario

- **Categoría** (`LibraryCategory`): agrupador con emoji +
  título. Único per-place. Slug inmutable (mismo patrón que
  Place.slug, Post.slug). Tiene `contributionPolicy` que define
  quién puede crear items dentro.
- **Item** (`LibraryItem`): un thread documento dentro de una
  categoría. Es un `Post` (FK `Post.libraryItemId`) con metadata
  extra (categoría + cover). **Author** = creador del item; en
  el spec usamos siempre "author" — reservamos "owner" para el
  rol del place (evita ambigüedad).
- **Embed**: referencia a un recurso externo (video, doc, link)
  intercalado en el body TipTap como nodo custom. Vive en el
  AST de `Post.body`, no en tabla aparte. Atributos: `url`,
  `provider`, `title`. Provider:
  `youtube | vimeo | drive | dropbox | gdoc | gsheet | generic`.
- **Cover**: imagen opcional de portada del item. Guardada en
  DB (`coverUrl`), **no renderizada en mobile** — reservada
  para futura UI desktop. Decisión user 2026-04-30 (Place se
  consume mayoritariamente desde mobile; cover en mobile suma
  ruido sin valor).
- **Write access kind** (~~contribution policy~~): quién puede crear
  items en una categoría — `OWNER_ONLY | GROUPS | TIERS | USERS`.
  Default `OWNER_ONLY`. Cada opción no-owner tiene su pivot table
  (`LibraryCategoryGroupWriteScope`, `LibraryCategoryTierWriteScope`,
  `LibraryCategoryUserWriteScope`). Modelo unificado con read access —
  ver ADR `2026-05-12-library-permissions-model`. **Reemplaza el modelo
  legado** (`ContributionPolicy { ADMIN_ONLY | DESIGNATED |
MEMBERS_OPEN | SELECTED_GROUPS }`) que mezclaba dimensiones; el
  caso "cualquier miembro escribe" (`MEMBERS_OPEN`) **se elimina**.
- **Recientes**: top-N items globales del place ordenados por
  `Post.lastActivityAt DESC` (no por `createdAt` — refleja
  actividad real, mismo criterio que en discusiones).

**Doc / Recurso (vocabulario R.5 vs R.7)**: el handoff R.5 usa
"doc" para nombrar items. R.7 lo reemplaza por "item" en código
(`LibraryItem`). El término "recurso" sigue existiendo en copy
user-facing genérico ("Tu comunidad todavía no agregó recursos")
pero el modelo de datos lo refleja como `LibraryItem`.

**DocType (deprecated en R.7)**: el discriminador
`pdf | link | image | doc | sheet` del handoff R.5 desaparece —
todo item es un thread documento. El "tipo" de un embed lo
define `provider` y se resuelve a un icono visual, no a un kind
ontológico.

**Idioma**: UI en español ("Biblioteca", "Recursos", "Recientes",
"Sin resultados", "Insertar contenido", "Quién puede crear acá").
Código en inglés (`LibraryCategory`, `LibraryItem`,
`contributionPolicy`, `embedNode`, etc.).

## 3. Scope v1 (R.5.1) — UI-only

**Sí en v1 (R.5)** ✅ entregado:

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

**NO en v1, sí en v2 (R.7)** — planeado en este spec:

- Backend completo: schemas Prisma `LibraryCategory` +
  `LibraryItem` + `LibraryCategoryContributor`, migrations, RLS
  policies, queries, server actions.
- Admin CRUD de categorías en `/settings/library` (crear,
  editar emoji+título, archivar, reordering manual,
  contribution policy + designated contributors).
- Compositor de items con TipTap + embed custom node intercalado
  en el body.
- Item detail page (`/library/[categorySlug]/[itemSlug]`) con
  TipTap renderer + comments + reactions (reuse de discusiones).
- Conexión zona `/library` con backend real: cuando hay
  categorías, `<CategoryGrid>` toma data real; cuando hay
  items recientes, `<RecentsList>` se monta.
- Cross-zona: redirect 308 desde `/conversations/[itemSlug]` a
  la URL canónica `/library/[cat]/[itemSlug]`. El item aparece
  en listado de discusiones igual que un evento (es un Post).

**NO en R.7, deferred a R.7.X follow-ups**:

- **Storage propio (uploads de archivos)**: integración Wasabi
  o similar BYO storage. Los items v2 solo aceptan embeds
  (URLs externas). Decisión user 2026-04-30: evita costos
  incrementales hasta validar producto.
- **`TypeFilterPills` con filtros funcionales**: como ya no hay
  `DocType`, el componente queda en el slice como referencia
  R.5 pero el page no lo monta. R.7.X+ podría sumar filtros
  semánticos ("Mis aportes" / "De los demás") similar a
  `<ThreadFilterPills>` de discussions — fuera de scope R.7.
- **Lección con progress gating**: variante futura del embed
  custom node (atributo `requiresPreviousCompletion: bool` +
  tracking per-user). El embed básico v2 deja la base lista —
  extender es agregar atributos + NodeView, no rehacer schema.
- **Versionado de body**: editar pisa el body actual sin
  historial. R.7.X+ si producto pide.
- **Bulk actions admin**: mover items entre categorías,
  archivar bulk.
- **Realtime** (presence en vivo en item, contadores en vivo).
- **Search en library**: depende de R.4 search overlay global.
- **Cover desktop rendering**: `coverUrl` se guarda pero mobile
  no renderiza. La UI desktop que use el cover llega cuando
  exista layout desktop específico.
- **Stats internas** (admin-only): items más leídos por mes
  para audit, NO para gamificación.

## 4. Routes y comportamiento

### `/library` (zona root)

Server Component. Estructura JSX completa con conditionals para
pluggear backend en R.7 sin cambios en componentes.

**R.5 (entregado)**: data hardcoded como arrays vacíos →
renderiza `<EmptyLibrary>`.

**R.7 (planeado)**: el page llama `listLibraryCategories(place.id)`
y `listRecentItems(place.id, { limit: 5 })`. Estructura JSX
intacta:

```tsx
const categories = await listLibraryCategories(place.id)
const recents = await listRecentItems(place.id, { limit: 5 })

return (
  <section className="flex flex-col gap-4 pb-6">
    <LibrarySectionHeader />
    {categories.length === 0 ? <EmptyLibrary /> : <CategoryGrid categories={categories} />}
    {recents.length > 0 ? <RecentsList items={recents} /> : null}
  </section>
)
```

Renombrado interno: el prop de `<RecentsList>` pasa de `docs` a
`items` (alineado con el rename `LibraryDoc → LibraryItem`).

### `/library/[categorySlug]` (categoría)

Server Component.

**R.5 (entregado)**: `notFound()` directo (sin backend, ningún
slug es válido).

**R.7 (planeado)**:

```tsx
const place = await loadPlaceBySlug(placeSlug)
if (!place) notFound()
const category = await findCategoryBySlug(place.id, categorySlug)
if (!category || category.archivedAt) notFound()

const items = await listItemsByCategory(category.id)
const viewer = await resolveViewerForPlace({ placeSlug })
const canCreate = canCreateInCategory(category, viewer)

return (
  <div className="pb-6">
    <CategoryHeaderBar
      rightSlot={canCreate ? <NewItemButton categorySlug={category.slug} /> : null}
    />
    <header className="mt-4 px-3">
      <h1 className="font-title text-[28px] font-bold text-text">
        {category.emoji} {category.title}
      </h1>
      <p className="mt-1 text-sm text-muted">{items.length} recursos</p>
    </header>
    {items.length === 0 ? <EmptyItemList hasFilter={false} /> : <ItemList items={items} />}
  </div>
)
```

`<EmptyItemList>` reusa el componente `<EmptyDocList>` de R.5
(rename interno) — los dos casos del prop `hasFilter` siguen
existiendo en el código aunque hoy v2 no monte filter pills.

### `/library/[categorySlug]/[itemSlug]` (item detail)

**R.5**: route inexistente (404 de Next).

**R.7**: Server Component que renderiza el thread documento. Es
la **URL canónica del item** — ver § 13 sobre cross-zona.

```tsx
const item = await findItemBySlug(place.id, categorySlug, itemSlug)
if (!item || item.archivedAt) notFound()

const post = await loadPostByLibraryItem(item.id) // discussions slice
const comments = await listCommentsByPost(post.id)
const readers = await listPostReaders(post.id, { limit: 5 })

return (
  <div className="pb-24">
    <ThreadHeaderBar /* reuse de discussions */
      rightSlot={<ItemAdminMenu item={item} viewer={viewer} />}
    />
    <LibraryItemHeader item={item} category={category} post={post} />
    <PostBodyRenderer body={post.body} /> /* reuse + embed nodes */
    <ReactionBar postId={post.id} /> /* reuse de discussions */
    <PostReadersBlock readers={readers} /> /* reuse */
    <CommentThread comments={comments} /> /* reuse */
    <CommentComposer postId={post.id} /> /* reuse */
  </div>
)
```

**Cross-zona (R.7)**: la route `/conversations/[itemSlug]` detecta
que el `Post` tiene `libraryItemId` poblado y devuelve
**redirect 308** a `/library/[cat]/[itemSlug]` — la URL
canónica del item es la de biblioteca. Asimétrico con eventos
(F.F: canónica conversations) — documentado en § 13.

### `/library/[categorySlug]/new` (compositor de item, R.7)

Server Component padre que valida permisos (`canCreateInCategory`)
y renderiza un Client Component `<LibraryItemForm>` con TipTap
editor + embed toolbar + cover picker.

### `/settings/library` (admin CRUD, R.7)

Server Component bajo el gate admin/owner heredado del layout
`/settings`. Listado de categorías + form crear/editar inline +
acción archivar + sub-flujo "Quién puede crear acá" (designated
contributors). Ver § 11 + § 14.

## 5. Componentes UI

Listado completo en `src/features/library/ui/`. Server Components
salvo `<TypeFilterPills>` (usa `useSearchParams` + `useRouter`).

**Componentes R.5 (entregados)**:

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

**Componentes R.7 (planeados)** — se suman al slice cuando
aterrice cada sub-fase:

| Componente            | Tipo   | Props                            | Reuse                                               |
| --------------------- | ------ | -------------------------------- | --------------------------------------------------- |
| `LibraryItemHeader`   | Server | `item`, `category`, `post`       | `<MemberAvatar>`, `<TimeAgo>`                       |
| `ItemList`            | Server | `items`                          | reusa `<RecentDocRow>` (renombrado)                 |
| `EmptyItemList`       | Server | `hasFilter?`                     | layout EmptyThreads (rename de `EmptyDocList`)      |
| `NewItemButton`       | Server | `categorySlug`                   | `<Link>` con estilo accent                          |
| `LibraryItemForm`     | Client | `mode`, `categoryId`, `initial?` | TipTap editor (reuse discussions/ui), embed toolbar |
| `EmbedNodeView`       | Client | TipTap NodeViewProps             | iframe / link según provider                        |
| `EmbedToolbar`        | Client | `editor: Editor`                 | nuevo (botón "Insertar contenido")                  |
| `ItemAdminMenu`       | Client | `item`, `viewer`                 | reusa `<DropdownMenu>` patrón `<PostAdminMenu>`     |
| `CategoryListAdmin`   | Server | `categories`                     | nuevo (settings)                                    |
| `CategoryFormDialog`  | Client | `mode`, `initial?`               | reusa `<Dialog>` shared                             |
| `ContributorsManager` | Client | `category`, `contributors`       | reusa `<MemberAvatar>` + autocomplete               |

**Reuse de primitives existentes**:

- `<PageIcon>`, `<BackButton>`, `<TimeAgo>`, `<Dialog>`,
  `<DropdownMenu>` (shared).
- `<ThreadHeaderBar>`, `<PostBodyRenderer>` (renombre de
  `<PostBody>`), `<ReactionBar>`, `<PostReadersBlock>`,
  `<CommentThread>`, `<CommentItem>`, `<CommentComposer>` —
  desde `discussions/public.ts` o `public.server.ts` según
  client/server.
- `<MemberAvatar>` desde `members/public.ts`.
- TipTap config base desde `discussions/ui/post-composer.tsx`
  (extensión + extender con `EmbedNode`).
- Patrón `mx-3 divide-y divide-border` (ItemList) idéntico al
  ThreadRow listado.

**Cross-slice imports (R.7)**: library importa de:

- `shared/` (libre).
- `discussions/public(.server)` para `<ThreadHeaderBar>`,
  `<PostBodyRenderer>`, `<CommentThread>`, etc. + helper
  `createPostFromSystemHelper` para crear el Post asociado al
  LibraryItem en una tx atómica (precedente F.C / F.E /
  eventos).
- `members/public(.server)` para `<MemberAvatar>` y
  permisos.

discussions/events/members NO importan de library. La regla se
mantiene unidireccional. `tests/boundaries.test.ts` se actualiza
para aceptar las nuevas dependencias library → discussions/members.

## 6. Empty states

**R.5 (vigente hasta que R.7 conecte backend)**: 3 escenarios.

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

**R.7 — ajustes**:

- Empty 1 (zona vacía) se mantiene como está. Sigue **sin CTA**
  para member común (un member que no es designated/policy=open
  no puede crear categoría — la categoría es decisión admin). El
  admin que entra a `/library` con cero categorías ve el mismo
  empty pero con un CTA secundario "Crear primera categoría →
  Settings" (link a `/settings/library`).
- Empty 2 (categoría vacía) **suma CTA condicional** "Crear el
  primero →" cuando el viewer puede crear en esa categoría
  según `canCreateInCategory(category, viewer)`. Si no puede,
  empty queda sin CTA — el contenido lo trae quien tiene
  permiso, el resto espera.
- Empty 3 (filter sin matches): no aplica en R.7 porque no hay
  filter pills funcionales. Si R.7.X reintroduce filtros
  ("Mis aportes" / "De los demás"), el empty state vuelve.

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

## 8. Sub-fases R.5 (cerradas)

| Sub       | Deliverable                                                                                        | Estado          |
| --------- | -------------------------------------------------------------------------------------------------- | --------------- |
| **R.5.0** | Plan + decisiones del user.                                                                        | ✅ (2026-04-30) |
| **R.5.1** | Spec (este doc, v1) + slice scaffolding (domain/types + 11 componentes UI + 5 tests + public.ts).  | ✅ (2026-04-30) |
| **R.5.2** | Routes `/library` + `/library/[categorySlug]` + 4ª zona en `ZONES` + tests del shell actualizados. | ✅ (2026-04-30) |
| **R.5.3** | Cleanup + roadmap.md con R.5 ✅.                                                                   | ✅ (2026-04-30) |

## 9. R.5.X follow-ups que entran en R.7

R.5 dejó listada una lista de follow-ups. R.7 (este spec extendido)
entrega los siguientes:

- ✓ **Backend** completo (schemas, migrations, RLS, queries,
  actions) — ahora con modelo unificado `LibraryItem` (no
  `LibraryDoc + DocType`).
- ✓ **Item detail page** — implementada como thread documento con
  reuse de discusiones.
- ✓ **Admin CRUD categorías** — CRUD + contribution policy +
  designated contributors. Reordering manual con drag & drop
  queda en R.7.5 (UI admin).

**R.5.X que SIGUEN deferred** (post-R.7):

- **Uploads de archivos al storage propio**: queda como BYO
  storage (Wasabi/etc) en R.7.X+. Hoy todo es embed externo.
- **`<ZoneFab>` item "Crear recurso en biblioteca"**: el FAB hoy
  ofrece "Nueva discusión" + "Proponer evento". Sumar "Crear
  recurso" obliga a elegir categoría primero — UX requiere
  diseño. Decisión: **NO en R.7** — el flow de creación arranca
  desde la categoría (`/library/[cat]/new`) o desde el botón
  "Crear el primero" del empty state. R.7.X+ puede sumar el
  item al FAB con un sub-modal "elegí categoría".
- **Search integration**: depende de R.4.
- **Stats internas admin-only**.
- **TypeFilterPills funcional con semántica nueva** ("Mis
  aportes" / "De los demás"): existente en código R.5 sin
  montar; reactivar en R.7.X si producto pide.
- **Bulk actions admin**.
- **Realtime presence en item detail**.

## 10. Modelo de datos (R.7)

### 10.1 Tablas nuevas

> **Modelo v2 (2026-05-12)** — `ReadAccessKind` + `WriteAccessKind`
> simétricos con 6 tablas pivote. Reemplaza el modelo legado
> (`ContributionPolicy` + `LibraryCategoryContributor` +
> `GroupCategoryScope`). Decisión documentada en ADR
> `2026-05-12-library-permissions-model`. Implementación en
> `docs/plans/2026-05-12-library-permissions-redesign.md` (S1).

```prisma
model LibraryCategory {
  id                  String   @id @default(cuid())
  placeId             String
  slug                String                            // auto desde title, inmutable
  emoji               String                            // 1 char emoji
  title               String                            // 1..60 chars
  position            Int                               // orden manual; default = max+1
  kind                LibraryCategoryKind @default(GENERAL)
  readAccessKind      ReadAccessKind  @default(PUBLIC)
  writeAccessKind     WriteAccessKind @default(OWNER_ONLY)
  archivedAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  place               Place    @relation(fields: [placeId], references: [id], onDelete: Cascade)
  items               LibraryItem[]

  // 3 pivots de read (sumados en 2026-05-04, ADR library-courses-and-read-access)
  groupReadScopes     LibraryCategoryGroupReadScope[]
  tierReadScopes      LibraryCategoryTierReadScope[]
  userReadScopes      LibraryCategoryUserReadScope[]

  // 3 pivots de write (sumados en 2026-05-12, ADR library-permissions-model)
  groupWriteScopes    LibraryCategoryGroupWriteScope[]  // rename de GroupCategoryScope
  tierWriteScopes     LibraryCategoryTierWriteScope[]   // NEW
  userWriteScopes     LibraryCategoryUserWriteScope[]   // rename de LibraryCategoryContributor

  @@unique([placeId, slug])
  @@index([placeId, archivedAt])
  @@index([placeId, position])
}

enum ReadAccessKind {
  PUBLIC      // todos los miembros activos del place
  GROUPS      // restringido a N groups
  TIERS       // restringido a N tiers
  USERS       // restringido a N users
}

enum WriteAccessKind {
  OWNER_ONLY  // solo owner del place — default restrictivo
  GROUPS      // N groups
  TIERS       // N tiers
  USERS       // N users
}

// Las 6 pivots tienen shape idéntico: { categoryId, subjectId } con PRIMARY KEY
// composite y FK cascade. Ejemplo (los otros 5 son análogos):
model LibraryCategoryUserWriteScope {
  categoryId  String
  userId      String

  category    LibraryCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  user        User            @relation(fields: [userId],     references: [id], onDelete: Cascade)

  @@id([categoryId, userId])
  @@index([userId])
}

model LibraryItem {
  id          String   @id @default(cuid())
  placeId     String                                    // denormalizado para RLS performante
  categoryId  String
  postId      String   @unique                          // 1:1 con Post — el thread documento
  coverUrl    String?                                   // mobile no renderiza; reservado desktop futuro
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  place       Place           @relation(fields: [placeId], references: [id], onDelete: Cascade)
  category    LibraryCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  post        Post            @relation("PostLibraryItem", fields: [postId], references: [id], onDelete: Cascade)

  @@index([placeId, archivedAt])
  @@index([categoryId, archivedAt])
}
```

### 10.2 Relación bidireccional Post ↔ LibraryItem (sin XOR SQL)

**Decisión refinada en R.7.5** (2026-04-30): el modelo `Post` NO
gana columnas `eventId` ni `libraryItemId`. La relación bidireccional
Post↔Event ya es **back-pointer Prisma sin FK columna**: `Event` tiene
`postId UNIQUE` como FK, Prisma infiere `Post.event: Event?`.

Aplicamos el mismo pattern a `LibraryItem`:

```prisma
model LibraryItem {
  postId String @unique  // FK a Post
  // ...
}

model Post {
  // ...campos existentes
  event       Event?        // back-pointer (sin FK column)
  libraryItem LibraryItem?  // back-pointer (sin FK column)
}
```

**XOR validado en domain layer, NO en SQL.** Postgres no tiene un
CHECK natural para "no hay simultáneamente un Event Y un LibraryItem
apuntando a este Post", y agregar columnas `Post.eventId` /
`Post.libraryItemId` solo para soportar el CHECK rompe el patrón
bidireccional ya establecido en F.B. La validación vive en
`createEventAction` y `createItemAction` — antes de hacer INSERT,
chequean que el `Post` no tenga ya el otro tipo asociado.

Trade-off aceptado: si un bug crea ambos vínculos, Postgres lo
permite. Test de integración cross-slice cubre el invariant. La
matriz de RLS de `LibraryItem.INSERT` ya exige
`Post.authorUserId = auth.uid()` — un member común no puede
"secuestrar" un Post de otro tipo.

### 10.3 Snapshots y erasure 365d

Un `LibraryItem` no necesita su propio `authorSnapshot` — el Post
asociado ya lo tiene (`Post.authorSnapshot`). Cuando el cron de
erasure corre, renombra el `displayName` a "ex-miembro" en el
Post; el item de biblioteca lo muestra automáticamente vía join.

`runErasure` debe extenderse para considerar `LibraryItem` solo
si el Post ya está siendo procesado (no es trabajo extra — el
Post ES el item).

### 10.4 RLS — políticas resumidas

> **Modelo v2 (2026-05-12)** — RLS coordinada con el nuevo
> `ReadAccessKind` + `WriteAccessKind`. Helpers SQL
> `is_in_category_read_scope(category_id, user_id)` y
> `is_in_category_write_scope(category_id, user_id)` evitan duplicar
> lógica en cada policy.

- **`LibraryCategory` SELECT**: cualquier miembro del place ve las
  categorías no archivadas (la lista de categorías es transparente —
  el gate de acceso es a nivel item dentro de la categoría).
- **`LibraryCategory` INSERT/UPDATE/DELETE**: solo owner del place
  (vía claim `is_owner_in_place`).
- **6 pivots** (`LibraryCategory{Group,Tier,User}{Read,Write}Scope`)
  **SELECT**: cualquier miembro del place ve las listas (transparente).
- **6 pivots INSERT/DELETE**: solo owner del place.
- **`LibraryItem` SELECT**: el viewer puede ver si:
  - Es owner del place (bypass), o
  - `is_in_category_read_scope(item.categoryId, viewer)` es true (que
    incluye PUBLIC | groups | tiers | users), o
  - `is_in_category_write_scope(item.categoryId, viewer)` es true
    (write implica read).
- **`LibraryItem` INSERT**: el viewer puede crear si:
  - Es owner del place (bypass), o
  - `is_in_category_write_scope(item.categoryId, viewer)` es true
    (que incluye OWNER_ONLY = solo owner | groups | tiers | users).
- **`LibraryItem` UPDATE**: owner del place o author del Post asociado.
- **`LibraryItem` DELETE**: nunca — solo soft delete via `archivedAt`.
  La política bloquea DELETE físico salvo cron de erasure por place
  archive.

Tests RLS en `tests/rls/library-*.test.ts` cubren al menos: 5
casos de SELECT (member ve, no-member no ve, archivada oculta,
contributor ve sus categorías, ex-miembro 365d), 4 casos de
INSERT/UPDATE (admin sí, member no, designated en su categoría
sí, designated en otra categoría no), y matrices de archivar.

## 11. Permisos (matriz canónica)

> **Modelo v2 (2026-05-12)** — la matriz refleja el nuevo
> `WriteAccessKind` + read access scopes. ADR
> `2026-05-12-library-permissions-model`.

Vocabulario:

- **place owner**: rol del miembro en el place
  (`PlaceOwnership`). En el modelo v2, **owner** es el único rol con
  poderes administrativos sobre library — admin del place ya no
  tiene poderes especiales acá (decisión user 2026-05-12).
- **author del item**: el `Post.authorUserId` del Post asociado al
  `LibraryItem`. La palabra "owner" NO se usa para esto en library —
  se usa "author" para evitar choque con el rol de place.
- **read-scoped**: viewer matchea el `readAccessKind` de la categoría
  según el scope (PUBLIC = cualquier miembro; GROUPS/TIERS/USERS = en
  la pivot correspondiente).
- **write-scoped**: viewer matchea el `writeAccessKind` de la
  categoría según el scope (OWNER_ONLY = solo owner; GROUPS/TIERS/
  USERS = en la pivot correspondiente). **Write implica read**: si
  estás write-scoped, automáticamente sos read-scoped.

| Acción                                | place owner | author del item | write-scoped | read-scoped (sin write) | miembro común sin scope |
| ------------------------------------- | ----------- | --------------- | ------------ | ----------------------- | ----------------------- |
| Crear categoría                       | ✓           | —               | —            | —                       | —                       |
| Editar categoría (emoji + título)     | ✓           | —               | —            | —                       | —                       |
| Archivar categoría                    | ✓           | —               | —            | —                       | —                       |
| Configurar `readAccessKind` + scopes  | ✓           | —               | —            | —                       | —                       |
| Configurar `writeAccessKind` + scopes | ✓           | —               | —            | —                       | —                       |
| Reordenar categorías                  | ✓           | —               | —            | —                       | —                       |
| Crear item en categoría               | ✓           | —               | ✓            | —                       | —                       |
| Editar body/cover/título item         | ✓           | ✓               | —            | —                       | —                       |
| Archivar item                         | ✓           | ✓               | —            | —                       | —                       |
| Comentar / reaccionar                 | ✓           | ✓               | ✓            | ✓                       | —                       |
| Leer item                             | ✓           | ✓               | ✓            | ✓                       | —                       |

Funciones puras en `src/features/library/domain/permissions.ts`:

- `canRead(category, viewer): boolean` — owner bypass | write-scoped
  (write implies read) | read-scoped.
- `canWrite(category, viewer): boolean` — owner bypass | write-scoped.
- `canEditItem(item, post, viewer): boolean` — owner | author.
- `canArchiveItem(item, post, viewer): boolean` — owner | author.

Cada función se usa en:

- Server-side (page, action) para gate.
- RLS policy a nivel SQL (replica la lógica vía helpers
  `is_in_category_read_scope` / `is_in_category_write_scope`, ver § 10.4).
- UI condicional (botón "Crear" visible/oculto).

## 12. Editor + embed custom node (TipTap)

### 12.1 Setup base

`<LibraryItemForm>` (Client Component) instancia un `Editor` de
TipTap con las mismas extensions usadas en el composer de
discusiones (StarterKit, Underline, Mention si aplica) **más** la
extension custom `EmbedNode`. La toolbar suma un botón
"Insertar contenido" que abre un mini-form (URL + título
opcional) y dispara `editor.commands.insertEmbedNode({...})`.

El AST resultante es JSON serializable, válido para `Post.body`,
y compatible con la pipeline existente:

- Validación con Zod (`postBodySchema` se extiende para aceptar
  el nodo `embed` con sus atributos).
- Renderer en read-mode (`<PostBodyRenderer>`) detecta
  `node.type === 'embed'` y delega a `<EmbedNodeView>` (Client,
  pero pre-renderizable en Server según provider).
- Sanitización: las URLs se validan contra la whitelist de
  providers; `generic` no permite `javascript:` ni `data:` — solo
  `http(s):`.

### 12.2 Definición del nodo

```ts
// src/features/library/ui/embed-node/extension.ts
export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,                       // contenido no editable inline
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: '' },
      provider: { default: 'generic' },  // youtube|vimeo|drive|dropbox|gdoc|gsheet|generic
      title: { default: '' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-embed]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': true, ... }), 0]
  },
  addNodeView() { return ReactNodeViewRenderer(EmbedNodeView) },
})
```

### 12.3 NodeView (preview en editor + render en read mode)

`<EmbedNodeView>` es un Client Component que renderiza el embed
según provider:

| Provider  | Render                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------- |
| `youtube` | `<iframe>` con thumbnail y aspect 16:9                                                             |
| `vimeo`   | `<iframe>` con aspect 16:9                                                                         |
| `gdoc`    | `<iframe src="...embed=true">` (Google permite embed con flag)                                     |
| `gsheet`  | `<iframe src="...embed=true">`                                                                     |
| `drive`   | Card con icon Drive + título + botón "Abrir en Drive" (no iframe — Drive bloquea iframes externos) |
| `dropbox` | Card similar a Drive                                                                               |
| `generic` | Card con favicon (si lo podemos resolver server-side) + URL + botón "Abrir"                        |

En modo edición, el NodeView agrega un overlay con botones
"Editar URL" y "Eliminar" (solo visibles si `editor.isEditable`).

### 12.4 Parser de URL → provider

`src/features/library/domain/embed-parser.ts` exporta
`parseEmbedUrl(url): { provider: EmbedProvider; canonicalUrl: string; metadata?: { videoId?: string } }`.

Reconoce:

- `youtube.com/watch?v=...`, `youtu.be/...` → `youtube` (extrae
  `videoId`).
- `vimeo.com/<id>` → `vimeo`.
- `docs.google.com/document/...` → `gdoc`.
- `docs.google.com/spreadsheets/...` → `gsheet`.
- `drive.google.com/...` → `drive`.
- `dropbox.com/...` → `dropbox`.
- Cualquier otro http(s) → `generic`.

URLs `javascript:` o malformadas lanzan `ValidationError`.

### 12.5 Indexación en search (R.4 follow-up)

Cuando R.4 entregue el search overlay, indexar:

- `title` + `body` text nodes del Post (texto plano).
- Por cada nodo `embed`: el atributo `title` (lo que el author
  escribió) y `provider` como categoría facetable.
- NO se indexa `url` raw — sería ruido.

## 13. Cross-zona y URL canónica

### 13.1 Asimetría intencional vs eventos

| Objeto       | Canónica                             | Redirect 308                           |
| ------------ | ------------------------------------ | -------------------------------------- |
| Evento (F.F) | `/conversations/[postSlug]`          | `/events/[eventId]` → canónica         |
| LibraryItem  | `/library/[categorySlug]/[itemSlug]` | `/conversations/[postSlug]` → canónica |

**Por qué la asimetría**: un evento no pertenece a una sub-zona
del producto — es un objeto del place global, y discusiones es
donde la conversación vive. Un library item, por contraste,
**pertenece a una categoría** — la URL refleja esa pertenencia.
Decisión user 2026-04-30 ("library es la canónica para que se
mantenga la convención" de "URL refleja jerarquía de pertenencia").

### 13.2 Apariciones del item en otras zonas

- En `/library/[cat]`: render como `<RecentDocRow>` (renombrado
  conceptualmente a row del item) con icon de provider del
  primer embed o icon genérico si no hay embeds.
- En `/library` (Recientes): mismo render que arriba, top-N.
- En `/conversations` (lista de discusiones): el Post aparece
  en la lista igual que cualquier otro thread, **con un badge
  visual** que lo identifica como recurso de biblioteca (icon
  📚 + label de la categoría). Click navega a la canónica
  `/library/[cat]/[slug]` (el redirect 308 lo hace el page
  `/conversations/[slug]`, no el link — los links a items
  apuntan directo a la canónica).
- En `/inbox` (cuando exista): items con actividad reciente
  aparecen como threads cualquiera. Mismo comportamiento.

### 13.3 Comments cross-zona

Los comments del item viven en `Comment` igual que un Post
cualquiera. Aparecen en la canónica
`/library/[cat]/[slug]`. NO se replican en `/conversations` —
hay una sola conversación, una sola URL canónica.

## 14. Sub-fases R.7 — pequeñas, manejables, con commit por sub-fase

> **Regla de oro de esta fase**: cada sub-fase termina con un
> commit explícito. El user pidió esto para poder volver atrás
> si algo se rompe. Antes de empezar R.7.1 hay un tag `pre-R.7`
> apuntando al commit de R.5.3 — `git reset --hard pre-R.7`
> deshace todo R.7 si hace falta.

### 14.0 — Spec extendida (esta sub-fase)

**Deliverable**: este doc actualizado con secciones § 10–§ 15
nuevas + ajustes en § 1–§ 9.

**Verificación**: `pnpm typecheck` y `pnpm lint` siguen verde
(no se tocó código).

**Commit**: `docs(library): spec R.7 — backend + admin CRUD + items editoriales con embeds`.

### 14.1 — Schema + migrations + RLS de categorías

**Deliverable**:

- Migration Prisma con `LibraryCategory`, `LibraryCategoryContributor`,
  `ContributionPolicy` enum, índices.
- RLS policies para ambas tablas (SELECT/INSERT/UPDATE/DELETE).
- Tests RLS en `tests/rls/library-categories.test.ts` (≥6
  casos: member ve, no-member no ve, admin crea, member no crea,
  archivada oculta para member, designated read sigue mismo
  patrón).
- Sin código aplicación todavía.

**Verificación**: `pnpm test:rls` verde + `prisma migrate dev`
limpio + `pnpm typecheck`/`lint`/`test` verde.

**Commit**: `feat(library): schema + RLS de LibraryCategory (R.7.1)`.

### 14.2 — Domain + queries + actions de categorías

**Deliverable**:

- `domain/types.ts` extendido con `LibraryCategory` final
  (reemplaza el shape R.5) + `ContributionPolicy` + tipo
  `LibraryCategoryContributor`.
- `domain/invariants.ts` con cap `MAX_CATEGORIES_PER_PLACE = 30`,
  validación de slug, max length de título.
- `domain/permissions.ts` con `canCreateInCategory`,
  `canEditCategory`, etc. (puro, testeable, reusable RLS-side).
- `domain/errors.ts` con `CategoryLimitReachedError`,
  `CategorySlugConflictError`, etc.
- `schemas.ts` con Zod (`createCategoryInput`,
  `updateCategoryInput`).
- `server/queries.ts`: `listLibraryCategories(placeId)`,
  `findCategoryBySlug(placeId, slug)`,
  `listCategoryContributors(categoryId)`.
- `server/actions/create-category.ts`,
  `server/actions/update-category.ts`,
  `server/actions/archive-category.ts`,
  `server/actions/reorder-categories.ts`.
- `public.server.ts` con queries; `public.ts` con tipos +
  actions client-safe.
- Tests unit: invariants, permissions, action behavior con DB
  in-memory.

**Verificación**: `pnpm typecheck`/`lint`/`test` verde + boundaries
test verde.

**Commit**: `feat(library): backend de categorías — queries + actions (R.7.2)`.

### 14.3 — Settings UI: CRUD de categorías

**Deliverable**:

- Page `src/app/[placeSlug]/settings/library/page.tsx` (Server)
  - `error.tsx` + `loading.tsx` (mismo patrón
    `/settings/flags/`).
- `<CategoryListAdmin>` (Server): listado con archive button
  por row.
- `<CategoryFormDialog>` (Client): modal crear/editar con
  emoji picker (lib mínima — usar `<input>` text con
  validación 1 char Unicode emoji) + título + dropdown
  contribution policy.
- `<ArchiveCategoryConfirmDialog>` (Client).
- Reordering manual: `<DraggableCategoryList>` con
  drag-and-drop (lib `@dnd-kit/core` ya en discussions o sumar
  si no está; si suma, el cap LOC del slice puede pinchar — vale
  ADR si excede).
- Reuse: `<Dialog>`, `<DropdownMenu>` shared, `<Toaster>` para
  feedback de actions.
- Tests E2E smoke: admin crea → ve → edita → archiva.

**Verificación**: `pnpm typecheck`/`lint`/`test` + `pnpm test:e2e --grep library-admin` verde + manual QA.

**Commit**: `feat(library): admin CRUD de categorías en /settings/library (R.7.3)`.

### 14.4 — ~~Designated contributors UI~~ (OBSOLETO 2026-05-12)

> Esta sub-fase queda **obsoleta** por el rediseño del modelo de
> permisos v2 (ADR `2026-05-12-library-permissions-model`). El
> concepto "designated contributors" (`ContributionPolicy.DESIGNATED`
>
> - tabla `LibraryCategoryContributor`) se reemplaza por
>   `WriteAccessKind.USERS` con pivot `LibraryCategoryUserWriteScope`.
>
> La UI de seleccionar users-que-pueden-escribir vive ahora dentro del
> **wizard unificado de categoría** (step "Escritura"), no en un
> sub-dialog separado. Plan de implementación en
> `docs/plans/2026-05-12-library-permissions-redesign.md` § S2.

### 14.5 — Schema + RLS de items

**Deliverable**:

- Migration Prisma con `LibraryItem` + extensión a `Post`
  (`libraryItemId` FK) + CHECK constraint `(eventId IS NULL OR libraryItemId IS NULL)`.
- RLS policies para `LibraryItem`.
- Tests RLS (≥6 casos: ver, crear según policy, editar como
  author, editar como admin, archivar, archivada oculta).

**Verificación**: usual + `prisma migrate` limpio.

**Commit**: `feat(library): schema + RLS de LibraryItem (R.7.5)`.

### 14.6 — Domain + queries + actions de items

**Deliverable**:

- `domain/types.ts` extendido con `LibraryItem` final.
- `domain/invariants.ts` extendido (item title cap, body min,
  cover URL format).
- `domain/permissions.ts` extendido con `canCreateInCategory`,
  `canEditItem`, `canArchiveItem`.
- `schemas.ts` extendido (`createItemInput`,
  `updateItemInput` — body es el AST TipTap).
- `server/queries.ts` extendido:
  `findItemBySlug(placeId, categorySlug, itemSlug)`,
  `listItemsByCategory(categoryId)`,
  `listRecentItems(placeId, { limit })`.
- `server/actions/create-item.ts` (tx atómica:
  `Post + LibraryItem` en una sola transacción —
  precedente F.C / F.E / eventos).
- `server/actions/update-item.ts`.
- `server/actions/archive-item.ts`.
- Cross-slice: usa `createPostFromSystemHelper` con kind
  `LIBRARY_ITEM` (sumar al enum si hace falta).
- Tests.

**Verificación**: usual + tests cross-slice integration.

**Commit**: `feat(library): backend de items — queries + actions (R.7.6)`.

### 14.7 — TipTap embed extension

**Deliverable**:

- `library/domain/embed-parser.ts` (URL → provider).
- `library/ui/embed-node/extension.ts` (TipTap Node).
- `library/ui/embed-node/node-view.tsx` (Client Component).
- `library/ui/embed-toolbar.tsx` (botón "Insertar contenido"
  que abre mini-form URL + título).
- Extender el Zod schema de `Post.body` (en discussions slice)
  para aceptar `embed` node — esto es el único cambio
  cross-slice del lado de discussions; resto está OK porque
  TipTap nodes son extensibles.
- Tests parser + AST validator + render snapshots.

**Verificación**: usual + verificar que post composer
existente (sin extensión embed) sigue funcionando — un post
"viejo" no debe romper si la extensión está disponible pero no
se usa.

**Commit**: `feat(library): TipTap embed custom node con 6 providers (R.7.7)`.

### 14.8 — UI de creación de item (compositor)

**Deliverable**:

- Page `/library/[categorySlug]/new/page.tsx` (Server, valida
  permission y categoría existente) que renderiza
  `<LibraryItemForm mode="create">`.
- `<LibraryItemForm>` (Client): título + cover URL opcional +
  TipTap editor con embed toolbar.
- Submit dispara `createItemAction` → redirect 303 a
  `/library/[cat]/[itemSlug]` (canónica).
- Tests + E2E smoke (admin crea item con texto + 2 embeds).

**Verificación**: usual + manual QA del editor (insertar embed,
editarlo, eliminarlo).

**Commit**: `feat(library): compositor de items con TipTap + embeds (R.7.8)`.

### 14.9 — UI de item detail + cross-zona

**Deliverable**:

- Page `/library/[categorySlug]/[itemSlug]/page.tsx` (Server)
  con render completo: header + body + reactions + readers +
  comments + composer.
- Reuse de `<ThreadHeaderBar>`, `<PostBodyRenderer>`
  (extendido para renderizar embed nodes vía
  `<EmbedNodeView>`), `<ReactionBar>`, `<PostReadersBlock>`,
  `<CommentThread>`, `<CommentComposer>` desde discussions.
- `<LibraryItemHeader>`: chip de categoría + título Fraunces +
  author chip + meta (createdAt).
- `<ItemAdminMenu>` (Client): kebab con "Editar" / "Archivar"
  según permisos.
- Edit page `/library/[cat]/[itemSlug]/edit/page.tsx` que
  reusa `<LibraryItemForm mode="edit">`.
- Cross-zona: en el page `/conversations/[slug]/page.tsx`
  detectar `Post.libraryItemId` poblado y emitir
  `redirect(308, /library/[cat]/[slug])`.
- E2E smoke: crear → ver detail → editar → comentar →
  archivar.

**Verificación**: usual + E2E + manual QA (visual del thread
documento, comments funcionan, reactions funcionan).

**Commit**: `feat(library): item detail + cross-zona redirect (R.7.9)`.

### 14.10 — Conexión zona /library con backend real

**Deliverable**:

- Update `/library/page.tsx`: swap del hardcoded `[]` por
  `await listLibraryCategories(place.id)` y
  `await listRecentItems(place.id, { limit: 5 })`.
- Update `/library/[categorySlug]/page.tsx`: swap del
  `notFound()` directo por `findCategoryBySlug` real + render
  con `<ItemList>` o `<EmptyItemList>` con CTA condicional.
- Renames internos del slice R.5 que ya no aplican (ej.
  `<DocList>` → `<ItemList>`, `<EmptyDocList>` →
  `<EmptyItemList>`, prop `docs` → `items` en
  `<RecentsList>`). Mantener exports backward-compat solo si
  algo externo los consume — sino delete clean.
- E2E del flow completo: admin crea categoría → admin crea
  item con embed YouTube → otro miembro entra a `/library`,
  ve la categoría con count "1 recurso", entra y ve el item,
  comenta.

**Verificación**: usual + E2E full flow + manual QA.

**Commit**: `feat(library): conexión zona /library con backend (R.7.10)`.

### 14.11 — Cleanup + roadmap.md ✅

**Deliverable**:

- `docs/roadmap.md`: sumar R.7 ✅ con sub-fases listadas.
  Mover los items de R.5.X que entran a R.7 fuera de la lista
  follow-ups y agregar los R.7.X que quedan diferidos.
- ADRs si surgió alguna decisión durante implementación que
  amerita registro (ej. `@dnd-kit` adoption, asimetría URL
  canónica documentada — esto último ya está en este spec).
- Update `tests/boundaries.test.ts` si las dependencias
  cross-slice cambiaron.
- Manual QA full pass + checklist.
- Final verify: typecheck + lint + tests + boundaries + build
  prod limpio + E2E full pass.

**Verificación**: todos los checks anteriores + checklist
manual completo.

**Commit**: `docs(roadmap): R.7 ✅ — library backend completo`.

### Resumen de tabla

| Sub        | Deliverable                                  | LOC esperado | Estado    |
| ---------- | -------------------------------------------- | ------------ | --------- |
| **R.7.0**  | Spec extendido (este doc).                   | ~400 docs    | en curso  |
| **R.7.1**  | Schema + RLS de categorías + tests RLS.      | ~150         | pendiente |
| **R.7.2**  | Domain + queries + actions de categorías.    | ~400         | pendiente |
| **R.7.3**  | Settings UI: CRUD de categorías.             | ~400         | pendiente |
| **R.7.4**  | Designated contributors UI.                  | ~250         | pendiente |
| **R.7.5**  | Schema + RLS de items + tests RLS.           | ~150         | pendiente |
| **R.7.6**  | Domain + queries + actions de items.         | ~400         | pendiente |
| **R.7.7**  | TipTap embed extension + parser + node view. | ~400         | pendiente |
| **R.7.8**  | Compositor de items.                         | ~250         | pendiente |
| **R.7.9**  | Item detail + cross-zona redirect.           | ~350         | pendiente |
| **R.7.10** | Conexión zona /library con backend.          | ~150         | pendiente |
| **R.7.11** | Cleanup + roadmap ✅.                        | ~50 docs     | pendiente |

**Total estimado**: ~3000 LOC en código + tests, distribuidos
en 11 commits atómicos. Cada sub-fase es restaurable
individualmente con `git revert <hash>` o el conjunto entero
con `git reset --hard pre-R.7`.

## 15. Excepción al cap de tamaño del slice

El cap default por slice es 1500 LOC (`CLAUDE.md`). El slice
`library/` después de R.7 puede acercarse o superar esa marca:

- `domain/` (types, invariants, permissions, errors,
  embed-parser, schemas): ~400 LOC.
- `server/` (queries + 8 actions): ~600 LOC.
- `ui/` (componentes R.5 + componentes R.7 + embed node):
  ~700 LOC.
- `__tests__/`: ~600 LOC.

Total estimado: ~2300 LOC. Requiere ADR
`docs/decisions/2026-04-30-library-size-exception.md` similar al
de discussions. Se redacta en R.7.11 (cleanup) si y solo si el
total real supera 1500. Sub-split candidato si crece más:
`library/embeds/` como sub-slice independiente con su propio
cap.

## 16. Principios no negociables aplicados (R.7)

Reafirmar lo de § 7 + adiciones de R.7:

- **"Sin métricas vanidosas"**: el contador "n recursos" en
  card sigue siendo útil, no vanity. NO sumamos "más leído",
  "más comentado del mes", "ranking de contributors".
- **"Customización activa"**: las categorías y emojis los
  decide el admin. Los designated contributors los elige el
  admin one-by-one — no hay auto-promoción ni "members con
  N items se vuelven contributors automáticamente".
- **"Memoria preservada"**: el item NO expira (a diferencia de
  los audios efímeros en discusiones que duran 24hs). La
  biblioteca es lo opuesto del feed: persistente,
  retroactivamente útil. Documentado para evitar que un dev
  futuro confunda con el patrón audio.
- **"Sin gamificación"**: no hay "items publicados este mes
  por X" ni achievements. Los items aparecen porque alguien
  con permiso los aportó — el reconocimiento social ocurre
  en los comments y reactions, no en métricas dashboard.
- **"Construcción social"**: comments + reactions activadas
  intencionalmente (decisión user 2026-04-30) — biblioteca no
  es archivo muerto, es contenido sobre el que la comunidad
  conversa. El thread documento captura esa pertenencia.

---

## 17. Cursos (kind=COURSE) — wiring 2026-05-14

ADR canónico: `docs/decisions/2026-05-04-library-courses-and-read-access.md` (D1-D12).
Wiring plan: `docs/plans/2026-05-14-library-courses-wiring.md` (W1-W5).

Una categoría puede declararse `kind: COURSE` en el wizard del admin
(paso 4: tipo). Esto cambia la semántica:

- Cada item dentro de la categoría es una **lección**.
- El author/admin puede asignar un **prereq** (otra lección de la misma
  categoría) al editar el item — `<PrereqSelector>` en
  `/library/[catSlug]/[itemSlug]/edit`. Single prereq (no DAG, decisión D4).
- El viewer ve las lecciones en el listado de categoría con candado +
  badge de prereq incompleto (`<LibraryItemLockedRow>`). Click en
  bloqueada → toast con CTA "Ir a [prereq]".
- Owner ve TODAS las lecciones desbloqueadas (bypass — necesita el
  itinerary map para gestionar).
- Lección desbloqueada (sin prereq, o prereq completado): viewer ve el
  body completo + `<MarkCompleteButton>` debajo. Click marca como
  completada → siguiente lección se desbloquea visualmente al refresh.
- Lección bloqueada (prereq incompleto, no es owner): viewer ve título
  - cover via `<LockedItemView>` con copy "Completá [prereq] primero" +
    CTA al prereq. NO se sirve el body. Decisión D2: visible-but-locked.

### Privacy + sin gamificación

- Completion es **privada por viewer** (tabla `LibraryItemCompletion` con
  PK `(itemId, userId)`). No se expone al resto del place.
- Sin contadores públicos ("X de Y completaste"), sin %, sin streaks,
  sin badges, sin leaderboards. CLAUDE.md "Sin gamificación".
- El único affordance social del feature es el toast con CTA al prereq
  — guía sin presión.

### Manual mark complete

Decisión D3: el viewer marca explícitamente. Sin auto-detect por scroll,
tiempo, o quiz. Mighty Networks + Skool usan este patrón. Auto-detect
produce false positives (Brightspace's "marked complete on view" como
crítica clásica).

### Validación de ciclos

`setItemPrereqAction` valida que la elección no cree un ciclo (BFS
app-layer, max depth 50). Test cubre: ciclo directo (A→A), indirecto
(A→B→A), profundo, no-ciclo válido. Sin constraint SQL nativa.

### Componentes canónicos

Sub-slice `features/library/courses/`:

- `<PrereqSelector>` — `<select>` con lista de items siblings (form de edit).
- `<MarkCompleteButton>` — toggle marcar/desmarcar (detail page).
- `<LibraryItemLockedRow>` — row del listado con candado + toast CTA.
- `<PrereqLockBadge>` — badge candado al lado del title.
- `<CourseItemList>` — lista de items lock-aware (categoría kind=COURSE).
- `<LockedItemView>` — vista del item bloqueado en detail page.

Server actions: `setItemPrereqAction`, `markItemCompletedAction`,
`unmarkItemCompletedAction`. Server queries: `listCompletedItemIdsByUser`,
`listCategoryItemsForPrereqLookup`, `findItemPrereqChain`.
