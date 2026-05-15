# Switch RLS — diseño production-grade (cero service-role, cero bypass)

Estado: **diseño para aprobar**. No implementado. Restricción dura del
owner: **nada bypasea RLS — ni el bootstrap de identidad, ni los crons,
ni el sistema**. RLS gobierna _todo_ acceso a datos; lo único que varía
es _qué principal_ hace la query y _qué policies_ lo habilitan.

Supera el borrador previo (que proponía `withServiceRole` para queries
exentas — eso es un bypass y queda **descartado**).

## 1. Principio rector

No existe ningún rol que ignore RLS. Toda query Prisma corre como uno de
**tres principales**, cada uno con policies explícitas:

| Principal       | Claim                                                                                                   | Cuándo                                                         | Gobernado por                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated` | `{ sub: <userId>, role: 'authenticated' }`                                                              | request con sesión                                             | policies que comparan `auth.uid()`                                                                                                                |
| `anon`          | `{ role: 'anon' }`                                                                                      | request sin sesión (landing, preview de places discoverable)   | policies explícitas para anónimo (ej. `Place` discoverable)                                                                                       |
| `System`        | rol PG dedicado `System` (opción **A**) + `FORCE ROW LEVEL SECURITY` en todas las tablas (opción **B**) | crons/jobs sin usuario (anonimización 365d, openings, erasure) | **policies RLS propias, mínimas y auditadas** por job — NO bypass. Con `FORCE`, ni el dueño de las tablas ni nadie puede saltar RLS, ni por error |

**Dos caminos para "mostrar el carnet"** (decisión 3.3): el usuario lo
toma de la cookie de sesión que Supabase verifica (browser). El `System`
**no tiene cookie ni browser**: el job se declara `System`
explícitamente al arrancar (`runWithPrincipal({ principal: 'System' })`),
sin resolver sesión. Mismo control, dos entradas.

El `system` **no es service-role**. service-role = "ignora RLS". `system`
= "es un principal más, sujeto a RLS, con reglas explícitas y acotadas a
exactamente lo que ese job necesita". Diferencia central: si mañana un
bug hace que el cron toque una fila que no debe, **RLS lo frena igual**.

## 2. Bootstrap de identidad SIN bypass

El argumento "para saber quién sos necesitás leer la DB sin RLS" es
**falso** con este diseño:

- El `userId` **no sale de una query** — sale del **JWT que Supabase
  Auth verifica criptográficamente** desde la cookie
  (`getCurrentAuthUser`). Es el _input_, disponible antes de tocar
  Prisma. No hay "query de bootstrap".
- **Primer signup** (`User` aún no existe): el auth callback hace
  `user.upsert` con claim `{ sub: userId }`. Policies de `User`:
  - `User_insert_self`: `WITH CHECK (id = auth.uid()::text)` → el user
    crea **su** fila. Cero bypass.
  - `User_update_self`: `USING/WITH CHECK (id = auth.uid()::text)`.
  - `User_select_self_or_shared`: `id = auth.uid()::text` OR
    `shares_active_place(id)` (helper DEFINER, §4).
    → el bootstrap **se auto-gobierna por RLS**.
- Resolver membership/ownership/permisos: queries normales bajo el RLS
  del propio user (`Membership_select_self`: `userId = auth.uid()::text`,
  etc.). No requiere bypass.

## 3. Helpers `SECURITY DEFINER` — por qué NO son bypass

`is_active_member`, `is_place_admin`, `is_place_owner`,
`shares_active_place`, `is_invitee` (los que las policies invocan en
`USING`/`WITH CHECK`) son `SECURITY DEFINER`, `STABLE`,
`SET search_path = public`.

Esto **no es** "service-role para el helper". Un security-barrier
function:

- Encapsula **una** regla, en su cuerpo SQL fijo y auditado. No expone
  la tabla; sólo responde un booleano.
- No puede hacer nada fuera de su cuerpo. `is_active_member` solo puede
  responder "¿este user es miembro activo de este place?" — no leer
  contenido arbitrario.
- Es el patrón canónico Postgres para romper recursión de policies (una
  policy de `Post` que pregunta `is_active_member` que lee `Membership`
  que tiene su propia policy → sin DEFINER, recursión infinita o deny
  espurio).

Distinción que importa: **DEFINER acotado en un helper de 1 regla ≠
service-role global que ignora todo**. El primero es RLS bien hecho; el
segundo es el bypass que estamos eliminando.

## 4. Mecanismo (el wrapper)

- `AsyncLocalStorage<{ principal: 'authenticated'|'anon'|'system';
userId?: string }>`.
- **Boundary**: un helper `runWithPrincipal(fn)` que cada server action,
  RSC de datos, route handler y job invoca al entrar. El `userId` sale
  de `getCurrentAuthUser()` (verifica el JWT de la cookie; ya cacheado
  con `React.cache`).
- `db/client`: el acceso a Prisma pasa por un wrapper que ejecuta cada
  operación dentro de una tx que **primero** corre
  `SET LOCAL ROLE <principal>` + `SELECT set_config('request.jwt.claims',
$json, true)`. Los `~20 $transaction(async tx => …)` interactivos
  existentes: se inyectan esas 2 sentencias como **primeras del
  callback** — siguen siendo _una_ tx, no se anidan. Ops sueltas:
  promovidas a tx de 1 operación.
- **Sin `$extends`** (infla los tipos de `$transaction` — `db/client.ts`
  ya lo rechaza). El wrapper vive fuera del tipo de `PrismaClient`.
- **Falla CERRADA** (≠ borrador previo): si no hay principal en el ALS
  → **error**, no "service-role por default". Nada corre sin principal
  explícito. Un lint prohíbe `import { prisma }` fuera del wrapper.

## 5. Pooler 6543 — precondición dura (spike obligatorio)

El gotcha del harness (`SET LOCAL` no persiste en 6543) es por **scope
multi-statement**, no por el pooler en sí: PgBouncer transaction-mode
mantiene **una** conexión backend durante toda la tx, y `SET LOCAL` está
acotado a esa tx. Entonces `SET LOCAL ROLE + set_config + queries`, todo
dentro del **mismo `BEGIN/COMMIT`**, _debería_ funcionar en 6543 sin
mover el runtime a session mode.

**CONFIRMADO EMPÍRICAMENTE (spike 2026-05-15).** Script puntual contra
`DATABASE_URL` (host `aws-1-us-east-2.pooler.supabase.com`, **puerto
6543**, transaction pooler): dentro de una tx, `SET LOCAL ROLE
authenticated` + `set_config('request.jwt.claims', …, true)` →
`current_user` = `authenticated` y `auth.uid()` devolvió el `sub`
pasado. **Funciona en 6543 intra-tx.** NO se mueve el runtime a session
mode; se mantiene `DATABASE_URL`/6543 y los límites de conexión
serverless actuales. Riesgo #1: **despejado**.

## 6. Sin botón de emergencia (decisión del owner 2026-05-15)

**NO hay flag de reversibilidad.** Decisión explícita del owner: se
aplica el switch y, si rompe todo, se reescribe. Sin
`RLS_ENFORCED`, sin código condicional, sin modo bypass. Más simple: el
único code-path es el estricto. No existe forma de "volver atrás" por
config — el bypass deja de existir en el codebase.

## 7. Performance — minimizar (decisión 3.8: lo más rápido posible)

Restricción del owner: el usuario real **no** debe pagar costo extra
por cada acción. Diseño en consecuencia:

- El carnet se muestra **una vez por request**, NO una vez por consulta.
  Todas las queries de una página/acción corren dentro de **una sola
  transacción** con `SET LOCAL ROLE` + `set_config` ejecutados una vez
  al inicio. Costo extra = **1 round-trip por request**, amortizado
  entre todas sus queries. `SET LOCAL` en sí es memoria de conexión
  (≈0).
- Honesto: **cero absoluto no es posible con Prisma + RLS** — setear el
  carnet en la conexión es inherente. El mínimo es ese 1
  round-trip/request (despreciable, no por-acción). Cero-cero solo
  existe con el modelo Supabase-client (carnet en header HTTP, sin tx
  extra) = el debate de stack ya tenido. **Decisión del owner pendiente:
  ¿este mínimo por-request es aceptable, o reabre el stack?**
- No se optimiza prematuramente más allá del agrupado por request.

## 8. Plan de adopción (fundación primero)

1. **Spike 6543** (riesgo #1). Bloqueante. Decide pooler vs session.
2. Mergear wrapper + ALS + `runWithPrincipal` + flag con
   `RLS_ENFORCED=false` → cero cambio de comportamiento, code-path nuevo
   en su lugar.
3. Construir las policies base (identity/access + grupos) con helpers
   DEFINER — ya documentadas en `docs/rls/`.
4. Activar `RLS_ENFORCED=true`. **Acá rompe lo que esté mal** — esperado
   y buscado: es el fail-fast que el owner quiere, ahora _diagnosticable_
   (cada feature falla aislada con su policy, no apagón ciego).
5. Reconstruir features sobre esta fundación, RLS día 1, owner journey
   primero. El harness RLS es la red de seguridad de cada policy.

**Al cerrar el diseño** (decisión del owner): mover/consolidar este doc
en `docs/prisma/` y **actualizar `CLAUDE.md` + `docs/architecture.md`**
para que reflejen el modelo real (RLS gobierna todo acceso; rol
`System`; sin service-role; carnet por request) — eliminar el
desfasaje de docs que veníamos arrastrando. Es parte del trabajo de
cierre, no opcional.

## 9. Riesgos honestos

1. **`SET LOCAL` en 6543 sin validar.** Mitiga: spike bloqueante (§5).
2. **Cobertura del boundary.** Si un entry point no llama
   `runWithPrincipal`, su query **falla cerrada** (error), no bypassa.
   Mitiga: lint anti-`import prisma` + el error es visible (no
   silencioso). Es un costo de desarrollo, no un agujero.
3. **`system` con policies mal acotadas.** Un job con una policy
   `system` demasiado amplia ≈ bypass de facto. Mitiga: cada policy
   `system` se escribe por-job, mínima, revisada, y se testea en el
   harness como un principal más.
4. **Performance de lecturas sueltas.** Medir en spike; aceptar o
   pipelining.

## 10. Decisiones abiertas para el owner

- ¿Rol PG dedicado `system_worker` (login propio, GRANTs mínimos) o
  reusar `service_role` de Supabase **con RLS forzada** (`FORCE ROW
LEVEL SECURITY` en las tablas, para que ni service_role bypasse)?
  Recomiendo `FORCE ROW LEVEL SECURITY` + claim `system` — más simple,
  garantiza que NADIE bypassa ni por error.
- ¿Anon tiene acceso (landing/preview discoverable) o todo exige sesión?
  (define si existe el principal `anon` o solo `authenticated`/`system`).
- Confirmar el spike antes de comprometer el patrón.
