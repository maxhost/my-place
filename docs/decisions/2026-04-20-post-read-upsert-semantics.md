# `PostRead` upsert monótono: `DO NOTHING` → `DO UPDATE`

**Fecha:** 2026-04-20
**Milestone:** Fase 5 / C.F.1 (fix del dot indicator)
**Autor:** Max
**Estado:** Implementada (2026-04-20)

## Contexto

El indicador ámbar ("dot") del listado `/conversations` se deriva client-side:

```
lastReadAt = max(PostRead.readAt WHERE userId = me AND postId = p)
showDot = post.lastActivityAt > lastReadAt
```

Durante QA manual con dos usuarios se reprodujo un bug:

1. User A lee un post (dwell 5s) → `PostRead` insert, `readAt = T0`.
2. User B comenta en el post → `Post.lastActivityAt = T1 > T0`. Dot aparece para A.
3. User A vuelve al listado, ve el dot, re-entra al post, dwellea 5s otra vez.
4. **Bug:** el dot persiste indefinidamente dentro de la misma apertura.

## Raíz del problema

`markPostReadAction` usaba `INSERT ... ON CONFLICT DO NOTHING`:

```ts
try {
  await prisma.postRead.create({ data: { postId, userId, placeOpeningId, dwellMs } })
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    recorded = false
  } else throw err
}
```

En el paso 3 del repro, el conflicto por UNIQUE `(postId, userId, placeOpeningId)` se
capturaba silenciosamente. `readAt` quedaba congelado en `T0`, nunca alcanzando `T1`.
El dot sólo se apagaba cuando la apertura rotaba y se insertaba una nueva fila.

Invariante 7 original decía literalmente `ON CONFLICT DO NOTHING` — la implementación
era fiel a la spec. El bug era de la spec.

## Alternativas consideradas

- **A — Remover `placeOpeningId` del UNIQUE.** Quedaría `(postId, userId)` UNIQUE.
  Upsert update siempre, sin columna de apertura. **Descartada:** rompe la semántica
  de "quién leyó durante esta apertura" que usa §9 y el bloque futuro "leyeron esta
  noche" (planificado post-MVP).
- **B — Insertar una nueva fila por re-lectura (sin UNIQUE, event log puro).**
  Bloat lineal en table size; groupBy más costoso; y duplica trabajo que resuelve
  un upsert atómico. Descartada.
- **C — Prisma `upsert()` nativo** con `update: { readAt: new Date(), dwellMs: ... }`.
  **Descartada:** (i) no expresa `GREATEST(existing, new)` sin read+write race, y
  (ii) `new Date()` es clock del app server, no de la DB — en un setup multi-region
  o con clock skew puede retroceder.
- **D — Cambiar la semántica del dot** (ej: `lastReadAt` cross-apertura via cache
  client-side). Descartada: requiere otro indexamiento y no arregla el "durante la
  misma apertura no funciona".

## Decisión

`INSERT ... ON CONFLICT DO UPDATE` via `$queryRaw`, con `GREATEST` y `now()`
server-side y `RETURNING (xmax = 0) AS inserted` para distinguir insert vs update:

```sql
INSERT INTO "PostRead" ("id","postId","userId","placeOpeningId","dwellMs","readAt")
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT ("postId","userId","placeOpeningId")
DO UPDATE SET
  "readAt"  = now(),
  "dwellMs" = GREATEST("PostRead"."dwellMs", EXCLUDED."dwellMs")
RETURNING (xmax = 0) AS inserted
```

Propiedades clave:

- **Atómico.** Un único statement — no hay race entre SELECT y UPDATE.
- **Monótono.** `readAt` avanza siempre (`now()` es clock de Postgres, monotonic
  dentro del nodo). `dwellMs` nunca retrocede por `GREATEST`.
- **Clock server-side.** Evita skew entre app y DB.
- **Observabilidad.** `xmax = 0` cuando fue insert (tuple no tenía ancestor);
  `xmax <> 0` en update. El action lo retorna como `recorded: boolean` y logea
  `event: 'postReadRecorded'` vs `'postReadUpdated'`.
- **Sin retry, sin try/catch por P2002.** La path P2002 desaparece.

## Invariante 20 (nuevo)

El upsert resuelve el lado del `readAt`. El otro lado del contrato del dot —
`lastActivityAt` — requiere su propio lockeado:

> **Invariante 20:** `Post.lastActivityAt` sólo lo bumpean `createPostAction` y
> `createCommentAction`. Ninguna otra acción (reactions, flags, moderación, edits,
> reads, soft-delete) lo toca.

Auditoría exhaustiva (grep `lastActivityAt`, revisión de cada action que modifica
`Post`) confirmó que el comportamiento actual ya cumple el invariante; sólo faltaba
documentarlo y protegerlo con tests. Sin el invariante 20, un contributor futuro
podría "ayudar" a que la edición de un post marque a otros como no leído, resucitando
la clase de bug que este ADR resuelve.

`__tests__/last-activity-bumps.test.ts` captura el invariante por enumeración:
cada action del slice se ejercita contra un post con un `lastActivityAt` conocido y
se verifica que sólo las dos esperadas lo bumpean.

## Consecuencias

**Positivas:**

- Dot se apaga en re-lectura dentro de la misma apertura.
- Telemetría distingue first-read de re-read (`event: 'postReadUpdated'` confirma que
  el fix está ejercitándose en prod).
- `DwellTracker` sigue idempotente sin cambios cliente: el tracker fija `firedRef`
  tras el primer fire; el próximo mount genera un nuevo fire que ahora actualiza
  en lugar de noop.

**Negativas / costos:**

- `$queryRaw` es menos auditable que Prisma API. Mitigado con `Prisma.sql` tagged
  template (evita SQL injection) y test directo.
- Cambio de tipo del retorno de `prisma.postRead.create` → array de una fila. El
  action abstrae esto: sigue retornando `{ ok: true, recorded: boolean }`.

**Sin deuda nueva.**

## Referencias

- Fix: `src/features/discussions/server/actions/reads.ts`
- Spec: `docs/features/discussions/spec.md` §8 invariantes 7 y 20, §9 paso 4, §13
- Tests: `src/features/discussions/__tests__/last-activity-bumps.test.ts`,
  `src/features/discussions/__tests__/reactions-flags-reads.test.ts`
- Plan original (Fase 5 / C.F): `.claude/plans/gleaming-chasing-comet.md`
