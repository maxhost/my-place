# ADR — Post hard delete + admin bypass 60s

- **Fecha:** 2026-04-21
- **Contexto:** C.G.1 (moderación inline)
- **Estado:** Aceptada e implementada

## Decisión

**Post borrado = hard delete.** La columna `Post.deletedAt` desaparece del
schema. El estado `DELETED` del dominio desaparece. Borrar un post remueve la
fila — y con ella, vía FK `ON DELETE CASCADE`, sus `Comment` y `PostRead`.
Las tablas polimórficas (`Reaction`, `Flag`) se limpian a mano dentro de la
misma `prisma.$transaction` que termina con `post.delete`.

**Comment borrado = soft delete.** `Comment.deletedAt` se mantiene. El body
se reemplaza con `[mensaje eliminado]` pero la fila queda en el thread para
preservar estructura de respuestas y citas.

**Admin bypass 60s.** `canEditPost` y `canDeleteContent` devuelven `true`
para `actor.isAdmin` sin chequear ventana. Autor normal: 60s como antes.

## Motivación

### Por qué hard delete para Post

1. **Limpieza**: un post "eliminado" que queda como fila oculta contamina
   queries (todas deben filtrar por `deletedAt IS NULL`), índices y
   observability. En la práctica nadie jamás re-visita un post borrado.
2. **Cascade gratis**: el FK `Comment.postId ON DELETE CASCADE` ya borra
   los comments; `PostRead.postId ON DELETE CASCADE` limpia lecturas. Sólo
   tenemos que manejar polimórficos a mano.
3. **Derecho al olvido**: cuando el autor borra su post, el rastro debe
   desaparecer — consistente con el principio del producto de no
   perpetuar contenido no deseado.

### Por qué soft delete para Comment

Un comment borrado en medio de un thread rompería la narrativa si
desapareciera. El placeholder `[mensaje eliminado]` preserva la estructura
y el lector entiende que algo hubo. Los quotes apuntando al comment borrado
se renderizan con `contentStatus: 'DELETED'` sin romper el render.

### Por qué admin bypass 60s

La ventana de 60s protege al autor de edits impulsivos; no debe bloquear
la moderación. El admin que ve contenido fuera de tema semanas después tiene
que poder eliminarlo. Editar post de otro es menos común, pero se habilita
por simetría y para correcciones explícitas (typo en título que genera
confusión). Queda auditado en pino con `byAdmin: true`.

## Implementación

### Schema (migración manual vía Supabase SQL Editor, no archivo Prisma)

```sql
ALTER TABLE "Post" DROP COLUMN "deletedAt";
-- FK cascades ya existían; nada más que agregar.
```

Se retiró el índice que incluía `deletedAt` (queda sólo el `createdAt DESC`
para listado). `schema.prisma` refleja la columna removida.

### `hardDeletePost`

Vive en `src/features/discussions/server/hard-delete.ts` con `import
'server-only'`. Se expone vía `discussions/public.server.ts` (no `public.ts`
— evita tirar `server-only` al bundle cliente). Orden dentro de la tx:

1. `comment.findMany` → ids para cleanup polimórfico de hijos
2. `reaction.deleteMany` (targetType POST + COMMENT de los hijos)
3. `flag.deleteMany` (mismo scope)
4. `post.delete` (CASCADE dispara en `comment` y `postRead`)

### `deletePostAction`

- Carga post + chequea `canDeleteContent` (admin bypass built-in)
- Optimistic lock: `post.version === expectedVersion` antes de tx
- Delega a `hardDeletePost`
- Log `{ event: 'postDeleted', actorRole, byAdmin }`
- Revalida `/{placeSlug}`, `/{placeSlug}/conversations`,
  `/{placeSlug}/conversations/{slug}`

### `reviewFlagAction` + `sideEffect: DELETE_TARGET` sobre POST

No puede correr dentro de la misma `$transaction` de update del Flag porque
`hardDeletePost` tiene su propia `$transaction` y además borra el flag
polimórficamente. Solución:

1. Fuera de tx: `updateMany({ where: { id, status: 'OPEN' }, ... })` claim del flag (race guard)
2. Si `count === 0` → `NotFoundError` (otro admin ganó)
3. `await hardDeletePost(postId)` — limpia el flag ya reviewed como parte del cleanup polimórfico

La divergencia vs "admin elimina directo" se acepta: son paths con intent
distinto (flag review vs moderación ad-hoc) y el audit trail en pino los
distingue por `event`.

### `editPostAction`

Reemplaza `assertEditWindowOpen` + check `authorUserId === actor.userId` por
un único `canEditPost(actor, authorUserId, createdAt, now)`. Slug sigue
siendo inmutable en edits (no se regenera aunque cambie el título — romper
URLs ya compartidas es peor que el desalineo).

### UI

- `PostAdminMenu` (kebab en `PostDetail` cuando `viewerIsAdmin`): Editar /
  Ocultar-Mostrar / Eliminar. Editar navega a `/conversations/new?edit=<id>`.
- `CommentAdminMenu` (kebab en `CommentItem` cuando `viewerIsAdmin`):
  Eliminar (soft). Coexiste con `EditWindowActions` cuando admin es autor
  dentro de los 60s — los dos llevan al mismo `deleteCommentAction`, pero
  el menú sigue funcionando tras expirar la ventana.
- `/conversations/new` es un único route que sirve crear (sin searchParam)
  y editar (con `?edit=<postId>`). La misma componente `<PostComposer>` muta
  según `mode.kind`. La ruta `/conversations` pasa de tener composer inline
  a un Link "Nueva conversación".
- `/settings/flags` ahora tiene tabs Pendientes / Resueltos + paginación 20
  (cursor encoded como `createdAt.toISOString():id`). La cola resuelta es
  read-only: no renderiza botones de acción, sólo metadata de review.

### Dropdown primitive

Nuevo wrapper `src/shared/ui/dropdown-menu.tsx` sobre
`@radix-ui/react-dropdown-menu` — same pattern que `dialog.tsx` (theme via
CSS vars, z-index 50).

## Alternativas consideradas

### Soft delete uniforme (post + comment)

Descartada. Agrega un `IS NULL` a cada query que pasa por Post. La "recuperación"
de un post borrado no es un caso real.

### Hard delete también para comments

Descartada. Rompe la narrativa del thread. Los quotes del comment borrado
tendrían que buscar algún otro pin.

### Admin NO bypasea 60s (siempre usa hide)

Descartada. Obliga a moderación pasiva (ocultar en vez de limpiar). El
producto quiere que el admin tenga el cuchillo, no sólo el velo.

## Revisión futura

- **Audit log persistido**: hoy pino es la fuente. Post-MVP: tabla
  `AuditEvent` con `actorId`, `kind`, `targetKey`, `context`.
- **Undo window corto para delete**: si aparece el caso de "borré sin
  querer", un 10s de ventana para revertir `hardDeletePost` no es gratis
  (requiere soft intermedio), así que sólo lo implementamos si surge la
  fricción.
