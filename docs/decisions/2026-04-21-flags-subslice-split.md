# Split de `flags` como sub-slice autónomo de `discussions`

**Fecha:** 2026-04-21
**Milestone:** Fase 5 / C.G (Moderación UI — flag modal + cola admin)
**Autor:** Max

## Contexto

El backend de flags nació dentro de `features/discussions/` en C.D (acciones
`flagAction` / `reviewFlagAction`, queries `listFlagsByPlace` / `countOpenFlags`,
schema Prisma `Flag` con UNIQUE + RLS, 6 tests unit). Vivió allí bajo la
excepción de tamaño autorizada en
`docs/decisions/2026-04-20-discussions-size-exception.md`, con punto de
revisión explícito en C.F/C.G: si la UI de moderación empujaba a `discussions`
todavía más arriba, había que extraer a `features/flags/`.

En C.G la UI suma (flag modal para miembros + cola admin + queue item con
acciones) ~400 LOC. Sin split, `discussions` cerraría C.G ~5 450 LOC. Con
split, `discussions` baja a ~4 685 y `flags` nace con ~1 400 — ambos dentro de
su régimen.

Además de tamaño, el split responde a una razón de diseño más estructural:
flags es **cross-cutting**. Hoy aplica a Post/Comment; en el backlog aparece
también para Event y potencialmente DMs. Dejarlo pegado a `discussions`
obligaba a un segundo split futuro con más callsites afectados.

## Decisión

Crear `src/features/flags/` como slice autónomo con su propia UI, dominio,
server, schemas y tests. Cerrar la superficie pública en dos archivos:

- `public.ts` — API client-safe (tipos, invariants, errors, schemas Zod,
  `mapFlagToView` puro, Server Actions `flagAction` / `reviewFlagAction`,
  componentes UI `FlagButton` / `FlagQueueItem`).
- `public.server.ts` — API server-only (`listFlagsByPlace`, `countOpenFlags`,
  `listFlagTargetSnapshots`). Lleva `import 'server-only'` para que Next
  rompa el build si algún Client Component la consume por accidente.

### Boundary client vs server

La decisión de dos archivos públicos viene de un build-break concreto: cuando
un Server Component (`CommentItem`) que importa `FlagButton` desde
`@/features/flags/public` se renderiza bajo un Client Component
(`LoadMoreComments`), Next traza todo el módulo `public.ts` al bundle cliente.
Si `public.ts` re-exporta queries con `import 'server-only'`, el build
falla con:

> You're importing a component that needs "server-only". That only works in a
> Server Component which is not supported in the pages/ directory.

La solución canónica es **segmentar la superficie pública**: lo que puede
viajar al cliente (componentes marcados `'use client'`, acciones `'use server'`,
tipos, mappers puros) vive en `public.ts`; lo que nunca debe viajar (queries
que tocan Prisma) vive en `public.server.ts`. Consumidores server (pages,
layouts) importan de ambos archivos; consumidores client importan sólo del
primero.

El test `tests/boundaries.test.ts` se actualizó para aceptar `public.server`
como entry point válido del slice. El pattern ESLint
`@/features/*/!(public)` lo permite por prefijo; el test lo valida
explícitamente.

## Extensiones al action `reviewFlagAction`

El action original sólo updateaba el Flag. La cola admin pide combinar review

- side effect (hide/delete) en una sola operación — encadenarlos cliente-side
  es frágil: si falla entre los dos, el state queda incoherente.

### Schema ampliado

```ts
const reviewFlagInputSchema = z
  .object({
    flagId: z.string().min(1),
    decision: z.enum(['REVIEWED_ACTIONED', 'REVIEWED_DISMISSED']),
    reviewNote: z.string().max(500).optional(),
    sideEffect: z.enum(['HIDE_TARGET', 'DELETE_TARGET']).nullable().default(null),
  })
  .refine((data) => data.decision !== 'REVIEWED_DISMISSED' || data.sideEffect === null, {
    message: 'DISMISSED no permite sideEffect',
  })
```

### Validación runtime

Tras cargar el flag, antes de abrir la transacción:

```ts
if (sideEffect === 'HIDE_TARGET' && flag.targetType === 'COMMENT') {
  throw new ValidationError('Los comentarios se eliminan, no se ocultan.', ...)
}
```

### Transacción

Dentro del mismo `prisma.$transaction` que hace `flag.updateMany` guarded por
`status: 'OPEN'` (count=0 → `NotFoundError` → rollback automático), se aplica
el side effect directamente sobre `post` o `comment`. Esto **duplica** los
~3 líneas de update que ya existen en `hidePostAction` / `deletePostAction`.
Tradeoff aceptado: el path _"admin aplica moderación vía flag review"_ y
_"admin aplica moderación directa"_ son semánticamente distintos (distinto
actor intent, eventualmente distinto audit event), así que su divergencia
futura es legítima, no deuda.

### Revalidaciones

- Siempre: `/[placeSlug]/settings/flags`.
- `HIDE_TARGET` / `DELETE_TARGET` sobre POST: además `/[placeSlug]/conversations`
  y `/[placeSlug]/conversations/[postSlug]`.
- `DELETE_TARGET` sobre COMMENT: además `/[placeSlug]/conversations/[postSlug]`
  (slug del post padre, obtenido dentro de la tx).

Logs pino estructurados en cada transición:
`{ event: 'flagReviewed', flagId, decision, sideEffect, targetType, targetId, adminUserId }`.

## Duplicación de `resolveActorForPlace`

`discussions/server/actor.ts` exporta `resolveViewerForPlace` /
`resolveActorForPlace` pero no está en su `public.ts`. `flags` necesita la
misma resolución (auth user → membership → role check). No puede importarla
sin cycle ni sin romper el aislamiento.

**Decisión temporal:** duplicar el helper en `flags/server/actor.ts`. Son
~80 líneas, sin estado, con tests implícitos a través de los suites de
actions. Cuando aparezca un tercer slice que necesite la misma resolución
(members ya tiene la suya, events vendrá después), consolidar a
`src/shared/lib/actor.ts` — ahí es agnóstico del dominio.

## Queries batched con nested select

`listFlagTargetSnapshots` resuelve los snapshots del contenido flageado en
**a lo sumo 2 `findMany`** agrupadas en un `$transaction([...])` — O(1)
round-trips independiente del tamaño de la cola.

Para que la cola admin pueda linkear "ver en contexto" tanto de POST como
de COMMENT, el `findMany` de comments incluye `post: { select: { slug: true } }`
como nested select. El snapshot del comment carga `postSlug` sin agregar una
query adicional.

Si el target se eliminó entre el flag y el read, la key no aparece en el
`Map` resultante y el mapper devuelve una `FlagView` con
`contentStatus: 'DELETED'` + preview vacío — estado informativo, no error.

## Impacto

- `discussions/`: 5 085 → ~4 685 líneas. Sigue sobre 1 500 con la excepción
  autorizada. El ADR del split previsto en
  `2026-04-20-discussions-size-exception.md` queda cumplido.
- `flags/`: 0 → ~1 400 líneas. Dentro del cap 1 500, sin excepción.
- `shared/ui/`: nueva carpeta con `dialog.tsx`, `toaster.tsx`, `time-ago.tsx`
  (este último movido desde `discussions/ui/`).
- Tests: +27 suites (schemas, text-excerpt, flag-view-mapper, queries,
  actions side-effect, flag-modal). Total 494 passing.

## Fuera de este ADR

- **Admin toolbar contextual en `PostDetail`** (hide/delete inline sin pasar
  por la cola): queda para C.G.1.
- **AuditLog persistido:** hoy la fuente para compliance son los pino logs.
  Cuando se cree la tabla global, ambos paths (review + moderación directa)
  escriben ahí y el tradeoff de la duplicación de 3 líneas queda neutralizado.
- **Flag sobre Event:** cuando exista Event (post-MVP), el slice `flags` se
  extiende con `targetType: 'EVENT'` sin tocar `discussions`. Es
  precisamente el caso de uso que justifica el split.
