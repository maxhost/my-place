# 0002 — Roles owner/miembro, reconocimiento de pertenencia, ciclo de vida del handle

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** producto (principio no negociable), ontología de miembros, modelo de datos
- **Supersede:** ajusta el principio "Sin gamificación" de `docs/producto.md`

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Auditoría de la ontología de miembros detectó tres puntos: (1) la ontología declaraba roles "miembro / admin / fundador" mientras el schema tenía `ENUM('MEMBER','ADMIN')` + tabla `place_ownership` (sin "fundador"); (2) el principio no negociable "Sin gamificación" prohibía explícitamente badges/achievements, pero el owner quiere reconocimiento de pertenencia tipo foros 2000s; (3) el handle era "opcional / first-come-first-serve" sin política de liberación, en tensión con el derecho al olvido.

## Decisión

**1. Roles: solo `owner` y `miembro`.** Owner = creador del place o quien otro owner designe; miembro = todo el resto. **No hay rol `admin`**: la administración delegada será una feature futura de **grupos con permisos granulares** que el owner crea (puede armar un grupo "admin" con miembros elegidos). El rol **se deriva**, no se almacena: owner si hay fila en `place_ownership`, si no miembro. Se elimina el `ENUM membership_role` y la columna `membership.role`.

**2. Reconocimiento de pertenencia y rol, sí. Competencia por estatus, no.** Reemplaza el principio "Sin gamificación". Se permite lo que celebra vínculo, permanencia y *tipo de aporte* como un hecho: antigüedad, hitos temporales tranquilos, contribuciones como hechos contextuales, insignias/títulos **cualitativos** por rol o forma de participar (conferidos por estructura o por el owner), y acumulación **colectiva**. Se prohíbe lo que crea comparación, escasez o FOMO: leaderboards, rankings, "top contributor", comparación entre miembros, streaks que se rompen, puntos/karma/niveles por volumen, contadores como estatus, e insignias convertidas en colección competitiva. **Test:** ¿afirma pertenencia/rol, o dispara comparación social o loss-aversion? Canónico en `docs/producto.md`.

**3. Handle: obligatorio, único, auto-asignado, editable, liberado solo al borrar cuenta.** Se asigna un handle random no-usado al crear la cuenta; el usuario puede editarlo (única regla: no colisionar). Se libera para reuso **solo al borrar la cuenta**, no al salir de un place (salir es per-place; el handle es identidad universal).

## Alternativas rechazadas

- **Mantener "Sin gamificación" absoluto.** Rechazada: descarta la mitad sana de los foros 2000s (reconocimiento por antigüedad/rol) que la ciencia (Self-Determination Theory: relatedness) muestra que fomenta pertenencia sin dañar la motivación intrínseca, siempre que no haya comparación.
- **Gamificación con leaderboards/streaks/puntos** (modelo Duolingo/Strava). Rechazada: dispara comparación social y loss-aversion/FOMO — exactamente lo que el DNA cozytech evita.
- **Conservar `ENUM membership_role` como placeholder.** Rechazada: ENUM sin uso real es stale-by-design; el rol se deriva limpio de `place_ownership`. Los grupos futuros traerán su propio modelo de permisos.
- **Handle opcional / FCFS / liberado al volverse ex-miembro de un place.** Rechazada: "ex-miembro" es estado per-place; liberar el handle universal ahí rompería la identidad del usuario en los otros places donde sigue activo.

## Consecuencias

- Acceso a `/settings/*` fuera de horario y moderación = **owner-only** hasta que exista la feature de grupos.
- Fundamento científico del reconocimiento: SDT (autonomía/competencia/relatedness); el reconocimiento sano es conferido y de pertenencia, no comparativo.
- El borrado de cuenta es la operación universal que libera el handle; distinto del flujo per-place de `membership.left_at`.
- Feature futura pendiente: **grupos con permisos granulares** (incluye recrear "admin" como grupo).

## Detalle operativo canónico

- Principio de reconocimiento: `docs/producto.md` § "Principios no negociables de experiencia".
- Roles, handle, derecho al olvido (ontología): `docs/ontologia/miembros.md`.
- Schema e invariantes: `docs/data-model.md`.
- Gate de horario (owner-only): `docs/architecture.md` § "Gate de horario del place".
