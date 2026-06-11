# ADR-0054 — Un place = un owner: retiro de co-owner y de la transferencia de founder

- **Fecha:** 2026-06-11
- **Estado:** aceptada
- **Relación con ADRs previas:** consecuencia de ADR-0053 (pivot al Substack para podcasts) · supersede ADR-0035 §1/§2 (multi-owner V1 y transferencia founder dejan de ser producto; el patrón WORM-via-DEFINER §4 sobrevive reducido a su mínimo) · refina ADR-0003 (el camino "transferir ownership antes de borrar la cuenta del único owner" muere; queda solo "cerrar el place") · refina ADR-0040 (el slice `place-ownership-actions/` que aquella renombró se elimina) · registra además la decisión sobre invitations (se conservan, destino final diferido al spec del alta pública).

## Contexto

ADR-0035 introdujo multi-owner V1: N owners simultáneos por place, co-owners elevados desde miembros, founder slot transferible — diseñado para el producto pre-pivot (comunidades genéricas co-administradas). Post-ADR-0053, el place es **el podcast de un creador**: el owner es el podcaster y la figura de co-owner no tiene rol en el modelo (decisión del owner 2026-06-11; si algún día aparece el caso "co-host del show", se re-evalúa con ADR nueva sobre el historial git, que conserva todo).

Estado real pre-retiro: la capa app (`place-ownership-actions/`, 717 LOC, 3 Server Actions) tiene un único consumer (menú por fila de `/settings/members`); la capa DB son 3 DEFINERs (`app.elevate_to_owner` 0014, `app.revoke_ownership` 0015, `app.transfer_founder_ownership` 0016) + la tabla `place_ownership` + el helper RLS `app.current_user_owns_place` que usan las policies de las 6 tablas del core.

## Decisión

**Un place = un owner.** Se retira co-owner del producto Y de la DB, con una línea explícita de hasta dónde limpiar:

1. **Capa producto (se elimina):** slice `place-ownership-actions/` completo; el menú por fila de `/settings/members` queda remover-only; se eliminan las keys i18n de elevate/revoke/transfer ×6 locales.
2. **Capa DB (se elimina la superficie de mutación):** migración que dropea las 3 DEFINERs 0014/0015/0016 + sus integration tests. El único camino de escritura sobre `place_ownership` que queda es `app.create_place` (inserta al founder).
3. **Enforcement nuevo:** índice **UNIQUE sobre `place_ownership(place_id)`** — "un place = un owner" deja de ser una convención y pasa a invariante DB-side (ningún bug futuro puede insertar un segundo owner).
4. **Lo que NO se toca (deliberado):** la tabla `place_ownership` (queda como slot 1:1 owner↔place — mapea la relación, las policies la leen), el helper `app.current_user_owns_place` (las policies RLS de las 6 tablas lo usan; funciona igual con 1 owner), `place.founder_user_id` (con un solo owner, founder == owner; la columna y su índice quedan), y `app.remove_member` (el remove de oyentes sigue siendo producto).

### Transferencia de founder: muere

`app.transfer_founder_ownership` exigía target owner pre-existente — sin elevate no hay target posible. Consecuencia de lifecycle (refina ADR-0003): para eliminar la cuenta del único owner de un place activo, el único camino es **cerrar el place** (la pata "primero transferir" desaparece). La exención de la escala de inactividad ("owner de ≥1 place activo") no cambia.

### Invitations: se conservan (decisión registrada, no implementación)

El owner evaluó retirarlas; se decide **conservarlas de momento** por tres razones: (a) hoy son la **única puerta de entrada** de un oyente — el alta self-service desde la página pública (pregunta abierta de ADR-0053) no existe aún; (b) el flujo de invitación contiene la maquinaria resuelta del alta cross-domain (ADR-0046: credencial en apex + branding + silent SSO de vuelta al custom domain) que el botón "Unirse/Suscribirse" de la página pública va a reusar; (c) son la puerta natural de una **comunidad privada** (visibilidad granular ADR-0053 §4). **Destino final diferido al spec del alta pública**: ahí se decide si quedan como mecanismo de comunidades privadas o se retiran. `place.member_invite_quota` (ADR-0037, schema-only, "oyentes invitan oyentes") queda marcado **candidato a morir** en esa misma decisión.

## Alternativas rechazadas

- **Retirar solo la UI y dejar las DEFINERs dormidas** — el owner pidió DB limpia; dropear 3 funciones sin callers es barato y verificable, y el UNIQUE agrega un invariante real. Dormido solo se justificaba si el drop fuera caro (no lo es).
- **Dropear también `place_ownership` y resolver ownership por `place.founder_user_id`** — obliga a reescribir `app.current_user_owns_place` y revalidar las policies RLS de las 6 tablas del core: refactor multi-sesión de la capa de seguridad para cero ganancia funcional. Es donde "limpio" cruza a "complicado" (criterio acordado con el owner).
- **Retirar también invitations** — ver arriba: dejaría al producto sin puerta de entrada hasta el alta pública y tiraría la maquinaria cross-domain que ese feature va a reusar.

## Consecuencias

1. **App:** `-717` LOC del slice + menú simplificado + ~16 keys i18n ×6 locales menos. El contrato `renderRowActions` de `<MembersList>` no cambia.
2. **DB:** migración `0029` (drop 3 DEFINERs + UNIQUE index, con `SET lock_timeout = '5s'` por el DDL del índice y reverse SQL en comentario). El catálogo DEFINER pasa de 18 a 15 funciones. Precondición verificable: ningún place con 2+ owners al aplicar (el CREATE UNIQUE INDEX falla si existieran — fail-loud correcto).
3. **Docs:** `data-model.md` (invariantes multi-owner → single-owner, catálogo DEFINER), `miembros.md` (rol owner sin co-owner). ADR-0035/0040 NO se editan (inmutabilidad) — reciben el banner de superseded vía este registro en el índice.
4. **Tests:** se eliminan los integration tests de las 3 DEFINERs y los unit tests del slice; el test del menú se reescribe al contrato remover-only (TDD: rojo → verde).
5. Si el caso "co-host del show" aparece, se re-evalúa con ADR nueva; todo el código eliminado vive en git (`baseline/pre-s4-single-owner`).
