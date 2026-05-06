# Plan — Migración TipTap → Lexical

**Estado: ✅ ejecutado 2026-05-06.** Todas las sub-fases F.0–F.6 cerradas en una sola sesión secuencial. Suite verde: 1942 tests / 202 files. Cero residuos TipTap. Excepción al cap del slice rich-text registrada en `docs/decisions/2026-05-06-rich-text-size-exception.md`.

## Contexto

Reemplazo completo del editor de rich-text del producto. Decisión arquitectónica + tradeoffs en `docs/decisions/2026-05-06-tiptap-to-lexical.md`. Modelo del nuevo sistema en `docs/features/rich-text/spec.md`.

Pre-prod, datos descartables. Estrategia drop & rebuild (TRUNCATE + DROP COLUMN + ADD COLUMN nueva).

## Scope

**Entra**:

- Drop completo de TipTap del repo: 5 packages npm + ~38 archivos prod + ~8 tests.
- Drop de columnas JSON con shape ProseMirror y recreación con shape Lexical: `Post.body`, `Comment.body`, `Comment.quotedSnapshot`, `Event.description`.
- Nuevo slice `src/features/rich-text/` con domain + composer base + renderer SSR + 4 plugins de embed (YouTube, Spotify, Apple Podcasts, Ivoox) + plugin de mention polimórfico (`@user`, `/event`, `/library/<cat>/<item>`).
- Integración en 4 surfaces: comment, post (thread), evento, library item.
- Feature flags por place: nueva columna `Place.editorPluginsConfig` + page `/settings/editor` alineado con `docs/ux-patterns.md` + invalidación de cache via `unstable_cache` tag.
- CSP: `next.config.ts` con hosts de embeds.
- ADR (este commit), spec del nuevo modelo (este commit), plan (este commit).

**Fuera**:

- Coexistencia con TipTap (drop completo).
- Migración del shape de datos pre-existente (TRUNCATE).
- Italic toggleable por usuario (es CSS automático en links).
- Shorts/playlists de YouTube en MVP (sólo videos).
- Mention de threads (`kind: 'post'`) — agregable post-MVP sin breaking change al AST.
- Plugins comunitarios de Lexical no listados (code, image, table, etc.) — agregables post-MVP por place via flags.

## Decisiones cerradas

(Ver `docs/decisions/2026-05-06-tiptap-to-lexical.md` para tradeoffs completos.)

1. **Drop & rebuild de columnas**: TRUNCATE filas + DROP+ADD de columnas JSON. Justificación: production-grade hygiene; el shape cambia, el schema debe reflejarlo.
2. **Slice nuevo `rich-text/`** (no extender `discussions/`): sirve a 4 surfaces, mover bajo `discussions` violaba boundaries vertical-slice.
3. **Mapping per-surface confirmado**: comment/evento minimal (text+link+mention); post/library completo (+ heading h1-h3, bold, lists, embeds).
4. **Italic = CSS automático en links**, no toggle del usuario.
5. **Mention polimórfico**: 1 `MentionNode` con `kind` discriminante; triggers `@`, `/event`, `/library/<cat>/<item>`.
6. **Snapshot defensivo de mentions**: `[EVENTO NO DISPONIBLE]`, `[RECURSO NO DISPONIBLE]`, `[CONVERSACIÓN NO DISPONIBLE]` cuando target archivado/eliminado/no visible.
7. **4 embeds en MVP**: YouTube + Spotify + Apple Podcasts + Ivoox como `DecoratorNode` (~80 LOC cada).
8. **Feature flags por place**: controlan creación, no rendering retroactivo (Opción A — cozytech, sin censura post-hoc).
9. **Renderer SSR sin Lexical runtime**: visitor pattern directo AST→JSX. Performance por encima de framework purity.
10. **Ejecución secuencial**: sin agentes paralelos por petición del user. Cada sub-fase commit-able y recuperable.

## Sub-fases

| Sub      | Tema                                                       | Files (estimado)                                           | Deliverable                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F.0**  | Pre-condiciones (docs)                                     | 3 docs                                                     | ADR + spec + plan (este file). Commit "docs(rich-text): plan + ADR + spec migración TipTap → Lexical"                                                                                                                                                                 |
| **F.1**  | Cleanup TipTap UI + extensions                             | 12 deletes + 1 modificación                                | Drop UI editores + embeds nodes TipTap. Public exports temp como stubs. Commit "refactor(tiptap): drop UI components + extensions"                                                                                                                                    |
| **F.1b** | Cleanup TipTap domain + actions + tests + deps + DDL       | 14 modificaciones + 6 deletes + 1 migration + package.json | Drop domain types/schemas/invariants/size/snapshot. Drop calls en server actions. Drop tests rich-text. Drop deps. Migration TRUNCATE+DROP+ADD columns. Commit "refactor(tiptap): drop domain + DDL truncate columns"                                                 |
| **F.2**  | Lexical foundation (slice rich-text domain)                | 6 nuevos + tests                                           | Nuevo slice `src/features/rich-text/` con `domain/types.ts`, `domain/schemas.ts`, `domain/size.ts`, `domain/snapshot.ts`, `public.ts`, `public.server.ts`. TDD. Commit "feat(rich-text): foundation domain types + schemas + size + snapshot"                         |
| **F.3**  | Composer base + comment surface piloto                     | 5 nuevos + 2 modificaciones                                | `BaseComposer` configurable + `RichTextRenderer` SSR + integración en `comment-composer` + page. TDD. Commit "feat(rich-text): base composer + renderer + comment surface"                                                                                            |
| **F.4**  | Surfaces post + event + library + plugins embeds + mention | 12 nuevos + 4 modificaciones                               | Post composer (text+heading+bold+lists+link+mention+embeds). Event composer (text+link+mention). Library item composer. 4 DecoratorNodes embeds. MentionNode polimórfico. Commit "feat(rich-text): post + event + library composers + 4 embeds + polymorphic mention" |
| **F.5**  | Feature flags por place + UI settings                      | 1 migration + 6 nuevos                                     | `Place.editorPluginsConfig` columna + slice `editor-config/` + page `/settings/editor`. CSP `frame-src` actualizado. Commit "feat(editor-config): per-place plugin toggles + settings page"                                                                           |
| **F.6**  | Verificación final                                         | grep + manual smoke                                        | Typecheck + lint + tests + build verde. Grep zero residuos TipTap. Plan + ADR cerrados. Commit "chore(tiptap): verificación final, plan + ADR cerrados"                                                                                                               |

## F.1 — Cleanup TipTap (UI + extensions)

### Files a eliminar

- `src/features/discussions/ui/rich-text-editor.tsx`
- `src/features/discussions/ui/rich-text-renderer.tsx`
- `src/features/discussions/editor/ui/rich-text-editor.tsx`
- `src/features/discussions/editor/ui/rich-text-renderer.tsx`
- `src/features/discussions/ui/post-composer.tsx`
- `src/features/discussions/ui/comment-composer.tsx`
- `src/features/discussions/comments/ui/comment-composer.tsx`
- `src/features/discussions/editor/ui/post-composer.tsx`
- `src/features/discussions/editor/ui/edit-window-form.tsx`
- `src/features/discussions/editor/ui/edit-window-types.ts`
- `src/features/library/ui/library-item-editor.tsx`
- `src/features/library/items/ui/library-item-editor.tsx`
- `src/features/library/ui/embed-node/` (carpeta completa: extension.ts + node-view.tsx + embed-toolbar.tsx)
- `src/features/library/embeds/ui/embed-node/` (idem dual location)
- `src/features/library/ui/embed-toolbar.tsx`
- `src/features/library/embeds/ui/embed-toolbar.tsx`

### Files a modificar (drop exports/imports)

- `src/features/discussions/public.ts`: drop `PostComposer`, `RichTextRenderer`, `RichTextEditor` exports. Stub temporal con `// TODO F.3: re-exportar desde rich-text slice`.
- `src/features/discussions/comments/public.ts` (si existe): idem.
- `src/features/discussions/editor/public.ts`: idem.
- `src/features/library/public.ts`: drop `LibraryItemEditor` export.
- `src/features/library/items/public.ts`: idem.

### Pages que rompen temporalmente

(Se restauran en F.3-F.4 con composers Lexical.)

- `src/app/[placeSlug]/(gated)/conversations/new/page.tsx` — usa `PostComposer`.
- `src/app/[placeSlug]/(gated)/conversations/[postSlug]/_comments-section.tsx` — usa `CommentComposer`.
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/_comments-section.tsx` — idem.
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/edit/page.tsx` (si existe) — usa `LibraryItemEditor`.
- `src/app/[placeSlug]/settings/library/[categorySlug]/items/[itemId]/edit/page.tsx` — idem.
- `src/app/[placeSlug]/(gated)/events/new/page.tsx` (o similar) — usa editor para `description`.
- `src/app/[placeSlug]/(gated)/events/[slug]/edit/page.tsx` — idem.

**Estrategia**: en F.1 estos pages se modifican para mostrar un placeholder `<div>Editor temporalmente deshabilitado — F.3 lo restaura</div>` o se comentan. La app sigue navegable (lectura funciona si el body es null o se muestra "Sin contenido"). En F.3-F.4 se restauran con composers Lexical.

### Gate post-F.1

- `pnpm typecheck` verde.
- `pnpm lint` verde.
- `pnpm build` verde.
- `pnpm test --run`: pueden quedar tests rotos del rich-text que se eliminan en F.1b (acepable; F.1 no se commitea solo, F.1+F.1b van juntos).

## F.1b — Cleanup TipTap (domain + actions + tests + deps + DDL)

### Files a eliminar

- `src/features/discussions/domain/types.ts` (sólo bloque `RichText*`; conserva `Post`, `Comment`, etc.)
- `src/features/discussions/domain/rich-text.ts`
- `src/features/discussions/domain/rich-text-schemas.ts`
- `src/features/discussions/rich-text/` (carpeta completa: **tests**, domain, public.ts)
- `src/features/discussions/__tests__/rich-text-schema.test.ts`
- `src/features/discussions/__tests__/rich-text.test.ts`
- `src/features/discussions/__tests__/rich-text-renderer.test.tsx`
- `src/features/discussions/__tests__/quote-snapshot.test.ts`
- `src/features/discussions/comments/__tests__/quote-snapshot.test.ts`
- `src/features/discussions/editor/__tests__/rich-text-renderer.test.tsx`

### Files a modificar (drop calls + types)

- `src/features/discussions/domain/invariants.ts`: drop `buildQuoteSnapshot`. Funciones `assertCommentAlive`, etc. quedan.
- `src/features/discussions/domain/errors.ts`: drop `RichTextTooLarge`.
- `src/features/discussions/schemas.ts`: drop `body: richTextDocumentSchema`. Reemplazar por `body: jsonStub` temporal (Zod `z.unknown()`) que F.3 tipará a `LexicalDocument`.
- `src/features/discussions/public.ts`: drop re-exports rich-text.
- `src/features/discussions/posts/server/actions/{create,edit,create-from-system}.ts`: drop `assertRichTextSize` calls.
- `src/features/discussions/comments/server/actions/{create,edit}.ts`: drop `assertRichTextSize` + `buildQuoteSnapshot` calls.
- `src/features/discussions/server/actions/{posts,comments}/{create,edit}.ts`: idem (legacy paths).
- `src/features/discussions/server/queries.ts`: tipo `CommentView.body` pasa a `unknown` temporal.
- `src/features/discussions/comments/server/queries/comments.ts`: idem.
- `src/features/discussions/posts/server/queries/posts.ts`: idem.
- `src/features/library/schemas.ts`: drop `richTextDocumentSchema`. Reemplazar `body` por `z.unknown()` temporal.
- `src/features/library/items/server/actions/update-item.ts`: drop `assertRichTextSize`.
- `src/features/events/schemas.ts`: drop `richTextDocumentSchema`. Reemplazar `description` por `z.unknown()` temporal.
- `src/features/events/server/actions/{create,update}.ts`: drop `assertRichTextSize`.
- `src/features/events/editor/server/actions/{create,update}.ts`: idem.

### Deps a desinstalar

```
pnpm remove @tiptap/core @tiptap/extension-link @tiptap/extension-mention \
            @tiptap/react @tiptap/starter-kit frimousse
```

`next.config.ts`: drop entries de `optimizePackageImports` para `@tiptap/react`, `@tiptap/starter-kit`. Agregar `lexical`, `@lexical/react`, `@lexical/list`, `@lexical/link`, `@lexical/rich-text` (anticipo F.2).

### Migration nueva

`prisma/migrations/<ts>_drop_rich_text_columns/migration.sql`:

```sql
-- Truncate filas (datos descartables — pre-prod).
TRUNCATE "Comment", "Post", "Event", "LibraryItem", "PostRead", "Reaction", "PostFlag", "CommentFlag" CASCADE;

-- Drop & recreate columnas JSON con shape Lexical.
ALTER TABLE "Post" DROP COLUMN "body";
ALTER TABLE "Post" ADD COLUMN "body" JSONB;

ALTER TABLE "Comment" DROP COLUMN "body";
ALTER TABLE "Comment" ADD COLUMN "body" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Comment" DROP COLUMN "quotedSnapshot";
ALTER TABLE "Comment" ADD COLUMN "quotedSnapshot" JSONB;

ALTER TABLE "Event" DROP COLUMN "description";
ALTER TABLE "Event" ADD COLUMN "description" JSONB;
```

`prisma/schema.prisma`: actualizar tipos a `Json` o `Json?` según corresponda; el shape Zod se vuelve a apretar en F.2 desde el slice `rich-text`.

### Gate post-F.1b

- `pnpm typecheck` verde.
- `pnpm lint` verde.
- `pnpm test --run` verde (los tests rich-text fueron deleted; los tests que mockean `assertRichTextSize` también).
- `pnpm build` verde.
- `pnpm prisma migrate deploy` aplica la migration al cloud dev sin error.
- Grep parcial: `grep -rn "@tiptap\|frimousse" src/ tests/ package.json` = 0 hits.

### Commit F.1+F.1b atómico

Sí — F.1 sin F.1b deja el código en estado roto (tests del rich-text pasan a fallar porque importan domain types que no existen tras F.1b). Estrategia: F.1+F.1b se aplican y commitean como una sola unidad lógica. Dos commits separados sólo si cada uno deja la suite verde — si no, commit único.

## F.2 — Lexical foundation

### Deps a instalar

```
pnpm add lexical @lexical/react @lexical/list @lexical/link @lexical/rich-text
         @lexical/utils @lexical/selection @lexical/clipboard
```

### Files nuevos

- `src/features/rich-text/domain/types.ts` (~150 LOC):
  - `LexicalDocument`, `RootNode`, `ParagraphNode`, `HeadingNode`, `ListNode`, `ListItemNode`, `LinkNode`, `TextNode`, `LineBreakNode`, `MentionNode`, `EmbedNode` (union de YouTube/Spotify/Apple/Ivoox).
- `src/features/rich-text/domain/schemas.ts` (~100 LOC):
  - Zod schema recursivo del AST. Por-surface: `commentDocumentSchema`, `postDocumentSchema`, `eventDocumentSchema`, `libraryItemDocumentSchema` (validan que los nodos del doc estén en el subset permitido para ese surface).
  - `richTextDocumentSchema` general (cualquier subset).
- `src/features/rich-text/domain/size.ts` (~40 LOC):
  - `assertRichTextSize(doc, cap = 20_480)`. Tira `RichTextTooLargeError` si `JSON.stringify(doc).length > cap`.
- `src/features/rich-text/domain/snapshot.ts` (~60 LOC):
  - `buildQuoteSnapshot({ comment, sourceLabel })` reescrito. Toma un comment con `body: LexicalDocument` + label del autor + label fuente; retorna `{ excerpt: string, authorLabel, sourceLabel }` (mismo shape que antes — el JSON column lo absorbe).
- `src/features/rich-text/domain/excerpt.ts` (~30 LOC):
  - `richTextExcerpt(doc, maxChars = 280)`. Visitor que extrae solo texto.
- `src/features/rich-text/public.ts`:
  - Exports: tipos + `assertRichTextSize` + `buildQuoteSnapshot` + `richTextExcerpt` + schemas Zod.
- `src/features/rich-text/public.server.ts`:
  - Vacío por ahora (placeholder con `import 'server-only'` para alineación con el patrón del repo).

### Tests nuevos (TDD)

- `src/features/rich-text/__tests__/schema.test.ts` (~80 LOC): 15+ casos válidos/inválidos.
- `src/features/rich-text/__tests__/size.test.ts` (~30 LOC): cap pasa, cap excede, depth.
- `src/features/rich-text/__tests__/snapshot.test.ts` (~40 LOC): excerpt + author + source.
- `src/features/rich-text/__tests__/excerpt.test.ts` (~30 LOC): nested lists, mentions, embeds → solo texto.

### Gate post-F.2

- `pnpm typecheck` verde.
- `pnpm test --run` verde con los nuevos tests.
- Slice cap: ≤500 LOC (más tests). Verificar con `wc -l src/features/rich-text/domain/*.ts src/features/rich-text/*.ts`.

### Volver a apretar tipos en consumers

- `discussions/schemas.ts`: `body: richTextDocumentSchema.optional().nullable()` (vuelve a Zod estricto).
- `library/schemas.ts`: idem `body`.
- `events/schemas.ts`: idem `description`.
- `discussions/comments/server/actions/{create,edit}.ts`: re-introduce `assertRichTextSize(data.body)` y `buildQuoteSnapshot(...)`.
- `discussions/posts/server/actions/{create,edit,create-from-system}.ts`: `assertRichTextSize(data.body)`.
- `library/items/server/actions/update-item.ts`: `assertRichTextSize(data.body)`.
- `events/server/actions/{create,update}.ts` + `events/editor/server/actions/{create,update}.ts`: `assertRichTextSize(data.description)`.

## F.3 — Composer base + comment surface piloto

### Files nuevos

- `src/features/rich-text/ui/base-composer.tsx` (~100 LOC):
  - Wrapper `'use client'` de `<LexicalComposer>`. Recibe props: `nodes: ReadonlyArray<LexicalNodeKey>`, `plugins: ReadonlyArray<PluginKey>`, `placeholder`, `onChange(doc: LexicalDocument)`, `initialDocument?`.
  - Mapping `nodes` → array de clases de Lexical (lookup table interna).
  - Plugins React renderizados condicionalmente.
- `src/features/rich-text/ui/renderer.tsx` (~150 LOC):
  - Server Component. Visitor `renderRoot` → JSX. Recibe `document` + `resolvers` (mention).
  - Manejo de cada tipo de nodo + fallbacks defensivos para `kind: 'event' | 'library-item' | 'user'`.
- `src/features/rich-text/ui/comment-composer.tsx` (~80 LOC):
  - Wrapper sobre `BaseComposer` con surface = comment. Hardcoded `nodes = ['paragraph', 'text', 'link', 'mention']`. Plugins: `<MentionPlugin />`, `<LinkPlugin />`, `<HistoryPlugin />`.
  - Form orchestrator: maneja submit, calls server action.
- `src/features/rich-text/ui/mentions/mention-plugin.tsx` (~150 LOC):
  - Plugin React que escucha keystrokes en el editor. Detecta triggers `@`, `/event`, `/library`. Renderiza popover con resultados. Inserta `MentionNode` al confirmar.
  - Esta versión cubre solo `@user` para F.3. `/event` y `/library/<cat>/<item>` se completan en F.4.
- `src/features/rich-text/ui/mentions/mention-node.ts` (~80 LOC):
  - `class MentionNode extends DecoratorNode<ReactNode>`. Serialization, deserialization, `decorate()` retorna React component clickable.

### Files modificados

- `src/app/[placeSlug]/(gated)/conversations/[postSlug]/_comments-section.tsx`: importa `<CommentComposer>` de `@/features/rich-text/public`.
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/_comments-section.tsx`: idem.
- (Otros pages que muestran lectura ya pueden importar `<RichTextRenderer>` de `@/features/rich-text/public` para renderizar `Comment.body` y `Post.body` aunque el composer del post se complete en F.4.)

### Tests TDD

- `src/features/rich-text/__tests__/renderer.test.tsx` (~80 LOC): SSR shapes válidos + fallback de mention sin target.
- `src/features/rich-text/__tests__/comment-composer.test.tsx` (~50 LOC): smoke render + onChange dispatch.

### Gate post-F.3

- `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` verde.
- Smoke manual en dev: navegar a `/[placeSlug]/conversations/[postSlug]`, agregar un comment con texto + `@user` mention. Observar que se persiste y re-renderiza correctamente al refresh.

## F.4 — Surfaces post + event + library + plugins embeds + mention extendido

### Files nuevos

#### Composers

- `src/features/rich-text/ui/post-composer.tsx` (~120 LOC).
- `src/features/rich-text/ui/event-composer.tsx` (~80 LOC).
- `src/features/rich-text/ui/library-item-composer.tsx` (~120 LOC).

Cada uno wrappea `BaseComposer` con su `nodes` array + plugins corresppondientes. Lee `editorPluginsConfig` del place (server action proxy) para decidir qué embeds incluir.

#### Plugins de embed

- `src/features/rich-text/plugins/youtube/youtube-node.ts` (~80 LOC): DecoratorNode + iframe + parser URL.
- `src/features/rich-text/plugins/youtube/youtube-plugin.tsx` (~50 LOC): React plugin con botón + handler de paste.
- `src/features/rich-text/plugins/youtube/parse-url.ts` (~30 LOC).
- `src/features/rich-text/plugins/youtube/__tests__/parse-url.test.ts` (~30 LOC).

(Mismo trío × 4 plugins: spotify, apple-podcast, ivoox.)

Total embeds: ~12 nuevos files + 4 tests = ~640 LOC.

#### Mention extendido

- `src/features/rich-text/ui/mentions/mention-plugin.tsx`: extender con triggers `/event` + `/library`. Two-step para library.
- `src/features/rich-text/ui/mentions/resolvers.ts` (~50 LOC): cliente-side autocomplete consultando server actions de `events/public.server` + `library/public.server`.
- Server actions nuevas (consumidas por el plugin):
  - `src/features/events/public.server.ts`: `searchEventsByPlace(placeId, q)`.
  - `src/features/library/public.server.ts`: `listCategoriesForMention(placeId)`, `searchLibraryItems(placeId, categorySlug, q)`.
  - Cada una cacheada con `unstable_cache` + tag `place-search:{placeId}`.

### Files modificados

- `src/app/[placeSlug]/(gated)/conversations/new/page.tsx`: importa `<PostComposer>`.
- `src/app/[placeSlug]/(gated)/events/new/page.tsx` (o equivalente): importa `<EventComposer>`.
- `src/app/[placeSlug]/(gated)/events/[slug]/edit/page.tsx`: idem.
- `src/app/[placeSlug]/settings/library/[categorySlug]/items/[itemId]/edit/page.tsx`: importa `<LibraryItemComposer>`.
- `src/features/discussions/public.ts`: re-exporta tipos de `rich-text/public` para backward-compat con consumers que importaban tipos del barrel `discussions`.

### Tests TDD

- `src/features/rich-text/plugins/<each>/__tests__/parse-url.test.ts` × 4: ~24 cases.
- `src/features/rich-text/__tests__/post-composer.test.tsx`: smoke.
- `src/features/rich-text/__tests__/library-item-composer.test.tsx`: smoke.

### Gate post-F.4

- `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` verde.
- E2E manual: crear un post con YouTube + `@user` + `/event`; crear un library item con embed Spotify; crear un evento con `/library/<cat>/<item>` mention.

## F.5 — Feature flags por place + UI settings/editor

### Migration

`prisma/migrations/<ts>_place_editor_plugins_config/migration.sql`:

```sql
ALTER TABLE "Place" ADD COLUMN "editorPluginsConfig" JSONB
  NOT NULL
  DEFAULT '{"youtube":true,"spotify":true,"applePodcasts":true,"ivoox":true}';
```

`prisma/schema.prisma`: agregar campo a model `Place`.

### Slice nuevo

- `src/features/editor-config/domain/types.ts` (~30 LOC): `EditorPluginsConfig` type.
- `src/features/editor-config/domain/schemas.ts` (~25 LOC): `editorPluginsConfigSchema` Zod.
- `src/features/editor-config/server/queries.ts` (~50 LOC): `getEditorConfigForPlace(placeId)` con `unstable_cache` tag `editor-config:{placeId}` revalidate 60s.
- `src/features/editor-config/server/actions.ts` (~80 LOC): `updateEditorConfig({ placeId, config })`. Owner-only. Invalida tag.
- `src/features/editor-config/ui/editor-config-form.tsx` (~150 LOC): form orchestrator (RHF) con toggles + Save + soft barrier (autosave individual con `commitOrDefer`).
- `src/features/editor-config/public.ts` + `public.server.ts`.

### Page

- `src/app/[placeSlug]/settings/editor/page.tsx` (~80 LOC):
  - Page padding standard, `<PageHeader>`, sección única, lista de toggles.
  - Server-side: lee `editorPluginsConfig` del place, gate owner-only.
  - Client-side: `<EditorConfigForm>` recibe initial.

### CSP update

`next.config.ts`: extender `frame-src`:

```ts
'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://docs.google.com https://open.spotify.com https://embed.podcasts.apple.com https://www.ivoox.com'
```

### Tests TDD

- `src/features/editor-config/__tests__/{schema,queries,actions}.test.ts`: ~120 LOC.

### Gate post-F.5

- `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build` verde.
- Smoke manual: como owner, abrir `/settings/editor`, desactivar Ivoox, guardar. Crear nuevo post → composer no ofrece toggle Ivoox. Crear post como member regular → no ve la opción settings/editor (404).

## F.6 — Verificación final

### Gates de cero residuos

```bash
grep -rn "@tiptap\|frimousse" src/ tests/ package.json pnpm-lock.yaml docs/  # 0 hits no-historicos
grep -rn "RichTextDocument\|RichTextBlockNode\|RichTextInlineNode" src/  # 0 hits — tipos viven en rich-text/ ahora
```

(Los hits en docs/decisions/ y docs/plans/ históricos son aceptables.)

### Suite completa

- `pnpm typecheck && pnpm lint && pnpm test --run && pnpm test:rls && pnpm build` verde.
- E2E manual de los 5 escenarios listados en el ADR.

### Cleanup docs

- ADR + plan marcados como ejecutados (sección "Estado: ✅ ejecutado 2026-05-XX").
- Spec `docs/features/rich-text/spec.md` queda como living doc.
- `docs/features/discussions/spec.md` § rich-text actualizado: pointer al nuevo spec, drop de la sección TipTap.
- `docs/decisions/2026-04-20-discussions-size-exception.md`: nota agregada — el cap 20 KB se mantiene; el AST cambia.
- `docs/decisions/2026-04-25-events-size-exception.md`: idem.
- `docs/roadmap.md`: drop mención TipTap.

## Riesgos + mitigaciones

| Riesgo                                                                                      | Severity | Mitigación                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drop de columnas es DDL irreversible**. Si el migration falla a la mitad, datos perdidos. | 🔴       | Pre-prod, datos descartables. Snapshot del DB cloud dev pre-deploy (Supabase PITR si está activo, si no `pg_dump`). Migration tiene TRUNCATE + DDL en una sola transacción Postgres (atomic).           |
| Lexical AST no soporta algún caso del modelo TipTap migrado.                                | 🟡       | Drop & rebuild: no migramos data. Empezamos limpio sobre Lexical canónico.                                                                                                                              |
| Boundary violation: `rich-text` importa de `members/events/library`.                        | 🟠       | Patrón resolver-injected: el slice expone `MentionResolvers` interface; cada page consumer construye los resolvers importando de los slices. `rich-text` queda agnóstico. ESLint guard si es necesario. |
| Slice `rich-text` supera cap 1500 LOC.                                                      | 🟠       | Estimación inicial ~1620 LOC. Si supera, split en `rich-text/embeds/` como sub-slice (precedente: `discussions/flags`). ADR de excepción si es necesario.                                               |
| Plugins embed mantenidos in-house se desactualizan vs cambios del provider.                 | 🟡       | URL pattern de cada provider es estable (Spotify/Apple/Ivoox/YouTube no rompen embeds). Si rompen, el placeholder `[CONTENIDO NO DISPONIBLE]` aplica defensivamente.                                    |
| F.1 deja la app temporalmente con composers rotos.                                          | 🟢       | F.1 + F.1b se commitean atómico. F.3 restaura comment composer. F.4 restaura post/event/library. Período "roto" = la duración entre commits, no afecta a usuarios (pre-prod).                           |
| Cache de `editorPluginsConfig` da config viejo después de update.                           | 🟠       | Server action `updateEditorConfig` invalida `revalidateTag('editor-config:{placeId}')` post-commit. TTL 60s como fallback. Mismo patrón que Sesión 2.3.                                                 |
| CSP `frame-src` no actualizado en prod → embeds bloqueados.                                 | 🟢       | F.5 actualiza `next.config.ts`. Verificar en build local que CSP header tiene los 4 hosts. Smoke en prod post-deploy.                                                                                   |
| Algún consumer de `MembershipRole` o tipos viejos rompe en F.4.                             | 🟢       | No tocamos members/groups en este plan. F.4 sólo agrega imports nuevos a `rich-text`. Tests existentes se preservan.                                                                                    |

## Verificación

### Por sub-fase

Ver "Gate post-F.X" en cada sección.

### Final (F.6)

- All-green: typecheck + lint + test + RLS + build.
- Cero hits: grep `@tiptap\|frimousse\|RichTextDocument`.
- E2E manual 5 escenarios.
- ADR + spec + plan referenciados desde commits.

## Alineación con CLAUDE.md y architecture.md

- ✅ **Vertical slices**: `rich-text/` es un slice nuevo autocontenido. `editor-config/` también. No mezclan.
- ✅ **Boundaries**: `rich-text/` no importa de otros slices. `members/events/library` se inyectan vía resolvers.
- ✅ **Spec antes de código**: `docs/features/rich-text/spec.md` existe antes de F.2.
- ✅ **TDD**: cada sub-fase de implementación arranca con tests.
- ✅ **Caps de tamaño**: archivos ≤300 LOC, slice ≤1500 LOC (con margen para split si necesario).
- ✅ **Ejecución secuencial**: sin agentes paralelos, commits intermedios recuperables (petición explícita del user).
- ✅ **Idioma**: comments + UI labels en español, código en inglés.
- ✅ **Tipos estrictos**: post-cleanup, sin `any` ni `z.unknown` permanente. Stubs `z.unknown()` durante F.1b son temporales (re-apretados en F.2).
- ✅ **Server Components default**: composers son `'use client'` (necesitan editor interactivo); renderer es Server Component.
- ✅ **Sin métricas vanidosas, sin gamificación, sin urgencia artificial**: el editor es calmo (cozytech).
- ✅ **Production-minded**: drop & recreate columns en lugar de truncate-only; ADR documenta irreversibilidad; CSP actualizado; cache invalidation explícita.

## Próximo paso

F.0 cerrada con este commit. Siguiente: F.1 cleanup TipTap UI + extensions.
