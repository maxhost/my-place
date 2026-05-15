# Discussions — Especificación

> **Alcance:** el foro del place. Post (título + body rich text opcional) y Comment (rich text obligatorio, con cita opcional). Reacciones, moderación con flags, lectores por apertura, realtime acotado, paginación keyset, erasure 365d. Gated por `hours` (Fase 2.5): el place cerrado no expone nada de este slice.

> **Referencias:** `docs/ontologia/conversaciones.md` (ontología canónica), `docs/features/hours/spec.md` (gate de horario + helpers consumidos), `docs/data-model.md` (invariantes globales, erasure 365d), `docs/stack.md` (RLS mandatoria, TanStack Query), `docs/realtime.md` (contrato acotado thread-only), `docs/multi-tenancy.md` (rutas `{slug}.place.app/*`), `CLAUDE.md` (principios no negociables).

## 1. Modelo mental

El foro es el **espacio central** del place: donde la comunidad habla mientras el lugar está abierto y donde esa conversación queda como tejido del lugar mismo. No es un chat (turnos editoriales largos, sin presión de respuesta inmediata) ni un feed (sin scroll infinito, sin algoritmo, sin métricas vanidosas).

Tres propiedades estructurales lo separan de un foro tradicional:

- **Vive dentro del horario del place.** Fuera del horario no se accede (hard gate a nivel place, no por feature). Ver `docs/features/hours/spec.md`.
- **Los temas son traídos, no autorizados.** El Post pertenece al place: si el autor se va, el contenido queda. El derecho al olvido se ejecuta a los 365 días vía `authorUserId` nullable + `authorSnapshot`.
- **Los lectores son presencia visible.** Leer durante la apertura cuenta como participación: cada `PlaceOpening` acumula quién estuvo en cada Post (dwell ≥ 5s).

## 2. Vocabulario y convenciones

- **Post**: unidad raíz del foro. Tiene `title` obligatorio (1–160 chars) y `body` opcional (TipTap JSON AST, ≤ 20 KB serializado). Pertenece al `place`.
- **Comment**: respuesta a un Post. `body` obligatorio, `quotedCommentId?` opcional con snapshot congelado. No hay árbol: todos los comments son hermanos, vertical plano con citas.
- **Reaction**: emoji del set cerrado (👍 ❤️ 😂 🙏 🤔 😢) sobre Post o Comment. Una por `(target, user, emoji)`.
- **PlaceOpening**: instancia de apertura del place. Agrupa `PostRead` para que "los lectores de la apertura actual" sea una consulta trivial.
- **PostRead**: marca de lectura idempotente `(postId, userId, placeOpeningId)` emitida tras ≥ 5s de dwell en el thread.
- **Flag**: reporte de moderación de un usuario sobre un Post o Comment con motivo.

**Slice se llama `discussions`** (no `conversations`) y el vocabulario **Post/Comment** se usa tanto en UI como en código. Razón: "message" colisionaría con DMs futuras; "tema/mensaje" quedaba ambiguo entre thread/root y reply.

**Idioma:** UI en español (`es-AR`), código en inglés, commits en español. Mensajes al usuario: "Post", "Comentario", "Traer post", "Responder".

### URLs y slugs

La zona del foro en la UI se llama **conversations** (más cálido, español), mientras que el slice interno sigue siendo `discussions`. Rutas efectivas:

- **Lista:** `/[placeSlug]/conversations`
- **Detalle:** `/[placeSlug]/conversations/[postSlug]` (ej. `/palermo/conversations/por-que-el-pub-hoy`)
- Sin ruta `/thread/[id]` — el id interno nunca se expone en URL.

**Derivación del slug** (determinística, `generatePostSlug(title)`):

1. `title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` — strip diacríticos.
2. `.toLowerCase()` → `[^a-z0-9]+` → `-` → trim `-` → corte a 80 chars sin dejar palabra mutilada.
3. Si el resultado queda vacío (título solo-emojis/puntuación) → `fallback = 'tema'`.
4. Si colisiona con un slug reservado o ya existente en ese `placeId`, sufija `-2`, `-3`, …

**Reservados** (`RESERVED_POST_SLUGS` en `domain/slug.ts`): `settings`, `m`, `conversations`, `new`, `create`, `edit`, `drafts`, `admin`, `flags`, `moderation`, `null`, `undefined`.

**Estabilidad:** el slug se fija al crear. `editPostAction` cambia título/body/`editedAt`/`version` pero **no** regenera el slug — los links externos y citas no se rompen. Documentado como invariante en §8.

**Race-safe:** `UNIQUE(placeId, slug)` + `generatePostSlug` con set de colisiones frescas. Si aún así un `INSERT` concurrente gana, `createPostAction` reintenta una vez con re-fetch; segundo fallo → `ConflictError` ("reintentá con otro título").

## 3. Arquitectura del slice

Sigue el template de `src/features/_template/`:

```
src/features/discussions/
├── public.ts                    # único punto de entrada inter-slice
├── domain/
│   ├── types.ts                 # Post, Comment, Reaction, PlaceOpening, PostRead, Flag + enums
│   ├── invariants.ts            # editWindowOpen, canEdit, canDelete, etc.
│   └── errors.ts                # subclases de DomainError específicas
├── schemas.ts                   # Zod: TipTap JSON AST, inputs de actions
├── server/
│   ├── queries.ts               # findPostById, listPostsForPlace, listCommentsForPost, findFlagsOpen, etc.
│   ├── actions.ts               # createPost, createComment, editPost, editComment, hidePost, deletePost, deleteComment, react, unreact, flag, reviewFlag, markPostRead
│   ├── opening.ts               # findOrCreateCurrentOpening(placeId): lazy open/close de PlaceOpening
│   ├── realtime.ts              # broadcastNewComment(postId, comment): emit desde action post-commit
│   └── tiptap-render.ts         # @tiptap/html renderer SSR con extensions allowlist
├── ui/
│   ├── post-list.tsx            # server component: lista paginada por place
│   ├── post-detail.tsx          # server component: Post + hero + lista de comments
│   ├── comment-list.tsx         # server component + client bridge para realtime
│   ├── composer.tsx             # client: TipTap editor
│   ├── quote-block.tsx          # server component: renderiza quotedSnapshot
│   ├── reaction-bar.tsx         # client: toggle optimista
│   ├── presence-ring.tsx        # client: canal Supabase realtime
│   ├── dwell-tracker.tsx        # client: 5s timer + markPostReadAction
│   ├── dot-indicator.tsx        # client: diff lastReadAt vs lastActivityAt
│   ├── flag-modal.tsx           # client: modal de reportar
│   ├── flag-queue.tsx           # server component: cola admin /settings/flags
│   └── tiptap/
│       ├── editor-client.tsx    # wrapper @tiptap/react
│       └── extensions.ts        # allowlist única compartida editor+render
├── __tests__/
│   ├── edit-window.test.ts
│   ├── quote-snapshot.test.ts
│   ├── rich-text-schema.test.ts
│   ├── mention-validation.test.ts
│   ├── optimistic-lock.test.ts
│   ├── opening-lifecycle.test.ts
│   ├── actions-create-post.test.ts
│   ├── actions-create-comment.test.ts
│   ├── actions-moderation.test.ts
│   ├── actions-flag.test.ts
│   ├── actions-react.test.ts
│   ├── actions-mark-read.test.ts
│   ├── rls-policies.test.ts     # SQL directo con JWT distintos
│   └── pagination.test.ts
```

`public.ts` exporta: tipos de dominio, `createPostFromSystem` (para events), funciones de query agregadas que eventos pueda necesitar. Nunca exporta internals de UI, schemas ni actions.

## 4. Entidades y shape de datos

Schema Prisma definitivo en C.B. Pseudocódigo con columnas, constraints e índices:

### Post

```
id            cuid pk
placeId       fk Place  not null
authorUserId  fk User?  (nullable — erasure 365d)
authorSnapshot jsonb    not null  -- { displayName, avatarUrl } congelado al leftAt o a valores 'Sistema'
title         varchar(160) not null
slug          varchar(180) not null  -- derivado del título al crear, estable (ver §URLs y slugs)
body          jsonb?                -- TipTap AST
createdAt     timestamptz not null default now()
editedAt      timestamptz?
hiddenAt      timestamptz?          -- admin hide (reversible)
lastActivityAt timestamptz not null default now()  -- update en cada Comment nuevo
version       int not null default 0                 -- optimistic lock
```

**Delete es HARD** (decisión C.G.1 — ver ADR `docs/decisions/2026-04-21-post-hard-delete.md`):
Post no tiene `deletedAt`. `deletePostAction` elimina la fila en una transacción que
cascadea (FK) comments + post-reads y limpia polimórficamente reactions + flags
sobre ambos target types. Irreversible desde UI.

Índices:

- `(placeId, lastActivityAt DESC)` — lista foro ordenada por última actividad.
- `(placeId, createdAt DESC)` — lista admin.
- `(authorUserId) WHERE authorUserId IS NOT NULL` — perfil contextual del miembro + job de erasure.
- **UNIQUE `(placeId, slug)`** — lookup por URL y garantía de unicidad del slug dentro del place.

Constraints:

- `title` no puede ser solo-whitespace (CHECK `btrim(title) <> ''`).
- `authorSnapshot` no puede ser `{}` (CHECK `authorSnapshot ? 'displayName'`).
- `slug` no vacío y derivado por `generatePostSlug()` — no se edita tras crear.

### Comment

```
id            cuid pk
postId        fk Post  not null  on delete restrict
placeId       fk Place not null  -- denormalizado para RLS y queries rápidas
authorUserId  fk User?
authorSnapshot jsonb   not null
body          jsonb    not null   -- TipTap AST obligatorio
quotedCommentId fk Comment? on delete set null
quotedSnapshot jsonb?             -- { commentId, authorLabel, bodyExcerpt (≤200 chars), createdAt }
createdAt     timestamptz not null default now()
editedAt      timestamptz?
deletedAt     timestamptz?
version       int not null default 0
```

Índices:

- `(postId, createdAt ASC)` — orden natural del thread.
- `(postId, createdAt DESC, id DESC) WHERE deletedAt IS NULL` — cursor paginación backward.
- `(authorUserId) WHERE authorUserId IS NOT NULL`.

Constraints:

- `quotedCommentId` debe pertenecer al mismo `postId` — enforced en action + CHECK opcional vía trigger.
- Si `quotedCommentId IS NOT NULL` entonces `quotedSnapshot IS NOT NULL`.

### Reaction

```
id         cuid pk
targetType enum('POST', 'COMMENT') not null
targetId   text  not null  -- id de Post o Comment
placeId    fk Place not null
userId     fk User  not null
emoji      enum('THUMBS_UP', 'HEART', 'LAUGH', 'PRAY', 'THINKING', 'CRY') not null
createdAt  timestamptz not null default now()
```

Constraints:

- UNIQUE `(targetType, targetId, userId, emoji)` — un user = una reacción por emoji por target.

Índice:

- `(targetType, targetId)` — agregado para render rápido de bar de reacciones.

### PlaceOpening

```
id        cuid pk
placeId   fk Place not null
startAt   timestamptz not null
endAt     timestamptz?          -- null = apertura activa
source    enum('SCHEDULED', 'ALWAYS_OPEN', 'EXCEPTION') not null
createdAt timestamptz not null default now()
```

Índices:

- `(placeId, startAt DESC)`.
- **UNIQUE parcial `(placeId) WHERE endAt IS NULL`** — máx 1 apertura activa simultánea por place.

### PostRead

```
id              cuid pk
postId          fk Post         not null
userId          fk User         not null
placeOpeningId  fk PlaceOpening not null
readAt          timestamptz not null default now()
dwellMs         int not null
```

Constraints:

- UNIQUE `(postId, userId, placeOpeningId)` — idempotente dentro de una apertura.

Índices:

- `(postId, placeOpeningId)` — render de bloque "leyeron esta noche".
- `(userId, postId)` — dot indicator y erasure.

### Flag

```
id                     cuid pk
targetType             enum('POST', 'COMMENT') not null
targetId               text not null
placeId                fk Place not null
reporterUserId         fk User  not null
reason                 enum('SPAM', 'HARASSMENT', 'OFFTOPIC', 'MISINFO', 'OTHER') not null
reasonNote             varchar(500)?
status                 enum('OPEN', 'REVIEWED_ACTIONED', 'REVIEWED_DISMISSED') not null default 'OPEN'
createdAt              timestamptz not null default now()
reviewedAt             timestamptz?
reviewerAdminUserId    fk User?
reviewNote             varchar(500)?
```

Constraints:

- UNIQUE `(targetType, targetId, reporterUserId)` — un reporte por usuario por target.
- CHECK `status='OPEN' OR reviewedAt IS NOT NULL` — consistencia de estado.

Índice:

- `(placeId, status, createdAt DESC)` — cola admin paginada.

## 5. RLS (Row Level Security)

Mandatoria por `docs/stack.md`. Aplica a las 6 tablas con service role bypass para jobs (erasure, cron de opening). Políticas SQL textuales (implementación en C.B):

### Helper común

```sql
CREATE FUNCTION is_active_member(place_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."placeId" = place_id
      AND m."userId" = auth.uid()
      AND m."leftAt" IS NULL
  );
$$;

CREATE FUNCTION is_place_admin(place_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."placeId" = place_id
      AND m."userId" = auth.uid()
      AND m."leftAt" IS NULL
      AND m.role = 'ADMIN'
  ) OR EXISTS (
    SELECT 1 FROM "PlaceOwnership" o
    WHERE o."placeId" = place_id
      AND o."userId" = auth.uid()
  );
$$;
```

### Post

- `SELECT`: `is_active_member(placeId) AND (hiddenAt IS NULL OR is_place_admin(placeId))`.
- `INSERT`: `is_active_member(placeId) AND authorUserId = auth.uid()`.
- `UPDATE`: `is_active_member(placeId) AND (authorUserId = auth.uid() OR is_place_admin(placeId))`. La ventana 60s y las columnas mutables se enforzan en la action; RLS solo restringe quién puede tocar la fila.
- `DELETE`: sin policy — denegado a `authenticated`/`anon`. El hard delete del admin (C.G.1) corre con service role desde la server action `hardDeletePost`.

### Comment

- Mismo patrón. `SELECT` permite leer deleted para mostrar placeholder (cliente ya filtra `deletedAt` para rendering), admin ve todo. Alternativa: filtrar deleted con predicate y dejar que el placeholder se hidrate desde snapshot — C.B decide. Recomendación: mostrar `deletedAt` siempre y hacer el filtrado de contenido en render.

### Reaction

- `SELECT`: `is_active_member(placeId)`.
- `INSERT`: `is_active_member(placeId) AND userId = auth.uid()`.
- `DELETE`: `userId = auth.uid()` (hard delete OK — es una reacción, no contenido).

### PlaceOpening

- `SELECT`: `is_active_member(placeId)`.
- `INSERT / UPDATE`: service role only (se orquesta desde backend).

### PostRead

- `SELECT`: `is_active_member(placeId)` (resolved joining Post→placeId) O `userId = auth.uid()`. Decisión: join-based; render de "leyeron esta noche" es público dentro del place.
- `INSERT`: `is_active_member(placeId) AND userId = auth.uid()`. Además gate de horario en action.
- `UPDATE / DELETE`: service role only (erasure).

### Flag

- `SELECT`: `is_place_admin(placeId) OR reporterUserId = auth.uid()`.
- `INSERT`: `is_active_member(placeId) AND reporterUserId = auth.uid()`.
- `UPDATE`: `is_place_admin(placeId)` — solo admin marca review.
- `DELETE`: `false`.

### Service role

Jobs que bypassean RLS (conectan con `SUPABASE_SERVICE_ROLE_KEY`):

- Erasure 365d (nullifica `authorUserId` + congela `authorSnapshot`).
- Lazy/cron de `PlaceOpening` (abre/cierra filas).
- Export de temporada (v2).

## 6. Estados del dominio

| Entidad      | Estados                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post         | `VISIBLE` (no `hiddenAt`), `HIDDEN` (`hiddenAt` set). Delete es **hard** (cascada FK + cleanup polimorfo de reactions/flags; la fila desaparece). Dimensión ortogonal derivada: `VIVO` vs `DORMIDO` según `lastActivityAt`. |
| Comment      | `VISIBLE`, `DELETED` (`deletedAt` set — soft delete; render muestra `[mensaje eliminado]`).                                                                                                                                 |
| Flag         | `OPEN`, `REVIEWED_ACTIONED`, `REVIEWED_DISMISSED`.                                                                                                                                                                          |
| PlaceOpening | activa (`endAt IS NULL`), cerrada.                                                                                                                                                                                          |

**Vivo/dormido** es presentación: `dormido = now - lastActivityAt > 30 días`. Se deriva en render, no es columna. Cualquier Comment actualiza `lastActivityAt` y reactiva.

## 7. Comportamiento por rol

| Acción                          | Member      | Admin                                       | Owner        | Ex-miembro | No-miembro auth |
| ------------------------------- | ----------- | ------------------------------------------- | ------------ | ---------- | --------------- |
| Ver Post/Comment (visible)      | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Ver Post HIDDEN                 | ✗           | ✓                                           | ✓            | ✗          | ✗               |
| Ver Comment DELETED (como tal)  | placeholder | ✓ raw                                       | ✓ raw        | ✗          | ✗               |
| Ver Post eliminado              | 404         | 404                                         | 404          | 404        | 404             |
| Crear Post                      | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Crear Comment                   | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Editar propio <60s              | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Editar propio ≥60s              | ✗           | admin edita Post propio                     | ✓ como admin | ✗          | ✗               |
| Editar Post de otro             | ✗           | ✗ (no puede re-escribir — solo hide/delete) | ✗            | ✗          | ✗               |
| Eliminar Post propio <60s       | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Eliminar Post de otro           | ✗           | ✓                                           | ✓            | ✗          | ✗               |
| Eliminar Comment propio <60s    | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Eliminar Comment de otro        | ✗           | ✓                                           | ✓            | ✗          | ✗               |
| Hide/Unhide Post                | ✗           | ✓                                           | ✓            | ✗          | ✗               |
| Reaccionar                      | ✓           | ✓                                           | ✓            | ✗          | ✗               |
| Flaggear                        | ✓           | ✓ (flaggea también)                         | ✓            | ✗          | ✗               |
| Revisar flags (/settings/flags) | ✗           | ✓                                           | ✓            | ✗          | ✗               |
| Mark read (dwell)               | ✓           | ✓                                           | ✓            | ✗          | ✗               |

Todas las acciones requieren **place abierto** (`assertPlaceOpenOrThrow`). El gate de `(gated)/layout.tsx` ya lo cubre en lectura; las actions lo re-enforzan como defensa en profundidad.

## 8. Invariantes del dominio

1. **Edit window 60s para abrir, +5min de gracia para guardar.** El autor puede **abrir** el formulario de edición si `now - target.createdAt < 60_000ms`. Al abrirlo, el server emite un edit-session token firmado HMAC (`subjectType|subjectId|userId|openedAt`) con grace window de 5min desde `openedAt`. Al guardar, el server exige el token; si es válido y el grace no expiró, acepta el edit **aunque ya hayan pasado los 60s desde `createdAt`**. La ventana de 60s sigue siendo un invariante hard sobre el momento de **apertura**, no sobre el momento de save — evita castigar al autor que tarda en tipear sin permitir ediciones arbitrariamente tardías. Admin no edita Post (solo hide/delete). Comments no tienen admin-edit. Motivación y tradeoffs en `docs/decisions/2026-04-21-edit-session-token.md`.
2. **Delete permissions.** Post: autor <60s O admin siempre. Comment: autor <60s O admin siempre.
3. **Quote snapshot congelado** al crear el Comment. Inmutable aun si el target se hide/delete. El render diferencia entre snapshot y estado actual del target para mostrar overlay.
4. **Vivo/dormido** derivado (`lastActivityAt < now - 30d`). Cada Comment exitoso update `Post.lastActivityAt` en la misma transacción.
5. **Reaction UNIQUE** `(targetType, targetId, userId, emoji)`. Set cerrado de 6 emojis.
6. **Flag UNIQUE** `(targetType, targetId, reporterUserId)`. No permite repetir.
7. **PostRead upsert monótono.** `INSERT … ON CONFLICT (postId, userId, placeOpeningId) DO UPDATE SET readAt = now(), dwellMs = GREATEST("PostRead"."dwellMs", EXCLUDED."dwellMs")`. Idempotente: re-leer el mismo post en la misma apertura actualiza `readAt` (necesario para que el dot ambar se apague cuando llega actividad nueva) y nunca retrocede `dwellMs`. Cambió de `DO NOTHING` a esta forma en 2026-04-20 — ver `docs/decisions/2026-04-20-post-read-upsert-semantics.md`.
8. **PlaceOpening activa ≤ 1 por place** (UNIQUE parcial DB).
9. **Post sin body es válido** (solo título).
10. **Comment body obligatorio** y no puede ser AST vacío (mínimo un paragraph con al menos un char o una mention).
11. **`quotedCommentId`** debe pertenecer al mismo `postId` del Comment que lo cita.
12. **Profundidad de cita ≤ 1.** No se permite `quotedCommentId` apuntando a un Comment que también tenga `quotedCommentId`. Validado en action.
13. **Título 1–160 chars**, trim, no solo-whitespace.
14. **Body ≤ 20 KB serializado** (JSON.stringify del AST). Lanza `RichTextTooLarge`.
15. **Profundidad de listas anidadas ≤ 5.** Prevenir DoS por AST patológico.
16. **Optimistic locking.** `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`. 0 rows ⇒ `ConflictError`.
17. **Rich text AST pasa Zod restrictivo** (sección 12).
18. **Mention userId** debe ser miembro activo del place al momento de crear el Comment/Post.
19. **Slug estable.** `Post.slug` se fija al crear (derivado del título) y nunca se regenera al editar. Único por `(placeId, slug)`.
20. **`Post.lastActivityAt` sólo lo bumpean `createPostAction` y `createCommentAction`.** Ninguna otra acción (reactions, flags, moderación hide/unhide, edits de título/body, reads, soft-delete) toca `lastActivityAt`. Consecuencia: leer un post nunca lo marca como "no leído" para otros; el dot ámbar refleja estrictamente contenido nuevo (comentarios). Lockea el contrato del indicador de §13. Verificado por `__tests__/last-activity-bumps.test.ts`.

## 8.1 UI del flujo "Editar conversación" (F.4, cerrado 2026-05-15)

Hasta 2026-05-15 la capa UI de edición de Post estaba sin cablear: el
botón "Editar" del kebab navegaba a `/conversations/new?edit=` (ruta que
nunca leyó el query), dejando el form vacío y arriesgando un post
duplicado al guardar. La server action (`editPostAction` +
`openPostEditSession`) ya existía y estaba testeada; solo faltaba el
consumer UI.

Flujo cerrado:

- **Ruta dedicada** `/conversations/[postSlug]/edit` (page SSR). Reusa
  `findPostBySlug` (sin query nueva). Gate top-level — defensa en
  profundidad sobre el de `editPostAction`.
- **Posts derivados** (`Post.libraryItem` / `Post.event` no nulos)
  redirigen 308 a su editor canónico (`/library/...` o `/events/...`):
  editarlos como post crudo perdería el contexto del wrapper dueño.
- **Gate × `hiddenAt`**: admin/owner/grupo con `discussions:edit-post`
  edita siempre; autor sin permiso solo dentro de la ventana y con el
  post no oculto.
- **Entry points**: kebab admin (`<PostAdminMenu>`, sin límite de
  ventana) + barra inline del autor (`<EditWindowActions>`, dentro de
  60s). Dedup: la barra inline omite "Editar" si el viewer es admin.
- **Embeds**: `BaseComposer` registra siempre los nodos embed para
  deserializar bodies viejos sin pérdida aunque el toggle del place
  esté OFF (el toggle solo gatea la _inserción_).

El detalle de permisos delegables (`discussions:edit-post`) vive en
`docs/decisions/2026-05-09-g3-edit-as-delegable-permission.md`. La
tabla §7 y el invariante #1 describen el modelo de permisos pre-G.3
(admin no edita Post ajeno) — G.3 lo revisó; ver ese ADR. Decisión de
este cierre: `docs/decisions/2026-05-15-post-edit-flow.md`.

## 9. Contrato de apertura y lectores

### PlaceOpening lifecycle

Función principal: `findOrCreateCurrentOpening(placeId): Promise<PlaceOpening | null>` en `server/opening.ts`. Idempotente:

1. Carga `hours` del place.
2. `now = new Date()`.
3. `win = currentOpeningWindow(hours, now)` (helper de `hours/public.ts`).
4. `active = await findActiveOpening(placeId)` — fila con `endAt IS NULL`.
5. Casos:
   - `hours.kind === 'always_open'` y no hay activa ⇒ INSERT `{startAt: now, endAt: null, source: 'ALWAYS_OPEN'}`.
   - `hours.kind === 'always_open'` y hay activa ⇒ retorna activa.
   - `win !== null` y no hay activa ⇒ INSERT `{startAt: win.start, endAt: null, source: hours.kind === 'scheduled' ? derivar('SCHEDULED'|'EXCEPTION') : 'ALWAYS_OPEN'}`.
   - `win !== null` y hay activa pero `active.startAt < win.start` (otra ventana) ⇒ UPDATE `endAt = active.startAt + duración previa estimada` (o mejor: usar `now` como cierre aproximado), luego INSERT nueva.
   - `win === null` y hay activa ⇒ UPDATE `endAt = now`. Retorna `null`.
   - `win === null` y no hay activa ⇒ retorna `null`.

**Decisión:** MVP usa lazy open/close. Cada render de `(gated)/layout.tsx` invoca el helper una vez (cached por request). Sin cron.

**Gap agendado** en roadmap: cron dedicado por minuto que cierre aperturas vencidas para places que nadie visita. Mitiga aperturas eternamente abiertas si el place no recibe tráfico.

### `currentOpeningWindow` helper (hours)

Firma: `(hours: OpeningHours, now: Date) => { start: Date; end: Date } | null`.

- `unconfigured` ⇒ null.
- `always_open` ⇒ null. **Rationale:** la apertura eterna no tiene ventana acotada computable desde `hours` solo; el registro vive en la tabla `PlaceOpening` con `endAt=null` creada al activar. El slice `discussions` orquesta esto mediante `findOrCreateCurrentOpening`. `hours` queda puro, sin I/O.
- `scheduled`: convierte `now` a zone, resuelve `effectiveWindowsFor(dateKey, dow, hours)`, si `'closed_by_exception'` retorna null, sino busca la ventana que contenga `nowTime` y retorna `{start, end}` como `Date`.

### Dwell tracking

Cliente (`<DwellTracker postId={...} />`):

- `useEffect` con `document.visibilityState === 'visible'`, arranca timer 5s.
- Al disparar, llama `markPostReadAction({postId})` vía TanStack Query mutation.
- Si el usuario cambia de pestaña antes de los 5s (visibilitychange → hidden), cancela el timer. Reanuda al volver.

Server action `markPostReadAction`:

1. `assertPlaceOpenOrThrow(placeId)` (derivado del postId).
2. Resolver miembro activo.
3. `opening = await findOrCreateCurrentOpening(placeId)`; si null ⇒ `OutOfHoursError` (cliente silencia).
4. `INSERT INTO "PostRead" (...) VALUES (...) ON CONFLICT ("postId","userId","placeOpeningId") DO UPDATE SET "readAt" = now(), "dwellMs" = GREATEST("PostRead"."dwellMs", EXCLUDED."dwellMs") RETURNING (xmax = 0) AS inserted`. El `RETURNING` distingue insert (`inserted = true`) vs update (`false`); el action retorna `recorded` mapeado 1:1 con `inserted` para preservar telemetría. Monótono por diseño (no retrocede `readAt` ni `dwellMs`).
5. Log pino con `event: 'postReadRecorded'` (insert) o `'postReadUpdated'` (re-read en misma apertura). La rama `updated` confirma que el fix C.F.1 está actuando en prod.

Cliente trata `OutOfHoursError` como silencioso (no muestra toast — el place ya se cerró y el layout va a refrescar a su ritmo).

El action invoca `revalidatePath(/<placeSlug>/conversations/<postSlug>)` al
final (siempre, tanto insert como update) para que el bloque de lectores
(ver siguiente sub-sección) refleje al nuevo lector y el dot indicator
recompute `lastReadAt > lastActivityAt` en la próxima navegación del
viewer. Revalidate es idempotente — múltiples fires concurrentes colapsan
en un solo refetch por cliente.

### Bloque de lectores de la apertura (C.K, 2026-04-21)

Render en el hero del thread, debajo de `ThreadPresence`:
`<PostReadersBlock postId placeId placeSlug viewerUserId />`. Contrato
(derivado de `docs/ontologia/conversaciones.md § Tres`,
`CLAUDE.md § Sobre la comunicación`: "Los lectores son parte de la
conversación. Leer es una forma visible de presencia, no lurking
invisible.").

**Query**: `listReadersByPost({ postId, placeId, placeOpeningId,
excludeUserId? }): Promise<PostReader[]>` vive en `server/queries.ts`.
Filtros:

- `(postId, placeOpeningId)` exacto (index ya existente).
- Ex-miembros excluidos: `user.memberships.some({ placeId, leftAt: null })`
  — derecho al olvido estructurado.
- Viewer excluido cuando `excludeUserId` se pasa — simetría con
  `ThreadPresence`.
- Orden `readAt DESC` (lector más reciente primero).
- Sin LIMIT en query; el cap es 150 miembros/place por invariante.

**UI** (Server Component):

- Si `findOrCreateCurrentOpening(placeId)` retorna null (place
  `unconfigured`) → `null`.
- Si `readers.length === 0` → `null` (consistencia con "nada demanda
  atención"; sin texto "aún nadie leyó").
- Hasta 8 avatars visibles; overflow `+N más`.
- Avatars **sin borde verde** (distinguir de `ThreadPresence` que SÍ lo
  tiene): `ReaderAvatar` privado del archivo.
- Cada avatar es `<Link href="/m/<userId>" prefetch={false}
aria-label={displayName}>` — clickeable al perfil contextual.
  `prefetch={false}` evita 8 prefetches por cada thread en viewport.
- `avatarUrl` null → inicial del `displayName` en `<span>` (pattern de
  `thread-presence.tsx:111-122`).
- Label "Leyeron:" con `aria-label="Lectores de la apertura"` en el
  contenedor.
- No WS: revalida via `markPostReadAction` → `revalidatePath`.

**Interacción con `ThreadPresence`**: un usuario puede aparecer en ambos
bloques simultáneamente (presente live WS + lector persistido en la
apertura actual). Diseño intencional — dimensiones temporales distintas:
presence = "ahora mismo"; readers = "durante esta apertura".

## 10. Contrato de moderación

### Hide (Post only)

Admin hace click en "Ocultar" en el dropdown del Post. Action `hidePostAction(postId)`:

1. `assertPlaceOpenOrThrow(placeId)`.
2. Verifica admin.
3. `UPDATE Post SET hiddenAt = now(), version = version + 1 WHERE id = ? AND version = ?`.
4. Log pino `postHidden`.
5. `revalidatePath` del thread.

Reversible con `unhidePostAction`.

### Delete

**Post → hard delete** (C.G.1, ADR `docs/decisions/2026-04-21-post-hard-delete.md`).
`deletePostAction` llama `hardDeletePost(postId)` en una única tx que: (1) cleanup
polimórfico de reactions sobre POST y sobre cada COMMENT hijo, (2) cleanup polimórfico
de flags idem, (3) `DELETE FROM "Post"` dispara CASCADE sobre comments + post-reads
por FK. La fila desaparece; links y citas preservan `quotedCommentId` por
`ON DELETE SET NULL`. Admin puede delete siempre; autor dentro de 60s. Irreversible.

**Comment → soft delete.** `deleteCommentAction` setea `deletedAt`. UI renderiza
`[mensaje eliminado — {fecha}]` preservando el autor solo si el actor es admin; para
miembros, el nombre también se reemplaza por "miembro" (respeto del tono del producto,
no dar pie a doxing).

### Hard delete de Comment

Solo DBA por SQL manual (o service role desde `members/` cron de erasure 365d). No hay
ruta desde UI para hard-delete de Comment — el soft delete es suficiente.

### Flag workflow

`flagAction({targetType, targetId, reason, reasonNote?})`:

1. `assertPlaceOpenOrThrow`.
2. Miembro activo.
3. `INSERT INTO Flag (...)` con UNIQUE catch → `FlagAlreadyExists`.
4. Log pino `flagCreated`.

Cola admin en `/settings/flags`:

- Server component `<FlagQueue />` lista `Flag` con status `OPEN` ordenadas `createdAt DESC`.
- Cada fila: ver target (link al Post/Comment), motivo, reporter, fecha, nota.
- Acciones: **Ignorar** (`reviewFlagAction(flagId, 'DISMISS', note?)`) / **Ocultar** (hide target + `REVIEWED_ACTIONED`) / **Eliminar** (delete target + `REVIEWED_ACTIONED`).
- `reviewFlagAction` hace todo en transacción: update Flag + update target si aplica.

### Badge

`<SettingsSidebar>` muestra badge con count de flags OPEN. Query cacheada `findOpenFlagsCount(placeId)` con `revalidate: 30`. Sin animación pulsante — principio anti-atención.

### Audit

Cada hide/unhide/delete/flag-review loguea pino con: `action`, `placeId`, `actorUserId`, `targetType`, `targetId`, `reason?`, `outcome`. Cuando exista `AuditLog` global, se escribe también (gap roadmap). Sin AuditLog, pino es la fuente única.

## 11. Contrato de citas

- **Profundidad ≤ 1.** No se cita una cita. Action valida.
- **Snapshot congelado** al crear:
  ```json
  {
    "commentId": "cmt_abc",
    "authorLabel": "María Gómez",
    "bodyExcerpt": "primeros ~200 chars de texto plano derivados del AST",
    "createdAt": "2026-05-07T23:10:00.000Z"
  }
  ```
- **Texto plano derivado** del AST: walker que extrae nodos `text` ignorando marks, trunca a 200 chars con elipsis. Se computa server-side al crear el Comment.
- **Target se hide/delete después:** render compara `quotedCommentId` con estado actual; si target `deletedAt !== null` muestra `[mensaje eliminado]`. Los Comments no se hide (sólo soft-delete); el caso de Post hide no aplica a citas porque las citas son a Comments. Los miembros comunes no ven distinción entre hide/delete en UI — solo admin.
- **`quotedCommentId` nullable con `ON DELETE SET NULL`.** Preserva citas si un DBA hard-deletea el Comment target, o si el Post padre se hard-deletea (caso común post-C.G.1) — cascade se dispara y el quotedCommentId queda null, render muestra placeholder.
- **Borde ámbar izquierdo** en UI (clase Tailwind `border-l-2 border-l-amber-500` compatible con CSS vars del place).

## 12. Rich text — Lexical + JSON AST

> **Migrado a Lexical 2026-05-06.** Esta sección queda como contexto histórico del slice `discussions/`. El modelo canónico vive en `docs/features/rich-text/spec.md`. ADR de la migración: `docs/decisions/2026-05-06-tiptap-to-lexical.md`.

### Decisión

Editor: **Lexical** (Meta). Storage: **JSON AST** en columna `jsonb` (mismo tipo de columna que TipTap; el shape interno cambió). Render SSR: visitor pattern AST → JSX (sin Lexical runtime en server).

Rationale (post-migración):

- Schema **per-instance** vía `initialConfig.nodes`: cada surface (comment / post / event / library-item) declara su propio set, evitando que comments paguen el costo de heading + lists + embeds que sólo usa post/library.
- Plugins son React Components lazy-loadables con `next/dynamic` — habilitamos/deshabilitamos embeds (YouTube, Spotify, Apple Podcasts, Ivoox) por place vía `Place.editorPluginsConfig` sin cambiar el editor.
- JSON AST sigue siendo safe-by-construction: el renderer SSR sólo emite JSX desde shapes validados por Zod (`richTextDocumentSchema` y subsets per-surface en `rich-text/domain/schemas.ts`).

### Detalle del modelo

El AST, schemas Zod, caps de tamaño, mention polimórfico y los plugins de embed (YouTube/Spotify/Apple Podcasts/Ivoox) viven en `docs/features/rich-text/spec.md`. Este spec ya no duplica la información — sólo lista cómo `discussions` consume el slice `rich-text/`.

### Cómo consume `discussions/`

- `Post.body` y `Comment.body` persisten un `LexicalDocument` (column `Json` / `Json`-NOT NULL respectivamente).
- Server actions de posts/comments validan con `richTextDocumentSchema` (importado de `@/features/rich-text/public`) y aplican `assertRichTextSize(body)` (cap 20 KB, depth 5).
- `quotedSnapshot` se construye con `buildQuoteSnapshot` (versión específica de `discussions/domain/invariants.ts` que retorna shape `{ commentId, authorLabel, bodyExcerpt, createdAt }` y delega excerpt a `richTextExcerpt` del slice rich-text).
- Renderer del thread y comments usa `<RichTextRenderer>` (Server Component) y `<RichTextRendererClient>` (para appended-comments del realtime — sin lookup async de mentions hasta el siguiente `revalidatePath`).
- Composers del post nuevo y comment se importan desde `discussions/ui/{post,comment}-composer-form.tsx` (wrappers slice-local que cablean el server action). Internamente delegan a `<PostComposer>` / `<CommentComposer>` del slice rich-text.

### Allowlist por surface (informativo)

| Surface en `discussions` | Nodos                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Post (thread)            | text, mention (`@user` `/event` `/library/<cat>/<item>`), heading h1-h3, bold, ordered list, bullet list, link, embeds (toggleables por place vía `Place.editorPluginsConfig`) |
| Comment / respuesta      | text, link, mention                                                                                                                                                            |

Italic se aplica en CSS al contenido de los `LinkNode` (no es toggle del usuario). Heading h4-h6 explicitamente excluidos en el schema Zod del subset.

### Schema Zod, validación de mentions y caps

Detalles en `docs/features/rich-text/spec.md` (sección "Modelo del documento" + "Mention polimórfico"). La validación de mentions a usuarios sigue corriendo server-side en las server actions de `discussions/`: el `targetId` se chequea contra `findMembership` del slice members; si no es miembro activo del place ⇒ `InvalidMention`. El `label` snapshot se respeta tal como llega del cliente (cap 80 chars en el schema Zod).

### Render SSR

`<RichTextRenderer>` (importado desde `@/features/rich-text/public.server`) recibe el `LexicalDocument` + un `MentionResolvers` con tres callbacks (user / event / library-item). Visitor pattern AST → JSX, sin runtime de Lexical en server. Detalles en el spec del slice rich-text.

### Editor client

`<PostComposer>`, `<CommentComposer>` y los wrappers slice-local de `discussions/ui/{post,comment}-composer-form.tsx` cubren la creación/edición. Internamente el `<BaseComposer>` de rich-text monta `<LexicalComposer>` con el set de nodos del surface y los plugins enabled (mention + link + history + embeds según `Place.editorPluginsConfig`).

### Accesibilidad

- Lexical aporta keyboard handling estándar (atajos Ctrl+B en post/library, Tab en listas, Enter para nueva línea).
- Composer: `aria-label="Escribir comentario"` / `"Escribir post"` en el `ContentEditable`.
- Mention autocomplete (`LexicalTypeaheadMenuPlugin`): `role="listbox"`, flechas, Enter selecciona, Escape cierra — accesibilidad heredada del primitive oficial.
- Avatares en suggestions de mention: `alt={displayName}`.

## 13. Realtime y presencia

> **Alcance actual (C.F + C.J, 2026-04-21):** el thread `post:<postId>` expone
> **dos capas realtime**: (a) presence de miembros con la vista abierta y (b)
> broadcast de nuevos comments (`comment_created`). `revalidatePath` sigue
> siendo la **fuente autoritaria** — el broadcast es optimización de latencia,
> best-effort. Ambas capas comparten las policies `realtime.messages` ya
> definidas en la migration `20260424000000_realtime_discussions_presence`.
> La infraestructura shared vive en `src/shared/lib/realtime/` y se reutilizará
> en DM, chat y eventos live. Decisión registrada en
> `docs/decisions/2026-04-21-shared-realtime-module.md`.

### Canales

Supabase Realtime, **solo** dentro del thread (per `docs/realtime.md`):

- `post:<postId>`:
  - **Presence:** miembros con la vista del Post abierta (track via
    `channel.track({ userId, displayName, avatarUrl })`).
  - **Broadcast:** nuevos comments emitidos desde `createCommentAction`
    post-commit. Event `comment_created`, payload `{ comment: CommentView }`.

**Sin canales a nivel place/list.** Contradice `docs/realtime.md` y el principio anti-ansiedad.

### Autorización

- **Subscribe:** RLS enforcea que `auth.uid()` es miembro activo del place derivado del postId. La subscripción a `post:<postId>` requiere que el cliente tenga permiso de lectura sobre ese Post (política SELECT). El canal se abre con `{ config: { private: true } }` contra `realtime.messages` — ver migration `20260424000000_realtime_discussions_presence` y funciones `realtime.discussions_post_id_from_topic()` + `realtime.discussions_viewer_is_thread_member()`.
- **Broadcast (server → canal):** emitido desde `createCommentAction` tras el commit vía
  `POST <SUPABASE_URL>/realtime/v1/api/broadcast` (HTTP one-shot, ~50ms;
  sin handshake WS) con el JWT del actor obtenido del `createSupabaseServer()`.
  RLS aplica idéntico al subscribe — policy `discussions_thread_send` sobre
  `realtime.messages`. Nunca emitido desde cliente. Ver `supabase-sender.ts`.

### Presencia

- Heartbeat automático del socket de Supabase Realtime (~30s); el cliente solo llama `channel.track({ userId, avatarUrl, displayName })` una vez al recibir `SUBSCRIBED`.
- Stale peer se descarta por `presence:leave` tras ~60s sin heartbeat — sin timeout manual.
- Dedupe por `userId` al renderizar (misma persona, varias pestañas = una burbuja).
- Filtra al viewer (no se muestra a sí mismo).
- UI: burbuja circular con borde verde (`--place-presence`) alrededor del avatar. Sin animaciones. Máximo 8 avatares visibles + `+N más` como overflow (este contador **no** contradice "sin contadores" del dot de unread: cuenta avatares humanos, no mensajes).
- Empty state: componente retorna `null`. No renderiza "0 personas".

### Dot indicator

Client-side sin queries extra:

```
lastReadAt = max(PostRead.readAt) WHERE userId = me AND postId = p
showDot = post.lastActivityAt > lastReadAt
```

`lastReadAt` ya viene en el payload del Post al cargar la lista (join agregado). Sin contador — solo el dot.

**Contrato binario del dot depende de dos invariantes:**

1. **`lastActivityAt` sólo se bumpea por creación de contenido** (invariante 20). Si reactions, flags o edits lo tocaran, el dot se encendería sin motivo genuino.
2. **`readAt` avanza en cada re-lectura** (invariante 7, upsert monótono). Si `DO NOTHING`, un re-read dentro de la misma apertura no lograría apagar el dot cuando llegó un comentario nuevo post-primera-lectura — ese fue el bug C.F.1 (fix 2026-04-20).

Romper cualquiera de las dos degrada el indicador al punto de hacerlo ruido. Ambas están cubiertas por tests.

### Fallback sin realtime

Thread funciona sin ws: los comments aparecen al refrescar manual (el `revalidatePath`
del action es siempre el path autoritativo). Presencia no se actualiza. Alineado
con `docs/realtime.md#Fallback`.

### Dedupe broadcasts

El hook `useCommentRealtime` (`src/features/discussions/ui/use-comment-realtime.ts`)
mantiene un `Set<commentId>` inicializado con los items SSR. Cada mensaje recibido
por broadcast:

1. Si `comment.id` ya está en el Set → descarta (cubre: emisor recibe su propio
   broadcast **y** el revalidatePath re-streamea el mismo comment; cliente aplica
   dedupe ambos casos).
2. Si es nuevo → agrega al Set + appendea al state local.

Cuando `initialItems` cambia (SSR re-stream post-revalidate), el hook marca los
IDs nuevos como vistos y los purga de `appendedComments` — así el comment
aparece sólo una vez (desde SSR), no duplicado.

### Feature flag de rollback

`DISCUSSIONS_BROADCAST_ENABLED=false` desactiva la emisión del broadcast sin deploy
de código — el sistema cae al comportamiento pre-C.J (sólo `revalidatePath`). Default
ON. Ver `docs/decisions/2026-04-21-shared-realtime-module.md`.

### Postura best-effort

El broadcast **nunca** propaga errores al action: si falla (sin sesión, HTTP non-2xx,
network), se logea `pino.warn({ event: 'commentBroadcastFailed' })` y el action
continúa normalmente. La visibilidad del comment no depende del broadcast — depende
del commit + `revalidatePath`. Este invariante protege el happy path.

### Payload

El broadcast viaja `{ comment: CommentView }` full (body rich-text incluido). No
incluye `reactionsByKey` (counts=0 hasta próximo revalidate), mismo trade-off que
`LoadMoreComments`. Tamaño típico <5KB, muy por debajo del cap de ~250KB por
message de Supabase.

## 14. Paginación

### Cursor keyset

- Orden: `(createdAt DESC, id DESC)` — `id` como tiebreaker estable bajo inserts concurrentes.
- Query:
  ```sql
  SELECT ... FROM "Comment"
  WHERE "postId" = ?
    AND "deletedAt" IS NULL
    AND ("createdAt", id) < (?, ?)  -- cursor
  ORDER BY "createdAt" DESC, id DESC
  LIMIT 50
  ```
- Input: `?before=<createdAt>,<id>` (o sin cursor para la primera página).
- Page size: **50** constante.
- Output: `{ items: Comment[], nextCursor: { createdAt, id } | null }`.

### Filtros

- Miembro común: `deletedAt IS NULL`.
- Admin con `?includeDeleted=1`: sin filtro.

### UX

No virtual scroll. Botón **"Ver más antiguos"** al final de la lista que carga la siguiente página. Elegido para mantener el producto sin "infinite scroll" (principio no negociable).

## 15. Errores estructurados

Subclases que se agregan en C.C. Viven en `src/features/discussions/domain/errors.ts` (feature-local; `shared/errors` ya tiene base + OutOfHoursError):

Viven en `src/features/discussions/domain/errors.ts`:

| Error                    | Code                  | Cuándo                                                                                                                                                     |
| ------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditWindowExpired`      | `INVARIANT_VIOLATION` | Autor intenta editar tras 60s.                                                                                                                             |
| `PostHiddenError`        | `CONFLICT`            | Comentar en Post con `hiddenAt IS NOT NULL`.                                                                                                               |
| `CommentDeletedError`    | `CONFLICT`            | Editar un Comment con `deletedAt IS NOT NULL`.                                                                                                             |
| `InvalidQuoteTarget`     | `VALIDATION`          | `quotedCommentId` no pertenece al postId, no existe, o pertenece a un Comment que a su vez cita (profundidad > 1).                                         |
| `RichTextTooLarge`       | `VALIDATION`          | Body serializado > 20 KB.                                                                                                                                  |
| `InvalidMention`         | `VALIDATION`          | `userId` mencionado no es miembro activo del place.                                                                                                        |
| `SlugCollisionExhausted` | `INVARIANT_VIOLATION` | `generatePostSlug` agotó 1000 sufijos numéricos. Inalcanzable en prod sin reserved set corrupto; se modela como invariante para discriminar en logging/UI. |

**Discriminación cross-boundary**: `code` (categoría) + `name` (subclase). `code` pertenece al enum `DomainErrorCode` (fijo); la subclase específica viaja en `name` (own-enumerable, sobrevive JSON serialization del boundary de server actions). Los catchers en UI/middlewares chequean ambos. Ver `src/shared/errors/domain-error.ts` § "boundary de server actions".

Viven en `src/features/flags/domain/errors.ts` (sub-slice flags separado post-C.G):

| Error               | Code             | Cuándo                                                          |
| ------------------- | ---------------- | --------------------------------------------------------------- |
| `FlagAlreadyExists` | `FLAG_DUPLICATE` | UNIQUE violation en Flag (reporter ya flaggeó el mismo target). |

Nota post-C.G.1: no existe `PostDeletedError` — Post es hard delete (la fila desaparece).
El intento de interactuar con un Post borrado produce `NotFoundError` estándar.

Reusos de `shared/errors/domain-error.ts`:

- `ValidationError` (Zod).
- `AuthorizationError` (no-miembro, no-admin).
- `NotFoundError` (Post/Comment no existe).
- `ConflictError` (optimistic lock falla).
- `OutOfHoursError` (place cerrado).

UI mapea errores a mensajes localizados en `es-AR` via un switch central por `code`.

## 16. Seguridad

- **Server-only.** Todo `queries.ts`, `actions.ts`, `opening.ts`, `tiptap-render.ts` importa `'server-only'`.
- **Zod en bordes.** Mismo schema client + server. Import desde `schemas.ts`.
- **`auth.uid()`** siempre desde `supabase.auth.getUser()` del server client, nunca del input del form.
- **Membership check** en cada action: no basta con tener sesión, hay que ser miembro activo del place.
- **Gate de horario** en cada action de escritura: `assertPlaceOpenOrThrow(placeId)` al tope de `createPost`, `createComment`, `editPost`, `editComment`, `hidePost`, `unhidePost`, `deletePost`, `deleteComment`, `react`, `unreact`, `flag`, `reviewFlag`, `markPostRead`.
- **RLS** como defensa en profundidad.
- **Rate limits concretos** (utilidad compartida agendada; gap roadmap). Propuesta:

| Acción                                      | Límite                          |
| ------------------------------------------- | ------------------------------- |
| `createPost`                                | 5/min, 20/hora por user+place   |
| `createComment`                             | 20/min, 200/hora por user+place |
| `editPost` / `editComment`                  | 20/min                          |
| `hidePost` / `deletePost` / `deleteComment` | 30/min por admin                |
| `react` / `unreact`                         | 60/min por user                 |
| `flag`                                      | 5/hora por user+target          |
| `reviewFlag`                                | 30/min por admin                |
| `markPostRead`                              | sin límite (idempotente)        |

- **CSRF:** Next server actions incluyen token anti-CSRF automático.
- **XSS:** JSON AST + renderer SSR nunca inyecta HTML arbitrario. Atributos de link fijos (`target`, `rel`). Mention labels re-sanean server-side.
- **SQLi:** Prisma parametriza todas las queries.
- **Enumeración:** IDs `cuid`, no secuenciales. No se expone `createdAt` a nivel de segundo en URLs.
- **Denegación de servicio:** rate limits + límite de body 20 KB + profundidad de listas 5.

## 17. Observabilidad y auditoría

### Logs estructurados (pino)

Cada action loguea al inicio y al final:

```ts
logger.info({
  action: 'createPost',
  placeId,
  actorUserId,
  outcome: 'success', // 'validation_error', 'authorization_error', 'out_of_hours', etc.
  durationMs,
  targetId: post.id,
})
```

Errores inesperados ⇒ `logger.error` con stack.

### Audit events (para AuditLog global futuro)

Cuando exista la tabla `AuditLog` (gap roadmap), discussions emite:

- `postCreated`, `postEdited`, `postHidden`, `postUnhidden`, `postDeleted`.
- `commentCreated`, `commentEdited`, `commentDeleted`.
- `reactionAdded`, `reactionRemoved`.
- `flagCreated`, `flagReviewed` (con acción resultante).
- `placeOpeningOpened`, `placeOpeningClosed`.

Mientras no exista AuditLog, pino es la fuente única; los eventos ya están estructurados para exportarse con una migración simple.

### Métricas

**Fuera de MVP.** El producto no mide engagement. Los únicos contadores que importan — miembros por place — ya están cubiertos por `members`.

## 18. Integración con otros slices

### `hours` (Fase 2.5)

- Consume `assertPlaceOpenOrThrow(placeId)` y `currentOpeningWindow(hours, now)` desde `features/hours/public.ts`.
- El gate visual (`(gated)/layout.tsx`) ya bloquea acceso cuando el place está cerrado; actions lo re-enforzan.

### `members` (Fase 2)

- Los nombres de autor en Post/Comment linkean a `/m/[userId]` (perfil contextual del miembro).
- `mention` resuelve via `findMembership(userId, placeId)` exportado por `members/public.ts`.
- **Erasure 365d** (definida en `docs/data-model.md`): job global ejecutado por `features/members/` que pasa `authorUserId = null` en todos los Post y Comment del ex-miembro cuya `leftAt + 365d < now`. `authorSnapshot` se congela al `leftAt` (no al crear) — `members/` es responsable de ese freeze cuando setea `leftAt`; `discussions/` solo expone el contrato de columnas nullable + snapshot.
- `authorSnapshot` para system posts: `{displayName: 'Sistema', avatarUrl: null}`.

### `events` (Fase 6)

- Al crear un evento, `events/` llama `createPostFromSystem({placeId, title, body, systemKind: 'EVENT', eventId})` exportado por `discussions/public.ts`.
- Los system posts tienen `authorUserId = null` y `authorSnapshot.displayName = 'Sistema'`.
- La vinculación `Post ↔ Event` se guarda en la tabla de `events`, no en Post.

### `settings`

- Ruta `/settings/flags` es propiedad de `discussions/` pero vive físicamente bajo `src/app/[placeSlug]/settings/flags/` y monta `<FlagQueue />` importado desde `discussions/public.ts`.
- Badge de flags abiertos en `<SettingsSidebar>` consume `findOpenFlagsCount(placeId)` exportado.

## 19. Fuera de scope MVP

- **Audio** (grabación 15-20s, Whisper, Storage, 24h TTL). Difiere a v2.
- **Temporadas** (cierre, PDF artefacto, anuarios).
- **UI dedicada de dormidos** (solo apilados cronológicos en la lista; el principio es "siguen ahí, no hay lista separada").
- **Búsqueda full-text.**
- **DMs** (slice separado si llega).
- **Edit de Post por admin** — admin solo puede hide/delete; no puede reescribir contenido ajeno.
- **Hard delete desde UI.**
- **Rich text avanzado:** imágenes embed, video, tablas, footnotes.
- **Notificaciones push / email** por nueva actividad.
- **Analytics / métricas** visibles a miembros o admins.
- **Multi-timezone por place** (viene de hours — un place = un timezone).
- **Cross-post entre places.**
- **Reacciones custom** (set cerrado fijo).

## 20. Verificación

Checklist que C.B–C.H deben cumplir:

### Migration (C.B)

- Tablas con columnas, enums y constraints como en sección 4.
- Índices declarados.
- Políticas RLS SQL aplicadas y verificadas con `supabase db push`.
- Service role documentado en helpers (`is_active_member`, `is_place_admin`).

### Dominio (C.C)

- Types exportados desde `domain/types.ts`.
- Invariantes testeadas: edit window 60s, quote snapshot inmutabilidad, optimistic lock 0-rows ⇒ `ConflictError`.
- Schema Zod del JSON AST cubre: paragraph/heading/lists/quote/code/mention/link. Rechaza: image, iframe, script, href con `javascript:` o `http:`, body > 20 KB, listas > 5 niveles, mention con userId no-miembro.
- Errores nuevos presentes con códigos correctos.

### Actions + queries (C.D)

- Happy path + 403 no-miembro + 400 Zod + 409 lock + 422 business (`PostHidden`, `EditWindowExpired`, `InvalidQuote`, `InvalidMention`) + `OutOfHoursError`.
- Transacciones: `createComment` en `$transaction([insertComment, update Post.lastActivityAt])`.
- `findOrCreateCurrentOpening` testeado en los 6 casos del lifecycle (sección 9).
- Pino log verificable en tests (spy en logger).

### RLS (tests SQL directos) — C.H ✅ (2026-04-22)

Implementado con harness `pg.Pool` sobre `DIRECT_URL` (session mode). Cada caso abre tx,
opcionalmente seedea como `postgres` super, cambia a rol `authenticated`, setea
`request.jwt.claims` vía `set_config(…, true)`, ejecuta queries bajo RLS, `ROLLBACK`.
Patrón oficial Supabase — sin firma de JWTs, sin libs nuevas. Ver `tests/rls/harness.ts`.

**72 casos verdes** contra policies instaladas en `my-place`:

| Tabla             | Casos | Archivo                               |
| ----------------- | ----- | ------------------------------------- |
| helpers-functions | 8     | `tests/rls/helpers-functions.test.ts` |
| Post              | 19    | `tests/rls/post.test.ts`              |
| Comment           | 12    | `tests/rls/comment.test.ts`           |
| Reaction          | 8     | `tests/rls/reaction.test.ts`          |
| Flag              | 14    | `tests/rls/flag.test.ts`              |
| PostRead          | 7     | `tests/rls/post-read.test.ts`         |
| PlaceOpening      | 5     | `tests/rls/place-opening.test.ts`     |

Roles ejercitados: `owner`, `admin`, `memberA`, `memberB`, `exMember` (leftAt set), `nonMember`, `anon`.

**Cobertura por tabla × rol × acción:**

| Tabla / acción          | active                                             | ex-member                               | admin     | owner | non-member | anon |
| ----------------------- | -------------------------------------------------- | --------------------------------------- | --------- | ----- | ---------- | ---- |
| Post SELECT visible     | ✓                                                  | ✗                                       | ✓         | ✓     | ✗          | ✗    |
| Post SELECT hidden      | ✗                                                  | ✗                                       | ✓         | ✓     | ✗          | ✗    |
| Post INSERT self-author | ✓                                                  | ✗                                       | ✓         | ✓     | ✗          | ✗    |
| Post INSERT otro author | ✗                                                  | ✗                                       | ✗         | ✗     | ✗          | ✗    |
| Post UPDATE author      | ✓                                                  | ✗                                       | ✓ (admin) | ✓     | ✗          | —    |
| Post DELETE             | ✗                                                  | ✗                                       | ✗         | ✗     | ✗          | ✗    |
| Comment × 5 acciones    | idem Post (sin filtro deletedAt en SELECT)         |
| Reaction × 4 acciones   | idem (DELETE self sin `is_active_member` — tested) |
| Flag SELECT own         | ✓                                                  | ✓ (policy sin is_active_member, tested) | ✓         | ✓     | ✗          | —    |
| Flag SELECT todos       | ✗                                                  | ✗                                       | ✓         | ✓     | ✗          | —    |
| Flag UPDATE             | ✗                                                  | ✗                                       | ✓         | ✓     | ✗          | —    |
| PostRead × 2 acciones   | idem (SELECT self O active-member-del-post)        |
| PlaceOpening SELECT     | ✓                                                  | ✗                                       | ✓         | ✓     | ✗          | —    |
| PlaceOpening mutate     | ✗ (todos — sólo service_role, sin policy)          |

Reconciliación migration SQL ↔ DB live (2026-04-23): la migration
`prisma/migrations/20260426000000_post_hard_delete_align/migration.sql` codifica el
cambio que se había aplicado manualmente vía SQL Editor de Supabase tras C.G.1
(ADR `docs/decisions/2026-04-21-post-hard-delete.md`). Sus pasos (todos idempotentes):
drop de la columna `Post.deletedAt`, drop + recreate de la policy
`Post_select_active_member` sin la branch de `deletedAt`, drop del índice parcial
`Post_placeId_lastActivityAt_active_idx` (reemplazado por no-parcial), redefinición de
la función `realtime.discussions_viewer_is_thread_member()` sin filtro de `deletedAt`,
recreate de las policies `discussions_thread_receive` / `discussions_thread_send` sobre
`realtime.messages`. Aplicar sobre `my-place` es no-op semántico; aplicar sobre un DB
fresco (CI branches, ambientes nuevos) lo lleva al estado actual de prod.

### E2E (Playwright, C.H + C.H.1 + C.H.2) ✅ (2026-04-22)

Infraestructura production-ready:

- **`tests/global-setup.ts`** — corre `tests/fixtures/e2e-seed.ts` (aditivo, FK-safe,
  prefijos reservados `usr_e2e_*` / `place_e2e_*` / `/^e2e-.*@e2e\.place\.local$/`),
  luego logs in de 6 roles vía `POST /api/test/sign-in` → persiste cookies a
  `tests/.auth/<role>.json`. Consumido por specs vía `storageStateFor(role)`.
- **`src/app/api/test/sign-in/route.ts`** — gate doble: `NODE_ENV === 'production'` →
  404 sin leer body; header `x-test-secret !== E2E_TEST_SECRET` → 404. 9 casos unit
  cubren ambos paths. Ver `src/app/api/test/sign-in/__tests__/route.test.ts`.
- **Helpers**: `tests/helpers/{subdomain,playwright-auth,time,reset-content,db,prisma}.ts`.
  `reset-content` tiene guard `/^place_e2e_/` para evitar tocar dev data. Prisma singleton
  compartido en `prisma.ts` evita saturar el pooler bajo paralelismo.
- **Puerto 3001** en dev server local (evita colisión con dev servers de otros proyectos
  en el host). Cookies cross-subdomain se mantienen (cookie-domain strippea puerto).
- **Aislamiento por project**: specs que crean posts usan slug `${spec}-${browserName}`
  para que chromium y mobile-safari no colisionen en `UNIQUE(placeId, slug)` al correr
  en paralelo. Ver ADR `2026-04-22-mobile-safari-webkit-flows.md`.

**48 tests verdes × 2 browsers** (chromium + mobile-safari):

| Archivo                            | Tests por browser | Alcance                                                               |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------- |
| `smoke/health.spec.ts`             | 1                 | `GET /api/health` → 200 + db=up                                       |
| `smoke/auth.spec.ts`               | 4                 | Landing + login + gate redirect                                       |
| `smoke/middleware-routing.spec.ts` | 3                 | Multi-tenant routing apex/sub                                         |
| `smoke/auth-storageState.spec.ts`  | 1                 | Validación de globalSetup + storageState                              |
| `flows/post-crud.spec.ts`          | 4                 | Lista / CTA / nonMember bloqueado / ventana 60s expiró (backdatePost) |
| `flows/hours-gate.spec.ts`         | 3                 | Belgrano cerrado → memberB ve gate / reopen / owner mantiene settings |
| `flows/admin-inline.spec.ts`       | 2                 | Admin kebab con items / autor no-admin no ve kebab                    |
| `flows/comment-reactions.spec.ts`  | 2                 | Comment seedeado aparece / reaction heart persiste en DB              |
| `flows/moderation.spec.ts`         | 2                 | Owner reporta (modal → action → DB) / admin ve flag en cola           |
| `flows/invite-accept.spec.ts`      | 1                 | Admin completa form → Invitation creada con token                     |

### CI ✅ (2026-04-22)

Job `e2e` rescripted con **branches Supabase efímeras** vía Management API.
`scripts/ci/branch-helpers.sh` expone `create_branch → poll_until_active →
fetch_branch_env → delete_branch`. `if: always()` en cleanup + `concurrency:
cancel-in-progress` evitan leaked branches de runs cancelados. Requiere GH Secrets:
`SUPABASE_ACCESS_TOKEN` (scope projects:write,branches:write), `SUPABASE_PROJECT_REF`,
`E2E_TEST_SECRET`. Job falla con mensaje explícito si un secret falta — no degrada
silenciosamente. Costo ≈ $0.03/run. Ver ADR
`docs/decisions/2026-04-22-e2e-rls-testing-cloud-branches.md`.

### UI (C.E, C.F, C.G)

- Composer Tip Tap crea, edita (dentro de 60s) y valida Zod en cliente antes de enviar.
- Lista de Posts + lista de Comments pagina correctamente; `id` tiebreaker cubierto.
- Dwell tracker marca read a los 5s; no marca si el user cambia de pestaña.
- Reacciones: toggle optimista + reconciliation tras respuesta.
- Citas: snapshot visible; target hide/delete → placeholder.
- Flag modal crea flag + UNIQUE rechaza duplicado.
- `/settings/flags` lista + acciones funcionan + badge count.
- Realtime: nuevo comment aparece en todos los clientes presentes.

### Build

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.

### MCP supabase (manual)

```sql
SELECT id, "placeId", "authorUserId", title, "hiddenAt"
FROM "Post" WHERE "placeId" = 'place_xxx' ORDER BY "lastActivityAt" DESC;

SELECT COUNT(*) FROM "Flag" WHERE "placeId" = 'place_xxx' AND status = 'OPEN';

SELECT * FROM "PlaceOpening" WHERE "placeId" = 'place_xxx' AND "endAt" IS NULL;
```

## Apéndice — Ejemplos concretos

### Taller profesional, sábado 9-13 BA, admin crea post

1. Sábado 09:05, owner entra. `(gated)/layout.tsx` llama `findOrCreateCurrentOpening`; no hay activa y `currentOpeningWindow` retorna `{start: 09:00, end: 13:00}` ⇒ INSERT PlaceOpening activa.
2. Owner crea Post "Retrospectiva sprint X". Zod valida title y body, action verifica membership + admin + `assertPlaceOpenOrThrow`, INSERT con `authorUserId=owner.id`, `authorSnapshot={displayName:'Maxi',avatarUrl:...}`, `version=0`. Log pino `postCreated`.
3. Member entra 09:10, abre el Post. `<DwellTracker>` arranca timer 5s. A los 5s llama `markPostReadAction` ⇒ UPSERT PostRead.
4. Member comenta "agrego esto sobre testing". Zod valida AST, action `createComment` en transacción: INSERT Comment + UPDATE Post.lastActivityAt. Broadcast al canal `post:<id>`. Owner (que está mirando) recibe el comment vía realtime.
5. 13:00. Miembro intenta comentar a las 13:01 ⇒ layout recalcula: helper cierra PlaceOpening (endAt=13:00), muestra `<PlaceClosedView>`. La action de comment adicional falla con `OutOfHoursError` como defensa.

### Erasure a los 365 días

Member María se va el 2025-06-01. `members/` setea `leftAt=2025-06-01` y congela `authorSnapshot` en todos los Post y Comment con `authorUserId=maria.id` (paso atómico del action de leave).

El 2026-06-02, cron job de `members/` encuentra Post/Comment con `authorUserId=maria.id` AND miembro con `leftAt+365d < now`. Ejecuta `UPDATE Post SET authorUserId = NULL WHERE authorUserId = maria.id` con service role (bypass RLS). El `authorSnapshot` se mantiene — el render muestra "ex-miembro · María Gómez" durante los 365 días y "ex-miembro" después de que el avatar se borre (política separada de members).

### Flag de comment ofensivo

Member A flaggea Comment C reportado por B como `HARASSMENT` con nota. Admin entra a `/settings/flags`, ve la fila con link al thread. Abre target, lee contexto, decide eliminar el Comment. Click "Eliminar". Action `reviewFlagAction(flagId, 'DELETE', 'contenido inapropiado')` ejecuta en transacción: UPDATE Flag (status=REVIEWED_ACTIONED, reviewedAt, reviewerAdminUserId, reviewNote) + UPDATE Comment (deletedAt). Log pino. Badge baja de 3 a 2.

---

## 21. Layout R.6 (rediseño handoff threads + threads-detail)

> Agregado el 2026-04-26. Documenta el rediseño visual completo de las pages `/conversations` (lista) y `/conversations/[postSlug]` (detalle) según los handoffs `handoff/threads/` y `handoff/threads-detail/`. Reemplaza el layout heredado de cards uniformes por la estructura del handoff. Decisiones formalizadas en ADR `docs/decisions/2026-04-26-threads-layout-redesign.md`.

> R.1 (commits `f17099b` + `698fa5f`) migró tokens visuales (`place-*` → tokens nuevos) sin tocar el layout. R.6 cubre el rediseño de layout que faltaba.

### 21.1 Threads list layout (`/conversations`)

Estructura top-down:

- **Section header** (`<ThreadsSectionHeader>`):
  - `<PageIcon>` shared (44×44, radius 12, `bg-surface`, border 0.5px, sombra dual `0 4px 14px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`, emoji 24px line-height 1) con emoji 💬. Mismo primitive usado en home (🏠) y eventos (🎉) para unidad visual del "page icon" en cada zona.
  - Título "Discusiones" en `font-title font-bold text-[26px] tracking-[-0.6px]` — tipografía unificada con la home (nombre del place) y la page de eventos. Ajuste 2026-04-26 (revisión visual del user): el 38px original del handoff dominaba demasiado al lado del chip; 26px da balance editorial sin perder presencia.
  - CTA "Nueva conversación" a la derecha del título (botón discreto, no fab) — único punto de entrada para crear posts F1.
  - Padding 24px desde top viewport, 12px gap chip-título, 12px padding horizontal sides (`px-3` consistente con el resto de zonas).

- **Filter pills** (`<ThreadFilterPills>`, client component):
  - 3 pills: `Todos` (default activo), `Sin respuesta`, `En los que participo`.
  - Gap 6px, padding 8/14, radius 999, `font-body text-[13px] font-medium`.
  - Active: `bg-text text-bg`. Inactive: transparent + `text-muted` + `border-[0.5px] border-border`.
  - **Estado** (R.6 follow-up 2026-04-30): los 3 pills funcionales. Estado en URL `?filter=`. Ver § 21.4.

- **Featured thread** (`<FeaturedThreadCard>`, primer post por `lastActivityAt`):
  - Card con `bg-surface border-[0.5px] border-border rounded-[18px] p-[18px]`, margin 14px 12px.
  - Author row: `MemberAvatar` 24×24 + nombre `font-body text-[13px] font-medium` + tiempo relativo `text-muted`.
  - Título `font-title font-bold text-[22px]`, margin 12px 0 6px.
  - Snippet `font-body text-sm text-muted` clamped 2 lines (`-webkit-line-clamp: 2`), 140 chars max server-side.
  - Footer: `<ReaderStack>` 4 avatars 22×22 overlap -6px ring 1.5px `bg-bg` + count "{n} respuestas" `font-body text-xs text-muted`.

- **Thread row** (`<ThreadRow>`, resto de posts):
  - Sin card chrome. Padding 14px vertical / 12px horizontal.
  - Hairline divider `border-[0.5px] border-border` entre rows (no en último).
  - Author row idéntica a featured (24×24 avatar + nombre + tiempo).
  - Título `font-title font-semibold text-[17px]`, margin 6px 0 2px.
  - Snippet 1 line clamp + ellipsis, `font-body text-[13.5px] text-muted`.
  - Footer: `<ReaderStack>` 3-4 avatars + count "{n} respuestas {N} lectores".
  - Full-row hit target: `<Link href="/conversations/{slug}">`.

- **Empty state** (`<EmptyThreads>`):
  - Emoji 🪶 (feather) centrado, "Todavía nadie escribió" como title, "Iniciá la conversación con un tema que te interese" subtitle, pill CTA "Nueva discusión" → `/conversations/new`.

### 21.2 Threads detail layout (`/conversations/[postSlug]`)

Estructura top-down (todo dentro del shell viewport):

- **`<ThreadHeaderBar>`** sticky 56px (border-bottom hairline):
  - Slot izquierda: `<BackButton>` (chip 36×36 `bg-surface border-[0.5px] border-border rounded-full`, icono `ChevronLeft` lucide 18px). Click → `useRouter().back()` con fallback `<Link href="/conversations">` si `window.history.length <= 1`.
  - Slot derecha: `<PostAdminMenu>` existente (admin only) montado acá. Para non-admin queda vacío. Futuro: agregar Reportar/Silenciar.

- **Body** (padding 20px 16px 0):
  - Author row: `MemberAvatar` 28×28 + nombre `font-body text-sm font-semibold` + tiempo `text-muted`.
  - Título `font-title font-bold text-[28px] tracking-[-0.02em]`, margin 14px 0.
  - Body con `<RichTextRenderer>` (intacto): `font-body text-base leading-[1.55] text-text`, spacing entre paragraphs 12px.

- **Action row** (padding 16px 16px 0):
  - `<ReactionBar>` (intacto, 6 emojis del producto). Restyle visual: cada emoji con su count compacto, gap 18px, sin background propio (solo hover state).

- **Readers** (padding 14px 16px 18px):
  - `<PostReadersBlock>` restilead: hasta 5 avatars 22×22 overlap -6px ring 1.5px `bg-bg` + texto "{n} leyeron" `font-body text-[13px] text-muted`.

- **Replies separator**:
  - Hairline border-top, padding 14px 16px 6px, label "{n} RESPUESTAS" `font-body text-[11px] font-semibold uppercase tracking-wider text-muted`.

- **Reply list** (`<CommentThread>` + `<CommentItem>` restileados):
  - Cada reply: padding 14px 16px, hairline top (no en primero).
  - Author row: 28×28 avatar + nombre `font-body text-sm font-semibold` + tiempo `text-muted text-xs`.
  - Body: `font-body text-[14.5px] leading-[1.55]`, margin-top 8px.
  - QuotePreview restilead: `border-l-[2px] border-accent pl-[10px]`, texto italic `text-[13.5px] text-muted` 1 line clamp, attribution "— Nombre" italic `text-[11.5px] text-muted`.
  - Footer reply: `<ReactionBar>` (mismas 6 emojis) + `<QuoteButton>` ("responder/citar") + `<EditWindowActions>` (autor 60s) + `<CommentAdminMenu>` (admin), gap 14px, margin-top 10px.

- **`<CommentComposer>`** fixed bottom (resuelto en R.6.4):
  - Layout: `<RichTextEditor>` (TipTap full, intacto) izq/centro + send button 40×40 round `bg-accent text-bg` con icono `Send` lucide der.
  - Posicionamiento: `fixed inset-x-0 bottom-0 mx-auto max-w-[420px] z-30` para alinearse con la columna del shell (`AppShell` usa el mismo `max-w`). Background `bg-bg/90 backdrop-blur` + top hairline `border-[0.5px] border-border`. Bottom padding += `env(safe-area-inset-bottom)` para iOS notch/home bar.
  - Quoting chip activo (cuando `quote !== null`): arriba del editor, reusa `<QuotePreview>` con × button para clear.
  - El page composer agrega `pb-32` al contenedor para que el último comment no quede tapado.
  - **Gap CRÍTICO resuelto en R.6.4**: shell `<main>` cambió de `flex-1 overflow-hidden` → `flex-1 overflow-x-hidden`. Preserva el clip horizontal previsto para swipe (R.2.5 follow-up) pero libera scroll vertical para `position: fixed/sticky` desde dentro del page tree. `fixed bottom-0` se eligió sobre `sticky bottom-0` porque el shell main no es scroll container — el body scrollea, así que sticky pinearía al fondo del último contenido, no de la viewport. El cambio es una línea en `app-shell.tsx`; sin ADR propio (es ajuste mecánico de una decisión ya documentada en R.2 spec § 4).
  - **Diff vs spec original 21.2**: el avatar 36×36 izq queda diferido — el composer hoy no recibe info del viewer. Anotado como follow-up de R.6 para evaluar si suma a la UX o no.

### 21.3 Excepciones intencionales (NO migrar al handoff literal)

- **6 emojis de `ReactionBar`** (decisión F.A) vs ♥ simple del handoff. La spec ya documenta los 6 emojis en § 3 — el rediseño respeta esa decisión.
- **TipTap rico en composer** (decisión F1) vs textarea plano del handoff. Mantenemos el editor full con allowlist (§ 12) y toolbar.
- **URL `/conversations/[postSlug]`** (decisión F.F) vs `/t/[threadId]` del handoff. Mantenemos la URL canónica del producto.
- **Share button**: SKIP en R.6 (no existe en producto, fuera de scope F1, no es decisión de producto).
- **Pull-to-refresh**: SKIP (igual que el macro handoff sugiere).
- **Overflow menu** del header detail: usa `<PostAdminMenu>` existente (admin only), no construye menu nuevo. Para non-admin queda vacío en R.6 (futuro: Reportar/Silenciar).

### 21.4 Filter pills (R.6 follow-up cerrado 2026-04-30)

**Estado actual** (commits `b619429` backend + frontend follow-up):

- **`Todos`** (default): sin query param. URL limpia: `/conversations`.
- **`Sin respuesta`** (`unanswered`): posts sin comments activos
  (`comments: { none: { deletedAt: null } }`). URL: `/conversations?filter=unanswered`.
- **`En los que participo`** (`participating`): viewer es autor del
  post O hizo al menos un comment activo. URL:
  `/conversations?filter=participating`. Requiere viewer autenticado;
  defensive empty list si se invoca sin viewer.

**Arquitectura del filter**:

- URL query param `?filter=` como source of truth (no React state
  local). Server lee con `searchParams`, SSR-renderea la lista
  filtrada. Browser back/forward + refresh + links compartibles
  funcionan.
- `parsePostListFilter` en `discussions/domain/filter.ts` (Zod enum
  `.catch('all')`) defensivo para inputs inválidos en URL.
- `<ThreadFilterPills>` Client Component lee con `useSearchParams` y
  actualiza con `router.replace` (no `push` — el filter cambia view de
  la misma "página", browser back debe salir a la zona anterior).
- `listPostsByPlace` acepta `filter?: PostListFilter`. Helper
  `buildFilterWhere` construye el where parcial. Cursor + filter
  coexisten — paginación preserva el filter.
- `loadMorePostsAction` schema acepta `filter` opcional.
  `<LoadMorePosts>` lo propaga en cada page.
- `<EmptyThreads>` acepta `filter` prop y rota copy + CTA según el
  filter activo. Solo `all` mantiene CTA "Nueva discusión"; los otros
  son "estás al día" calmos.

**Tests**:

- Unit: `filter.test.ts` (parse defensivo) +
  `list-posts-filter.test.ts` (3 cases del where) +
  `thread-filter-pills.test.tsx` (URL state + click + a11y).
- E2E: opcional, defer.

**Performance**:

- `unanswered` → `NOT EXISTS Comment` subquery, cubierto por índice
  `Comment(postId)`.
- `participating` → `OR + EXISTS` subquery con `authorUserId`. Para
  150 members, OK con partial indices existentes en migrations.
  Si EXPLAIN muestra seq scan en producción, agregar migration con
  composite index `Comment(authorUserId, postId, deletedAt)` —
  documentar en gotchas.

### 21.5 Data shape extendida (`PostListView` en `domain/types.ts`)

Campos nuevos a agregar (R.6.1):

- **`snippet: string`** — primeros 140 chars del `body` plain text. Helper server-side `richTextExcerpt(body, 140)` (verificar si ya existe en el slice; si no, agregar a `discussions/server/`). Strip de marks/links/mentions, solo concatena texto plano.
- **`commentCount: number`** — count de comments del post con `deletedAt IS NULL`. Soft-deleted excluidos (consistente con la UI que no los muestra como números).
- **`readerSample: ReaderForStack[]`** — top 4 reader IDs por post de la apertura actual. Cada elemento: `{ userId, displayName, avatarUrl }`. Para `<ReaderStack>` en cada row.
- **`isFeatured: boolean`** — derivado, no persistido. `true` para el primer thread por `lastActivityAt` en la response. Cero schema change.

Performance: el query `listPostsByPlace` agrega 1-2 sub-queries por request (count batch + readers batch). Paralelizables vía `Promise.all`. Index `(postId, placeOpeningId)` ya existente cubre el `readerSample`. Performance ya validada en patrón `listReadersByPost` del PostReadersBlock.

### 21.6 Componentes del rediseño

**Nuevos en `discussions/ui/`**:

- `<ThreadsSectionHeader>` (server) — chip + título + CTA.
- `<ThreadFilterPills>` (client) — 3 pills, local state (router refresh con query param en follow-up; en R.6 solo `Todos` funcional).
- `<FeaturedThreadCard>` (server) — featured layout.
- `<ThreadRow>` (server) — row simple sin card chrome.
- `<EmptyThreads>` (server) — emoji + copy + CTA.
- `<ThreadHeaderBar>` (server, slot props) — sticky top del detail.

**Nuevos en `shared/ui/`** (primitivos puros, agnósticos del dominio):

- `<BackButton>` — client component. `useRouter().back()` con fallback `<Link>` si no hay history. Recibe `fallbackHref` y `label` por prop.
- `<ReaderStack>` — recibe `readers: { userId, displayName, avatarUrl }[]` y `max?: number` (default 4). Compone N `<MemberAvatar>` con overlap negativo + `+N` chip cuando hay más. Mismo pattern visual que `<AttendeeAvatars>` de events.

**Reescrituras en `discussions/ui/`**:

- `<PostList>` → reescrito (compone SectionHeader + FilterPills + Featured + Rows). Nombre `PostList` preservado para no romper la API pública del slice; conceptualmente es un `<ThreadList>`.
- `<PostCard>` → eliminado, reemplazado por `<FeaturedThreadCard>` + `<ThreadRow>` (split por modo).
- `<PostDetail>` → restyle (title 28px, body spacing). El kebab `<PostAdminMenu>` ya NO se monta dentro — se mueve al slot derecho de `<ThreadHeaderBar>` desde la page composer.
- `<CommentThread>` + `<CommentItem>` → restyle (28px avatar `MemberAvatar`, sin card chrome, hairline divider externo).
- `<QuotePreview>` → restyle (border-l-2 accent + italic muted).
- `<CommentComposer>` → restyle (`fixed bottom-0` con `safe-area-inset-bottom`, editor TipTap full + send button round 40×40 accent con icono `Send` lucide; ver § 21.2).
- `<ReactionBar>` → restyle visual (chips planos `border-[0.5px]` con `bg-accent/10` cuando activo; mantener 6 emojis y data flow intactos).
- `<PostReadersBlock>` → restyle reusando `<ReaderStack>` (max 5 + count "{n} leyeron").

**Intactos en R.6** (sin cambios):

- `<ThreadPresence>` (Realtime presence)
- `<DwellTracker>` (PostRead tracking ≥5s)
- `<RichTextEditor>` (TipTap setup, toolbar, allowlist)
- `<RichTextRenderer>` (renderer SSR)
- `<EventMetadataHeader>` (montado arriba del PostDetail cuando `post.event`, F.F)
- `<EditWindowActions>` / `<EditWindowForm>` (edit 60s)
- `<FlagButton>` / `<FlagModal>` (reportes)
- `<LoadMorePosts>` / `<LoadMoreComments>` (paginación cursor keyset)
- `<PostAdminMenu>` (admin kebab — MOVIDO al slot derecho de `<ThreadHeaderBar>`, sin cambiar lógica)

### 21.7 Sub-fases de implementación (R.6.1 → R.6.5)

| Sub          | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R.6.1** ✅ | Helper `richTextExcerpt` server + extensión `PostListView` con `snippet`, `commentCount`, `readerSample`. Tests del query.                                                                                                                                                                                                                                                                                                                                                                       |
| **R.6.2** ✅ | `<BackButton>` en `shared/ui/` + `<ReaderStack>` en `discussions/ui/` (vive en el slice porque consume `<MemberAvatar>` — boundary clean: shared no conoce el dominio "miembro"). Tests.                                                                                                                                                                                                                                                                                                         |
| **R.6.3** ✅ | Slice `discussions/ui` rewrite list: `<ThreadsSectionHeader>`, `<ThreadFilterPills>`, `<FeaturedThreadCard>`, `<ThreadRow>`, `<EmptyThreads>`. Reescritura del export `PostList` (nombre preservado). `<PostCard>` eliminado. Page `/conversations/page.tsx` reducida (header en SectionHeader). `loading.tsx` actualizado. Split `members/public.ts` + `public.server.ts` para que el chain de Server Components consumiendo MemberAvatar no rompa el bundle cliente.                           |
| **R.6.4** ✅ | Thread detail rewrite: `<ThreadHeaderBar>` (sticky 56px) + restyle de `<PostDetail>`, `<CommentThread>`, `<CommentItem>`, `<QuotePreview>`, `<CommentComposer>` (fixed bottom), `<ReactionBar>`, `<PostReadersBlock>`. **Gap shell viewport resuelto** cambiando `<main>` de `overflow-hidden` → `overflow-x-hidden` (preserva clip horizontal previsto para swipe R.2.5, libera scroll vertical para fixed/sticky). Tests adaptados (`post-readers-block.test.tsx` reescrito para nuevo shape). |
| **R.6.5** ✅ | Cleanup + verificación full (typecheck, lint, 788 unit tests, build prod limpio) + update spec § 21 con diff descubierto + update roadmap.md con R.6 ✅. Manual QA del thread detail (sticky header, fixed composer, presence + dwell) confirmado por user.                                                                                                                                                                                                                                      |

### 21.8 Follow-ups post-R.6 (anotaciones, no in-scope de R.6)

Notas de producto registradas durante R.6 para no perder contexto. **Cada
follow-up requiere su propio mini-spec + ADR antes de implementarse** — la
anotación acá no es decisión, es memoria.

- **FAB cross-zona** ✅ (R.2.6, 2026-04-26) — reemplazadas las CTAs
  "Nueva" / "Proponer evento" embebidas en SectionHeaders por un único
  botón flotante en el shell. Implementado como `<FAB>` shared
  primitive + `<ZoneFab>` orquestador en shell — sin slice `actions/`
  (overhead injustificado para 2 acciones; diferido a Library R.5).
  Ícono `Sparkles` (no `+` ni hamburger por escalabilidad a perfil/
  settings + no chocar con swipe). Solo zonas root vía
  `isZoneRootPath`. Specs en `docs/features/shell/spec.md` § 17 + ADR
  `docs/decisions/2026-04-26-zone-fab.md`.
- **Filtros reales en `<ThreadFilterPills>`** ✅ (R.6 follow-up,
  2026-04-30). Extendido `listPostsByPlace` con `filter: 'all' |
'unanswered' | 'participating'`. Estado en URL query param.
  Empty states contextualizados. Ver § 21.4.
- **Featured admin pinning** — alternativa al heurístico actual (primer
  post por `lastActivityAt`). Requiere schema change (`Post.pinnedAt` o
  similar) + UI en admin overflow + ADR propio. Diferido salvo que producto
  pida explícitamente.
- **Overflow menu non-admin** — el slot derecho del `<ThreadHeaderBar>`
  hoy queda vacío para non-admin. Futuro: poblar con "Reportar",
  "Silenciar tema", "Compartir" según producto.
- **Snippet con marcas markdown preservadas** — `richTextExcerpt` actual
  devuelve plain text. Si producto pide, evaluar variante que preserve
  bold/italic inline (sin links ni bloques) para los snippets.

---

Este spec es canónico. Cualquier cambio estructural se agrega con fecha en `docs/decisions/`.
