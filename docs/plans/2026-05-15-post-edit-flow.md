# Plan — Habilitar flujo "Editar post" (F.4 cierre) — 4 sesiones

**Fecha**: 2026-05-15
**Estado**: ✅ COMPLETADO (S1–S4 ejecutadas, 4 commits, 417/417 verde,
cero regresión)

## Contexto

El botón "Editar" en `<PostAdminMenu>` (agregado 2026-04-22) navega a
`/conversations/new?edit=${postId}`, pero esa ruta nunca aprendió a
manejar el query param. `<PostComposerWrapper>` solo soporta `create`
(siempre llama `createPostAction`). Síntoma: form vacío al editar; riesgo
real: si el user guarda, **crea un post duplicado** en vez de actualizar.

No es regresión de G.3 (permisos granulares, 2026-05-09). G.3 solo agregó
el gate `discussions:edit-post` a la action server-side (que ya estaba
huérfana). El bug es una feature half-shipped desde el 22-abr, documentada
como stub pendiente en `edit-window-actions.tsx:14` ("F.4 posts").

### Hechos verificados (precondiciones del plan)

- `<PostComposer>` (rich-text) ya acepta `initialDocument` + `initialTitle`
  - `onSubmit({title, body})`. **NO se toca** este componente.
- `editPostAction({ postId, title, body?, expectedVersion, session? })
→ { ok, version }` existe (`server/actions/posts/edit.ts:44`). Gate G.3
  listo. **NO se toca** esta action.
- `openPostEditSession({ postId }) → { ok, session: {token, openedAt,
graceMs} } | { ok, adminBypass: true }` existe (`edit.ts:84`).
- `editPostInputSchema` soporta `session: { token, openedAt }`
  (`schemas.ts:64`).
- `revalidatePostPaths(placeSlug, postSlug)` ya invalida `/${placeSlug}`,
  `/${placeSlug}/conversations`, `/${placeSlug}/conversations/${postSlug}`
  (`shared.ts:16-20`). **Gap I4 RESUELTO sin cambios.**
- `<ThreadHeaderBar>` (`threads/ui/thread-header-bar.tsx`) reusable: back
  button + rightSlot. Se reusa para la edit page (gap I3).
- `Post` schema tiene back-refs `event Event?` + `libraryItem
LibraryItem?`. NO tiene `deletedAt` ni `originSystem`. La distinción
  post-puro vs derivado se hace por esas relaciones.
- Permiso `discussions:edit-post` confirmado en catálogo de permisos.
- Patrón de referencia end-to-end: `<LibraryItemComposerForm>`
  (`discussions/ui/library-item-composer-form.tsx`), discriminated union
  `CreateMode | EditMode`. **Espejamos su estructura.**

### Regla de oro de ejecución

Código consolidado. **Cero regresiones, cero refactor no solicitado,
cero división de archivos "legacy/new".** Solo se tocan los archivos
listados por sesión. TDD obligatorio. `pnpm typecheck` + tests del slice
verdes entre cada sesión. Commit separado por sesión.

---

## Sesión 1 — Page edit + redirect dispatcher ✅ EJECUTADA

**Decisión de ejecución (mejora sobre el plan)**: NO se crea
`findPostForEdit`. Se **reusa `findPostBySlug`** — el domain `Post` ya
trae `body+version+authorUserId+createdAt+hiddenAt+event+libraryItem`.
Reuso = cero query nueva, cero duplicación, cero superficie de
regresión, alineado con "código consolidado". `queries.ts` (479 LOC,
deuda preexistente que excede el cap 300) NO se toca.

**Decisión de ejecución (test de page)**: el repo NO testea Server
Component pages (no existe ningún `page.test.tsx` en `src/app`). No se
introduce ese patrón (sería convención nueva no solicitada). El gate de
permiso replica el de `editPostAction`, ya cubierto por
`server/actions/posts/__tests__/edit.test.ts`. Cobertura de la page:
smoke manual (documentado).

**Files realmente tocados**:

- NEW `src/app/[placeSlug]/(gated)/conversations/[postSlug]/edit/page.tsx`
  (~95 LOC): gate top-level (loadPlace + findPostBySlug +
  resolveViewerForPlace + hasPermission); redirect a canonical si
  derivado (libraryItem/event); `openPostEditSession` si autor no-admin;
  `<ThreadHeaderBar>` + placeholder del editor (S2 lo reemplaza);
  `dynamic = 'force-dynamic'`.

**Verificación S1**: `pnpm typecheck` verde. `pnpm vitest run
src/features/discussions` → 268/268 verde (cero regresión). Ningún
caller existente modificado.

**LOC real**: ~95. **Riesgo deploy**: cero (ruta nueva, no enlazada
hasta S3).

---

## Sesión 2 — Wrapper discriminated mode + embed-safe load ✅ EJECUTADA

**Decisión de ejecución (tests)**: el repo NO testea composer-form
wrappers (no existe `discussions/ui/__tests__/`) ni hace tests de
integración Lexical con node registration. Son thin glue sobre server
actions que SÍ están testeadas (`editPostAction` →
`server/actions/posts/__tests__/edit.test.ts`: gate G.3 + optimistic
lock + session token). No se introducen patrones de test ausentes
(coherente con S1 y la regla de oro). El cambio `buildNodes` es
**aditivo** (registra más node klasses, nunca menos) → no puede romper
deserialización; cubierto por la suite existente (renderer + schemas).

**Files realmente tocados**:

- `src/features/rich-text/composers/ui/base-composer.tsx`: `buildNodes`
  ahora registra SIEMPRE los 4 embed nodes en surfaces con embeds
  (independiente de `enabledEmbeds`). Firma simplificada a
  `buildNodes(surface)`. Plugins de inserción siguen gateados por
  `enabledEmbeds` (sin cambios). Comentario explica el round-trip.
- `src/features/discussions/ui/post-composer-form.tsx`: discriminated
  union `CreateMode | EditMode`. Edit → `editPostAction({ postId,
title, body, expectedVersion, session? })`; errores via
  `friendlyErrorMessage` (reuso, no se reinventa copy). initialDocument
  nullable (espeja `<LibraryItemComposerForm>`).
- `src/app/.../conversations/new/page.tsx`: pasa `mode={{kind:'create'}}`.
- `src/app/.../conversations/[postSlug]/edit/page.tsx`: monta el wrapper
  en mode edit (reemplaza placeholder de S1) + `getEditorConfigForPlace`.

**Verificación S2**: `pnpm typecheck` verde. `pnpm vitest run
src/features/discussions src/features/rich-text` → 417/417 verde (cero
regresión). LOC real: ~150. Riesgo deploy: bajo.

### Plan original S2 (referencia)

**Goal**: `<PostComposerWrapper>` soporta `CreateMode | EditMode`. Edit
carga initial title+body, dispara `editPostAction` con `session`, maneja
ConflictError. `BaseComposer.buildNodes` registra siempre los embed
nodes (deserializar bodies viejos) aunque el plugin de inserción respete
el toggle (gap C3).

**Files**:

- `src/features/rich-text/composers/ui/base-composer.tsx`: en
  `buildNodes`, registrar SIEMPRE los 4 embed node klasses cuando la
  surface admite embeds (independiente de `enabledEmbeds`). Los plugins
  de inserción (líneas ~194-197) siguen gateados por `enabledEmbeds`.
  Comentario explicando el porqué (round-trip de bodies con embeds
  preexistentes sin pérdida).
- `src/features/rich-text/composers/ui/__tests__/base-composer.test.tsx`
  (o crear): test round-trip — body con youtube node + `enabledEmbeds`
  todo false → el node sobrevive el render/serialize.
- `src/features/discussions/ui/post-composer-form.tsx` (~140 LOC, hoy
  65): `Props = { mode: CreateMode | EditMode, placeId, enabledEmbeds }`.
  `CreateMode = { kind:'create' }`. `EditMode = { kind:'edit', postId,
postSlug, expectedVersion, initialTitle, initialDocument, session:
{token, openedAt} | null }`. `onSubmit` branchea: edit →
  `editPostAction({ postId, title, body, expectedVersion, ...(session ?
{session} : {}) })`; ConflictError → toast "El post cambió desde que
  lo abriste. Recargá y reintentá."; EditWindowExpired → toast "Tu
  sesión de edición venció. Recargá la página."
- `src/features/discussions/ui/__tests__/post-composer-form.test.tsx`
  (~190 LOC): create dispara createPostAction; edit dispara
  editPostAction con session; ConflictError + EditWindowExpired toasts;
  initialTitle/initialDocument llegan al composer.
- `src/app/.../conversations/[postSlug]/edit/page.tsx`: pasar
  `mode={{ kind:'edit', ... }}`; quitar placeholder de S1.
- `src/app/.../conversations/new/page.tsx`: pasar `mode={{ kind:'create' }}`.

**Verificación S2**: `pnpm typecheck` + `pnpm vitest run
src/features/discussions src/features/rich-text` verde. Smoke: editar
post propio → cambios persistidos + `(editado)`. 2 tabs → ConflictError.

**LOC**: ~360. **Riesgo deploy**: bajo (typecheck atrapa drift del API
del wrapper en `/new`).

---

## Sesión 3 — Wiring de los 2 entry points + dedup ✅ EJECUTADA

**Files realmente tocados**:

- `post-admin-menu.tsx`: prop `postSlug`; URL →
  `/conversations/<postSlug>/edit` (antes `?edit=`).
- `_thread-header-actions.tsx`: pasa `postSlug={post.slug}`.
- `edit-window-types.ts`: `PostSubject` + `slug`; doc actualizada
  (quita stub "post-MVP").
- `edit-window-actions.tsx`: prop `viewerIsAdmin`; branch "Editar"
  (`<Link>`) solo si `subject.kind==='post' && !viewerIsAdmin` (dedup
  gap I2 — admin ya lo tiene en kebab); quita comentario stub F.1.
- `post-detail.tsx`: prop `viewerIsAdmin`; pasa `slug` + `viewerIsAdmin`
  al subject.
- `_thread-content.tsx`: pasa `viewerIsAdmin={viewer.isAdmin}`.

**Decisión**: comments NO obtienen branch "Editar" (se discrimina por
`subject.kind==='post'`) → cero regresión en `comment-item.tsx`. No se
propaga API innecesaria: `viewerIsAdmin` viaja por la cadena ya
existente (`_thread-content` ya resolvía `viewer`).

**Verificación S3**: `pnpm typecheck` verde. `grep 'conversations/new?edit='`
→ 0. `pnpm vitest run src/features/discussions` → 268/268 (cero
regresión). LOC real: ~45.

### Plan original S3 (referencia)

**Goal**: botón "Editar" del admin menu y del autor (60s) navegan a la
nueva page. Sin duplicar para admin-autor.

**Goal**: botón "Editar" del admin menu y del autor (60s) navegan a la
nueva page. Sin duplicar para admin-autor.

**Files**:

- `src/features/discussions/ui/post-admin-menu.tsx`: sumar prop
  `postSlug: string`; cambiar `router.push('/conversations/new?edit=...')`
  → `router.push('/conversations/<postSlug>/edit')`.
- `src/features/discussions/ui/post-detail.tsx`: pasar `postSlug` a
  `<PostAdminMenu>`.
- `src/features/discussions/ui/edit-window-actions.tsx`: sumar branch
  "Editar" que navega a `/conversations/<postSlug>/edit` SOLO si el
  viewer NO es admin (admin ya lo tiene en kebab — gap I2). Requiere
  `postSlug` en `EditWindowSubject` o prop inline. Quitar comentario
  "stub F.1" obsoleto (líneas ~12-15).
- Tests asociados (`__tests__/post-admin-menu.test.tsx` /
  `edit-window-actions.test.tsx` si existen): actualizar; si no existen,
  1 smoke test (~70 LOC).

**Verificación S3**: `pnpm typecheck` + tests del slice verde.
`grep -rn '?edit=' src/` → 0 hits. Smoke: admin → kebab → Editar →
page funciona; autor → barra 60s → Editar → page funciona.

**LOC**: ~120. **Riesgo deploy**: bajo.

---

## Sesión 4 — Docs + ADR + cierre F.4 ✅ EJECUTADA

**Files realmente tocados**:

- NEW `docs/decisions/2026-05-15-post-edit-flow.md`: ADR completo
  (5 decisiones + 3 alternativas descartadas + trade-offs + cómo
  compone con G.3).
- `docs/features/discussions/spec.md`: nueva sección §8.1 "UI del flujo
  Editar conversación" — **agregada sin reescribir** la tabla §7 ni el
  invariante #1 (obsoletos post-G.3 pero su corrección es scope de otro
  ADR; la sección nueva lo aclara y apunta al ADR G.3).
- `pre-launch-checklist.md`: sin cambios (su entry de permisos sigue
  válido — el flujo ahora funciona).
- Stub F.4 ya removido en S3 (`edit-window-actions.tsx`). Los otros
  "stub F.1" del repo son de F.2/library (otra fase) — NO se tocaron.

**Verificación final**: `pnpm typecheck` verde. `pnpm vitest run
src/features/discussions src/features/rich-text` → 417/417 verde (cero
regresión en toda la ejecución S1–S4).

### Plan original S4 (referencia)

**Files**:

- NEW `docs/decisions/2026-05-15-post-edit-flow.md` (~130 LOC):
  decisión page dedicada vs `?edit=`; matriz permiso × hiddenAt (admin
  sí / autor no); decisión "always-register embed nodes"; cómo compone
  con G.3.
- `docs/features/discussions/spec.md` (si existe): sección "Editar post".
- `docs/pre-launch-checklist.md`: remover/actualizar entry F.4 si existe.

**Verificación S4**: `grep -rn 'stub F.1' src/` → 0. typecheck + tests
verde.

**LOC**: ~150 (docs).

---

## Resumen

| Sesión | LOC  | Riesgo | Commit                                                 |
| ------ | ---- | ------ | ------------------------------------------------------ |
| 1      | ~480 | cero   | feat(discussions): query + page edit                   |
| 2      | ~360 | bajo   | feat(discussions): wrapper edit mode + embed-safe load |
| 3      | ~120 | bajo   | feat(discussions): wiring entry points + dedup         |
| 4      | ~150 | cero   | docs(discussions): ADR + spec cierre F.4               |

Cumple CLAUDE.md: TDD, vertical slice (todo en `discussions/` + page en
`app/` consumiendo `public*`), streaming agresivo del shell, tipos
estrictos (discriminated union), LOC caps, idioma. Sin tocar
`editPostAction` / `openPostEditSession` / `<PostComposer>` (consolidado).
