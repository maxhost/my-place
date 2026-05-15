# Flujo "Editar conversación" — page dedicada + embed-safe load (cierre F.4)

**Fecha:** 2026-05-15
**Estado:** Aceptada
**Origen:** Bug reportado por el owner — al editar un thread ya creado el
form aparecía vacío. Diagnóstico + plan en
`docs/plans/2026-05-15-post-edit-flow.md`.

## Contexto

El botón "Editar" del kebab admin (`<PostAdminMenu>`, agregado
2026-04-22) navegaba a `/conversations/new?edit=${postId}`. Esa ruta
nunca aprendió a leer el query param: `<PostComposerWrapper>` solo
soportaba `create` y siempre llamaba `createPostAction`.

Síntomas:

- Form vacío al editar (el composer se montaba sin `initialDocument`).
- **Riesgo real**: si el user guardaba, se creaba un post **duplicado**
  en vez de actualizar el original.

No fue regresión de G.3 (permisos granulares, 2026-05-09). G.3 solo
agregó el gate `discussions:edit-post` a `editPostAction` server-side
(que ya estaba huérfana — ningún caller UI la invocaba). El bug es una
feature half-shipped desde el 22-abr, documentada como stub pendiente
en `edit-window-actions.tsx` ("F.4 posts").

`editPostAction` + `openPostEditSession` ya existían y estaban testeadas
(optimistic lock por `version`, session token HMAC con grace de 5min,
gate G.3). Faltaba exclusivamente la capa UI consumer.

## Decisión

### 1. Page dedicada `/conversations/[postSlug]/edit`

Ruta propia (no reusar `/conversations/new?edit=`). Razones:

- Coherencia con el patrón ya canónico de library
  (`/library/[cat]/[item]/edit/page.tsx`).
- El gate de permiso vive en SSR top-level: `notFound()` / `redirect()`
  antes de pintar el shell. Mostrar el editor a quien no puede editar
  sería incorrecto.
- URL semántica (`?edit=` es smell).
- Reusa `findPostBySlug` (el domain `Post` ya trae
  body+version+author+hidden+refs) — **sin query nueva, sin tocar
  `queries.ts`** (479 LOC, deuda preexistente que no se empeora).

### 2. Posts derivados redirigen a su editor canónico

Si el `Post` tiene back-ref `libraryItem` o `event`, la page emite
`permanentRedirect` a `/library/<cat>/<slug>/edit` o
`/events/<id>/edit`. Editar un post derivado como "post crudo"
perdería el contexto del wrapper específico (cover/categoría/prereq o
fecha/RSVP). La distinción se hace por las relaciones inversas (el
schema `Post` no tiene `originSystem`).

### 3. Matriz permiso × `hiddenAt`

- **Admin / owner / grupo con `discussions:edit-post`**: edita siempre,
  sin límite de ventana, aunque el post esté oculto (es quien modera).
- **Autor sin permiso**: edita solo dentro de la ventana 60s **y** si
  el post NO está oculto (post oculto = removido visualmente; el autor
  no debería seguir tocándolo). Se abre `openPostEditSession` para el
  grace de 5min (mismo patrón que comments).
- **Cualquier otro**: `notFound()`.

Defensa en profundidad: la page replica el gate que `editPostAction`
ya enforce server-side (no se duplica la lógica — se importan los
mismos building blocks `resolveViewerForPlace` + `hasPermission`).

### 4. `buildNodes` registra siempre los embed nodes

`BaseComposer.buildNodes` ahora registra los 4 embed node klasses en
toda surface que admite embeds, **independiente del toggle
`enabledEmbeds` del place**. El toggle pasa a controlar solo los
plugins de _inserción_ (toolbar/paste), no qué nodos _entiende_ el
editor.

Razón: si un body viejo tiene `{type:'youtube'}` y el place luego apaga
el toggle, sin el klass registrado Lexical descartaba el nodo
desconocido al hidratar y al re-guardar se perdía el video **sin
aviso**. Registrar siempre el klass hace el round-trip seguro. Es un
cambio aditivo (más nodos registrados, nunca menos) → no puede romper
deserialización.

### 5. Dedup del botón "Editar"

`<EditWindowActions>` muestra "Editar" solo si el subject es `post` y
el viewer NO es admin — el admin ya lo tiene en el kebab del header
sin límite de ventana. Comments mantienen solo "Eliminar" (su edición
es flujo aparte, fuera de F.4). `viewerIsAdmin` viaja por la cadena
`_thread-content` → `PostDetail` → `EditWindowActions` ya existente, sin
ampliar API innecesariamente.

## Alternativas consideradas

### A. Reusar `/conversations/new?edit=postId`

Descartada. Mezcla create y edit en una page con pre-loads distintos
(edit necesita findPost + gate + session; create no). El gate de
denegación queda más limpio en page propia. `?edit=` es URL smell.

### B. Renderer "lazy upgrade" para embeds viejos

Descartada (discutida con el owner antes del plan). Detectar URLs en
text nodes y renderizarlas como embeds en tiempo de render, sin tocar
el body. Genera discrepancia editor↔display y mueve la fuente de verdad
al render. La opción 4 (always-register klass) resuelve el round-trip
sin reescribir contenido.

### C. Migración retroactiva de URLs-texto a embed nodes

Descartada por decisión explícita del owner: cualquier solución que
"reescriba" bodies viejos puede romper contenido. Se deja el contenido
viejo como está; el fix mira hacia adelante.

## Trade-offs

- La page edit usa `dynamic = 'force-dynamic'` (el body editable nunca
  se sirve cacheado — el composer parte del estado fresco para el
  optimistic lock). Costo: SSR por request en esa ruta. Aceptable: es
  una page de baja frecuencia (editar, no leer).
- Race window: si el autor abre el editor a los ~4m30s y guarda a los
  ~5m10s con `version` cambiada entremedio, llegan `EditWindowExpired`
  y `ConflictError` a la vez. El action prioriza expired. UX: toast
  claro vía `friendlyErrorMessage` ("la sesión venció, recargá"). No se
  swallow.
- Cobertura: el repo no testea Server Component pages ni composer-form
  wrappers (no existen esos patrones). El gate replica el de
  `editPostAction`, ya cubierto por
  `server/actions/posts/__tests__/edit.test.ts`. No se introdujeron
  patrones de test ausentes (regla de oro del plan: cero convención
  nueva no solicitada).

## Cómo compone con G.3

G.3 dejó el gate `discussions:edit-post` listo en `editPostAction` +
`openPostEditSession`. Este cierre solo construyó la capa UI consumer
que faltaba. El gate de la page es defensa en profundidad sobre el de
la action — no lo reemplaza.
