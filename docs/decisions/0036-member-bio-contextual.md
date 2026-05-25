# 0036 — Bio contextual del miembro: `headline` per place

- **Fecha:** 2026-05-24
- **Estado:** Aceptada
- **Alcance:** ontología de miembros (refina `docs/ontologia/miembros.md` canon), modelo de datos (nueva columna `membership.headline`), Feature E (members slice V1)
- **Refina:** `docs/ontologia/miembros.md` canon previo "no hay bio escrita por el miembro" / "Tu identidad es lo que hacés" (ahora matizado: la contribución sigue siendo el corazón de la identidad contextual, pero el miembro PUEDE complementar con un texto personal corto opcional por place — `headline`).
- **Supersede:** la regla absoluta "no hay bio" del documento de ontología (que era declarativa de "tu identidad contextual = sólo lo que hacés"). La identidad por contribución sigue siendo el principio canónico; el `headline` es un complemento opcional, NUNCA un sustituto.

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

Durante la sesión de planning de Feature E (members slice V1) del 2026-05-24, surge la pregunta operativa de si el perfil contextual del miembro debe incluir un campo bio. La ontología canónica vigente (`docs/ontologia/miembros.md`) declaraba el principio absoluto "no hay bio escrita por el miembro — tu identidad es lo que hacés": el perfil del miembro en cada place se construye exclusivamente a partir de sus contribuciones acumuladas (mensajes, documentos, eventos, temas iniciados). La razón documentada era evitar "bio falsa, curaduría estratégica de imagen personal" — la identidad debía emerger de hechos verificables, no de declaraciones del propio miembro sobre sí.

El user (owner del producto) decide flipar explícitamente esa regla: *"esto es algo personal, no es generico y es una bio contextual"* (cita literal, 2026-05-24). La distinción es estructural — no se está abriendo una bio universal ni un perfil tradicional, se está habilitando un slot personal, opcional, atado al contexto de UN place específico. Casos de uso que motivan el flip: "Recién mudada del barrio; me sumo para conocer gente.", "Encantado del jugo de zanahoria sin azúcar, dejen recomendaciones.", "Esposa, mamá de Iván y Eli, paciente de psoriasis severa." — declaraciones contextuales legítimas que el principio "identidad por contribución" no acomoda y que no necesitan emerger como inferencia desde mensajes acumulados.

La tensión que cierra esta ADR: el principio "tu identidad contextual = lo que aportás" sigue siendo el corazón del modelo (la sección de contribuciones acumuladas continúa siendo el primario del perfil); el `headline` se introduce como **complemento opcional acotado**, no como sustituto. El riesgo histórico (bio falsa, curaduría estratégica) se mitiga por construcción vía tres restricciones: límite duro de 280 caracteres (desincentiva ensayos largos), opcionalidad real (NULL por default, sin placeholder forzado tipo "Add a bio"), y per-place (lo que escribís en El Taller no aparece en La Iglesia — la identidad contextual no se globaliza).

La decisión de localizar la columna en `membership` y NO en `app_user` es estructural: el principio canónico de tres capas de identidad (`docs/ontologia/miembros.md` §"Uno — Identidad en tres capas") prohíbe que datos contextuales viajen entre places. La capa 1 (`app_user`) está reservada al mínimo viable cross-place (nombre, avatar, handle); la capa 2 (`membership`) es donde vive todo lo contextual del miembro en un place específico. Una bio universal en `app_user` violaría integridad contextual y arrastraría todos los problemas que el modelo de tres capas evita por diseño.

## Decisión

### 1. Slot opcional `headline` per place

El miembro PUEDE escribir un texto corto que aparece en su perfil contextual de ese place específico. La columna vive en `membership` (capa 2 de identidad), no en `app_user` (capa 1):

```sql
ALTER TABLE membership ADD COLUMN headline text NULL;
ALTER TABLE membership ADD CONSTRAINT membership_headline_length_chk
  CHECK (headline IS NULL OR length(headline) <= 280);
```

`NULL` por default cuando un miembro se suma a un place. No hay placeholder forzado en UI (el bloque no se renderiza si la columna es NULL — no aparece "Add a bio" ni similar). El miembro decide explícitamente si llena el slot.

### 2. Lo que NO es

- **No es una bio universal.** `app_user.bio` queda descartado (viola integridad contextual; ver Alternativas rechazadas).
- **No es campo curable por el owner.** El owner del place NO puede editar el headline de otro miembro — esto es identidad personal del miembro, no curaduría del lugar. Distinción conceptual que separa "soy quien soy" de "soy quien el owner dice que soy".
- **No es gating ni requirement.** Sigue siendo opcional en todos los flujos (alta, edición, visualización). No bloquea ninguna acción downstream.
- **No reemplaza la sección de contribuciones acumuladas.** El perfil contextual sigue dominado por contribuciones (temas/mensajes/documentos/eventos); el headline es un complemento inline arriba, no el centro de gravedad.
- **No es rich-text/markdown.** Texto plano simple, ≤ 280 caracteres. Sin formato, sin enlaces interpretados, sin embebidos.

### 3. Edición

Server Action `updateMyHeadlineAction(p_place_id, p_new_headline)` (a implementar en S7/S8 de Feature E). Autorización estricta: `caller.user_id = membership.user_id` — el miembro edita su propio headline en ese place y nada más. El owner del place NO tiene path para editar el headline de otros miembros.

V1 NO requiere `SECURITY DEFINER` para esta operación: es UPDATE simple sobre `membership` autorizado por la propia RLS owner-only (el caller, cuando es owner del place, puede UPDATE sobre `membership` por las policies existentes). Para el caso miembro-no-owner editando su propio headline, se aplica el patrón `member-read` extendido a member-write acotado por columna en la propia action (zod + WHERE explícito `userId = caller`); no requiere policy nueva en V1 porque la UI de edición de headline se construye en V1.1+ (ver Consecuencias). El invariante crítico aquí es de autorización app-side, no cross-owner como `place_ownership` (que sí justifica WORM-via-DEFINER, ADR-0035 §4).

### 4. Límite de 280 caracteres

El límite es intuitivo (mismo orden de magnitud que tweet/SMS), cabe en 2-3 líneas de card sin scroll, y desincentiva por construcción los ensayos largos que reproducirían exactamente el patrón "bio falsa, curaduría estratégica de imagen personal" que el canon original prohibía. La elección es pragmática, no arbitraria: a 280 caracteres una persona declara contexto ("recién mudada del barrio", "mamá de Iván y Eli"), no construye una biografía profesional.

Enforcement en **dos capas** (defense-in-depth):

- **DB (autoritativa):** `CHECK (headline IS NULL OR length(headline) <= 280)` — cualquier path que llegue a SQL directo (admin scripts, migrations, jobs futuros, drift de un action) rebota.
- **App (UX):** zod schema del action (`z.string().max(280).nullable()`) — el action devuelve error estructural antes de tocar DB y la UI muestra el mensaje localizado.

### 5. Ontología canon flip

El write-back a `docs/ontologia/miembros.md` lo aplica el agente principal en S0 de Feature E (no este ADR — esto sólo enumera qué se actualiza):

- **§"Dos — La identidad contextual se construye por contribución":** se matiza el cierre — "Si querés que los demás sepan algo sobre vos, lo contás en una discusión, **o complementás tu perfil con un headline corto** opcional — pero el corazón sigue siendo lo que aportaste."
- **§"El perfil contextual del miembro" → "Lo que muestra":** agrega bullet **"Headline (si lo seteó) — texto corto personal del miembro en este place"**.
- **§"El perfil contextual del miembro" → "Lo que NO muestra":** REMUEVE el bullet "Bio escrita por ella".
- **§"Lo que el objeto miembro NO tiene":** REMUEVE el bullet "No hay bio escrita por el miembro. Tu identidad es lo que hacés." (queda implícito por el carácter opcional + acotado + per-place del headline).
- **§"Identidad contextual (capa 2)":** agrega bullet nuevo **"Headline opcional (≤280 chars): texto personal corto del miembro, distinto por place, NULL por default."**

El principio canónico §"Uno — Identidad en tres capas con propósitos distintos" NO cambia (el flip no toca capas; agrega un campo dentro de la capa 2 ya existente).

## Alternativas rechazadas

- **`app_user.bio` universal (bio que viaja entre places).** Rechazada: viola integridad contextual. La capa 1 (`app_user`) está reservada al mínimo viable cross-place (nombre/avatar/handle) por el principio canónico §"Uno" de la ontología, que es estructural y no negociable. Una bio universal arrastraría a un place lo que el miembro escribió pensando en otro — exactamente lo que el modelo de tres capas evita por diseño.
- **Tabla separada `member_profile (user_id, place_id, headline, ...)`.** Rechazada: over-engineering para una sola columna. `membership` ya tiene el grain correcto `(user_id, place_id)` y es la tabla natural de la capa 2 contextual; abrir una tabla nueva sin necesidad multiplica joins, RLS, migrations y no agrega nada que `membership.headline` no resuelva.
- **No permitir bio del todo (mantener el canon original).** Rechazada: el user pidió explícitamente la apertura como caso PERSONAL — "no es generico, es bio contextual" — y los casos de uso reales (recién mudada del barrio, fan del jugo de zanahoria sin azúcar, mamá de Iván y Eli) son legítimos y no se acomodan derivando identidad sólo de contribuciones acumuladas. El principio "identidad por contribución" se preserva intacto porque el headline es **opcional + acotado + complementario**, no sustitutivo.
- **Bio rich-text/markdown sin límite.** Rechazada: invita ensayos largos que reproducirían el patrón "bio falsa, curaduría estratégica" que el canon original prohibía. 280 caracteres es el sweet spot — alcanza para declarar contexto, no para construir biografías profesionales.
- **Bio editable por el owner del place.** Rechazada: el owner cura **el lugar** (settings, branding, dominios, miembros admitidos), no la identidad personal del miembro. Mezclar ambos roles rompe la división conceptual "soy quien soy vs soy quien el owner dice que soy" y abre una vía de moderación-encubierta-como-edición que no queremos modelar.
- **Bio gateada por algún requirement** (ej. "necesitás 5 mensajes antes de poder agregar headline"). Rechazada: añade fricción innecesaria a un campo que es opcional por diseño. Si nadie lo llena, no pasa nada — no hay un costo que el gating mitigue.
- **Límite distinto (140, 500, 1000).** 140 (tweet clásico) es demasiado restrictivo para los casos de uso reales (la frase "Esposa, mamá de Iván y Eli, paciente de psoriasis severa." ya consume buena parte). 500+ rompe el desincentivo a la bio-ensayo. 280 es el límite operativo: dos o tres líneas en una card sin scroll, alcanza para contexto sin habilitar curaduría larga.

## Consecuencias

- **Schema delta (`docs/data-model.md` § "Schema base"):** `membership.headline TEXT NULL` + `CHECK (headline IS NULL OR length(headline) <= 280)`. Nuevo invariante explícito en § "Invariantes del dominio": "`membership.headline ≤ 280 chars per row` — enforce DB-side vía CHECK, defense-in-depth ante drift del input app-side".
- **Migration 0017 (S1 de Feature E):** `ALTER TABLE membership ADD COLUMN headline text NULL` + `ALTER TABLE membership ADD CONSTRAINT membership_headline_length_chk CHECK (headline IS NULL OR length(headline) <= 280)`. Idempotente sobre filas existentes (NULL no viola el CHECK).
- **Ontología (`docs/ontologia/miembros.md`):** write-back en las 4 secciones listadas en §5 — el agente principal lo aplica en S0 de Feature E.
- **Feature E spec (`docs/features/members/spec.md`):** incluye CU "Editar headline propio" en la fase de server actions (S7/S8). Pre-condición: `caller.user_id = membership.user_id` para el `place_id` target. Validación zod: `z.string().max(280).nullable()`.
- **Server Action** `updateMyHeadlineAction(p_place_id, p_new_headline)` en `src/features/members/actions/update-my-headline.ts` (S7/S8 de Feature E). UPDATE acotado a la fila `(user_id = caller, place_id = p_place_id)`. Devuelve error de dominio si la pre-condición de autorización falla.
- **UI (V1.1+):** bloque "headline" en perfil contextual del miembro — render condicional (sólo si NOT NULL); editor inline para el propio miembro (`isMe = currentUser.id === membership.userId`). V1 no construye UI nueva — la columna y el action existen para que V1.1+ consuma sin re-arquitectura.
- **i18n (6 locales: es/en/fr/pt/de/ca):** nuevas keys `placeMembers.headline.editButton`, `placeMembers.headline.placeholder` (instrucción "máx 280 caracteres, opcional"), `placeMembers.headline.empty` (no muestra placeholder visible — el bloque desaparece cuando NULL; la key existe sólo para el editor cuando el miembro abre el formulario por primera vez).
- **Sin nuevas funciones `SECURITY DEFINER`:** el headline es UPDATE simple sobre `membership` autorizado por `user_id = caller`. No requiere WORM-via-DEFINER (no es invariante crítico cross-owner como `place_ownership`, ADR-0035 §4).
- **Sin cambio en la RLS de `membership`:** el `ownerOnly(t.placeId)` ya permite al owner del place ver/admin todos los headlines de sus miembros (para listas y admin UI). El member-read del propio headline se resuelve app-side en el action de edición; cuando una UI futura necesite que un miembro lea headlines de OTROS miembros del mismo place (timeline, perfiles públicos del place), se agrega policy member-read siguiendo el patrón canónico (ADR-0021).
- **Sin gotcha nuevo:** la columna sigue patrones existentes (CHECK + zod + RLS owner-only); no introduce comportamiento no-derivable del código.

## Detalle operativo canónico

- Ontología canónica refinada (post-S0 Feature E): `docs/ontologia/miembros.md`.
- Schema delta + invariante: `docs/data-model.md` § "Schema base" → `membership` + § "Invariantes del dominio" (nuevo invariante "headline ≤ 280 chars per row").
- Spec del slice: `docs/features/members/spec.md` (S0 de Feature E).
- Migration de schema: `src/db/migrations/0017_*.sql` (S1 de Feature E).
- Server Action: `src/features/members/actions/update-my-headline.ts` (S7/S8 de Feature E).
- Principio canónico de identidad contextual (sigue vigente): `docs/ontologia/miembros.md` §"Dos — La identidad contextual se construye por contribución".
- Patrón de capas de identidad (estructural, no cambia): `docs/ontologia/miembros.md` §"Uno — Identidad en tres capas con propósitos distintos".
- Patrón member-read RLS (para extensiones futuras V1.1+): ADR-0021.
