# Custom Domain V1 — sección "Dominio" en `/settings`

> _Spec creado 2026-05-21. Status: **S5 deployed (commit `d31e1cc`, 2026-05-21)** + **fix verified-false-positive deployed (ADR-0029, commit `5a2eb7b`, 2026-05-22)** — bug original cerrado verde con smoke real sobre `nocodecompany.co` (auto-reset por branch `verified_reset` ejecutado, DB confirma `verified_at = NULL`). **Polish UX pendiente**: apex `@` notation + DNS shape filter (task #110, fuera de scope del fix verified-false-positive — bugs descendientes descubiertos en smoke). S6 cron opcional V1.1 sigue pending. Activa el item "Dominio" del sidebar de `/settings` (V1.1, ADR-0025) que hasta S3 estaba `disabled: true`. Refinada operativamente por ADR-0026 (lazy verification V1) + ADR-0029 (V6 misconfigured check) + ADR-0030 (split slice por capa de operación)._

## Contexto

`{slug}.place.community/settings/domain` es la **segunda sección funcional** del settings (la primera fue "Idioma del place", `docs/features/settings/spec.md`). Activa el item "Dominio" del grupo **Identidad** del sidebar V1.1. El owner registra el dominio propio del place (e.g. `comunidad.mi-marca.com`), Vercel valida DNS + emite SSL automáticamente, y `place_domain.verified_at` queda con timestamp. Una vez verificado, el dominio queda **listo** — el routing real lo activó Feature B (`docs/features/custom-domain-routing/`) y el SSO desde custom domain lo activó Feature C (`docs/features/custom-domain-sso/`, ADR-0032, Signed Ticket pattern — V1 deployed). Este slice V1 NO tocó routing ni SSO; eso fue responsabilidad de Feature B y Feature C respectivamente.

Este spec describe la **parte de settings UI y funcionalidad** del custom domain V1 — la rebanada vertical que va desde el form vacío hasta la fila `place_domain` con `verified_at IS NOT NULL`. Las decisiones operativas (lazy verification, partial unique, archived libera dominio, single-domain V1, `oauth_client_id` NULL indefinidamente — forward-compat: si V2 vuelve a OIDC canonical se reutiliza; ADR-0032 deprecó la ruta OIDC canónica vía plugin —, forward-compat Feature B con `SECURITY DEFINER`) viven en [ADR-0026](../../decisions/0026-custom-domain-v1-lazy-verification.md), que **refina** [ADR-0001](../../decisions/0001-auth-oidc-custom-domains.md) sobre el mecanismo concreto de verificación.

## Scope V1 (resumen)

Detalles canónicos en [ADR-0026](../../decisions/0026-custom-domain-v1-lazy-verification.md). Resumen:

**IN**:
- Registro de un dominio activo por place (single-domain V1 enforce vía pre-check).
- Verificación **lazy** en cada carga de `/settings/domain` (Server Component llama Vercel API si `verified_at IS NULL`).
- Lifecycle **archived**: soft delete con `archived_at = now()` + DELETE best-effort en Vercel.
- Partial unique index `(domain) WHERE archived_at IS NULL` → dominios archivados pueden reusarse.
- Mensaje claro al owner mientras está pending + tabla DNS records (copy-to-clipboard) + SLA de propagación DNS.
- Sub-ruta `/settings/domain` cableada + item del sidebar activado.
- i18n `placeSettings.domain.*` × 6 locales (paridad 0/0).

**OUT** (cada uno con razón):
- **Host routing** (`mi-place.com → place`): Feature B, plan posterior.
- **SSO desde custom domain**: cubierto por Feature C (ADR-0032, Signed Ticket pattern — V1 deployed). Slice canónico: `docs/features/custom-domain-sso/`. No hay callback handler (el pattern usa 3 endpoints `/api/auth/sso-{init,issue,redeem}`).
- **OIDC client provisioning** (`oauth_client_id`): **NO se hace nunca**. La columna queda NULL indefinidamente. ADR-0032 deprecó la ruta OIDC canónica (el plugin OIDC Provider de Better Auth no es accesible desde Neon Auth managed). ADR-0027 nunca se escribirá. La columna se preserva como forward-compat por si V2 vuelve a OIDC canonical.
- **Multi-domain por place**: V2; schema lo permite, UI/action enforce 1.
- **IDN/punycode**: V1 rechaza con mensaje claro; V2+ si los clientes lo piden.
- **Wildcards** (`*.empresa.com`): V2+; rechazado por `validateCustomDomain`.
- **Botón "Verificar ahora" manual**: el lazy poll en cada carga del page lo equivale.
- **Cron continuo `*/15`** (S6 del plan): opcional, diferible a V1.1 si lazy poll cubre 99% de casos.
- **Edit in-place del dominio**: typo recovery es archive + re-register (decisión consciente, ver §Edge cases).

## Estado-máquina de `place_domain`

```
┌──────────┐  register  ┌──────────┐  verify (Vercel)  ┌──────────┐
│   none   │ ─────────▶ │ pending  │ ────────────────▶ │ verified │
│ (no row) │            │ (row,    │                   │ (row,    │
└──────────┘            │  v_at=∅) │                   │  v_at!=∅)│
     ▲                  └──────────┘                   └──────────┘
     │                       │                              │
     │ re-register           │ archive                      │ archive
     │                       ▼                              ▼
     │                  ┌──────────┐                   ┌──────────┐
     └──────────────────│ archived │◀──────────────────│ archived │
     (partial unique    │ (a_at!=∅)│                   │ (a_at!=∅)│
      libera el dom)    └──────────┘                   └──────────┘
```

**Transiciones** (las únicas válidas):

- `none → pending`: el owner submitea el form de "Vincular dominio" → Server Action `registerCustomDomainAction` inserta una fila en `place_domain` con `verified_at NULL` y llama `vercel.addDomain(domain)`. Si todo OK, la fila queda **pending** y el page muestra los DNS records que Vercel devolvió.
- `pending → verified`: en una carga posterior de `/settings/domain`, el Server Component llama `getCustomDomainStatus(placeId)` → como `verified_at IS NULL`, hace `vercel.getDomainStatus(domain)` → si Vercel responde `verified: true`, `UPDATE place_domain SET verified_at = now()` y la UI cambia al estado **verified**.
- `pending → archived`: el owner hace click en "Remover" → confirm dialog → `archiveCustomDomainAction` hace `UPDATE place_domain SET archived_at = now()` + DELETE best-effort en Vercel.
- `verified → archived`: idéntica al caso anterior; el dominio verificado se archiva por decisión del owner (cambio de marca, error, etc.).
- `archived → none` (UX-wise): el estado **archived** NO se muestra en UI; el page filtra `WHERE archived_at IS NULL`. Desde la perspectiva del owner, archivar "borra" el dominio.
- `archived → pending` (re-register): gracias al partial unique index, el mismo dominio puede registrarse de nuevo (mismo o distinto owner). El INSERT crea una **fila nueva** con `verified_at NULL`; la fila archivada queda en DB para auditoría.

**Invariantes**:
- A lo más una fila activa (`archived_at IS NULL`) por `place_id` en V1 (enforce a nivel Server Action).
- A lo más una fila activa por `domain` global (enforce a nivel partial unique index).
- `verified_at` nunca se desetea: pasar a archived NO borra `verified_at`. Si el owner re-registra el mismo dominio, nace una fila nueva en pending y el ciclo de verificación se ejecuta desde cero.
- El estado **archived** NO es visible en UI; el page filtra `archived_at IS NULL`. Si quisiéramos un "history" de dominios archivados, sería V1.1+.

## UI states

La sección "Dominio" tiene **4 estados visibles** + 1 oculto (archived). Cada uno con su set de elementos visuales y CTAs.

### Estado `none` (no hay row activa)

- **Qué muestra**: título "Dominio propio" + descripción corta calma + form con input `<input type="text">` (placeholder `comunidad.mi-marca.com`) + botón "Vincular dominio".
- **CTA**: submit del form → dispara `registerCustomDomainAction`.
- **Validación client-side** previa al submit: `validateCustomDomain(input)` (espeja al server). Si falla, mensaje inline + form no se envía. Esto reduce roundtrips para errores obvios (input vacío, formato inválido, IDN).
- **Transiciones**: submit OK → `pending`; submit con error → mismo estado + mensaje en notice.

### Estado `pending` (row activa, `verified_at IS NULL`)

- **Qué muestra**:
  - Banner calmo "Verificando tu dominio" + dominio bold (`comunidad.mi-marca.com`).
  - Copy del SLA: "La propagación DNS puede tardar de 1 minuto a 48 horas según tu proveedor."
  - **Tabla DNS records** (3 columnas: Tipo, Nombre, Valor) con los records exactos que Vercel devolvió. Cada celda con botón `copy-to-clipboard`.
  - Botón "Remover" (secundario, calmo).
- **Auto-refresh**: client-side `router.refresh()` cada **30 segundos** mientras `verifiedAt === null`. Cada refresh dispara el lazy poll del Server Component → si Vercel ya validó, la UI cambia a `verified` sin acción del owner. Sin countdown bursátil.
- **CTA secundaria**: "Remover" → confirm dialog → `archiveCustomDomainAction`.
- **Sub-caso `vercelUnavailable`**: si en la última carga el lazy poll falló (Vercel 5xx o red), el banner muestra "Verificando, intentaremos de nuevo en breve" en lugar de los DNS records. El próximo `router.refresh()` (en ≤30s) reintenta automáticamente. El owner no necesita hacer nada.
- **Transiciones**: lazy poll detecta verified → `verified`; click "Remover" + confirm → `archived` (UI vuelve a `none`).

### Estado `verified` (row activa, `verified_at IS NOT NULL`)

- **Qué muestra**:
  - Badge "Verificado, SSL activo" + dominio bold.
  - Mini-explicación calma: "Tu dominio está validado por Vercel y con SSL emitido. Próximamente vas a poder usarlo como acceso directo a tu place." (V1 NO tiene routing aún; copy honesto sobre el estado).
  - Botón "Remover" (secundario, calmo).
- **CTA**: "Remover" → confirm dialog → `archiveCustomDomainAction`.
- **Sin auto-refresh** (no hay nada que polear).
- **Transiciones**: click "Remover" + confirm → `archived` (UI vuelve a `none`).

### Estado `error` (transitorio post-submit fallido)

- **Qué muestra**: form igual al estado `none` + **notice calmo** arriba del input con el mensaje mapeado del `RegisterError` (ver §Error mapping UX). El input mantiene el valor escrito por el owner para que pueda corregirlo sin retypear.
- **CTA**: re-submit con el mismo o nuevo input → dispara `registerCustomDomainAction` de nuevo.
- **Transiciones**: re-submit OK → `pending`; re-submit error → mismo estado con nuevo mensaje.

## Flows happy path

### F1. Registrar dominio

```
1. Owner navega a /settings/domain (estado: none).
2. Escribe "comunidad.mi-marca.com" en el input.
3. Click "Vincular dominio".
4. Client valida (validateCustomDomain) → ok.
5. Server Action registerCustomDomainAction:
   - Zod parse del input.
   - validateCustomDomain (red ante reservados/IDN/format).
   - Pre-check single-domain: SELECT EXISTS ... → false.
   - INSERT place_domain (place_id, domain) RETURNING id.
   - vercel.addDomain(domain) → response con DNS records.
   - revalidatePath('/place/{slug}/settings/domain').
6. UI re-rendera en estado pending: banner + tabla DNS records + SLA + botón Remover.
7. El owner sale del page, configura los DNS en su provider, vuelve más tarde.
```

### F2. Verificación automática (lazy)

```
1. Owner vuelve a /settings/domain (estado: pending) — o se queda en el page con auto-refresh activo.
2. Server Component llama getCustomDomainStatus(place.id):
   - SELECT row activa → verified_at IS NULL.
   - vercel.getDomainStatus(domain):
     a. Si verified=true: UPDATE place_domain SET verified_at = now() RETURNING ... → status "verified".
     b. Si verified=false: status "pending", devuelve DNS records frescos.
     c. Si Vercel falla: status "pending" + vercelUnavailable=true (sin DNS records).
3. Render del page según status:
   - "verified": banner verde + badge SSL activo.
   - "pending": tabla DNS records + auto-refresh 30s.
   - "pending+vercelUnavailable": copy calmo "Verificando, intentaremos de nuevo en breve" + auto-refresh sigue.
4. La UI cambia sola sin acción del owner cuando Vercel valida.
```

### F3. Archivar dominio

```
1. Owner en estado pending o verified hace click en "Remover".
2. Confirm dialog se abre con copy: "Esto desactiva el dominio. Tu place seguirá disponible en {slug}.place.community. ¿Continuar?"
3. Click "Sí, remover".
4. Server Action archiveCustomDomainAction:
   - Zod parse {placeSlug, domainId}.
   - UPDATE place_domain SET archived_at = now() WHERE id=$1 AND place_id=(SELECT id FROM place WHERE slug=$2) AND archived_at IS NULL RETURNING domain.
   - vercel.removeDomain(domain) → si falla, log + continuar (DB es SoT de la decisión del owner).
   - revalidatePath('/place/{slug}/settings/domain').
5. UI vuelve a estado none (form vacío + input + botón "Vincular dominio").
```

### F4. Re-registrar tras archive

```
1. Owner está en estado none (tras un archive previo).
2. Escribe el mismo dominio que archivó antes ("comunidad.mi-marca.com").
3. Click "Vincular dominio".
4. registerCustomDomainAction hace INSERT:
   - El partial unique index permite el INSERT porque la fila vieja tiene archived_at IS NOT NULL.
   - Nace una fila NUEVA con verified_at NULL (no se reusa el verified_at viejo).
5. UI pasa a pending; el ciclo de verificación se ejecuta desde cero.
6. La fila vieja archivada permanece en DB para auditoría futura (oculta a la UI).
```

## Error mapping UX

El union `RegisterError` se mapea 1:1 a copy del usuario. Tabla canónica:

| `reason` key | Mensaje al usuario | Cuándo ocurre |
|---|---|---|
| `invalid_domain` | "Ese dominio no es válido. Verificá el formato (ej. `comunidad.mi-marca.com`)." | `validateCustomDomain` falló (RFC 1123 length, label length, leading/trailing hyphen, no alfanum, no TLD). |
| `reserved` | "Ese dominio está reservado por el sistema. Usá un dominio propio." | El input matchea `RESERVED_DOMAINS` o algún suffix de `RESERVED_DOMAIN_SUFFIXES` (`place.community`, `*.vercel.app`, `*.netlify.app`, IPs literales, etc.). |
| `idn_not_supported` | "Por ahora aceptamos solo dominios ASCII. Próximamente vamos a soportar dominios internacionalizados." | El input contiene caracteres no-ASCII (e.g. `münchen.de`, `日本.jp`). IDN/punycode es V2+ explícito. |
| `domain_taken` | "Ese dominio ya está vinculado a otro lugar de Place. Si es tuyo, contactanos." | (a) `code: '23505'` en el INSERT (UNIQUE violation en el partial unique index — otro place activo lo tiene), o (b) Vercel responde `domain_already_in_use` (otro proyecto Vercel lo tiene). |
| `limit_reached` | "Ya tenés un dominio vinculado a este place. Removelo antes de agregar otro." | El pre-check `SELECT EXISTS WHERE place_id=$1 AND archived_at IS NULL` retorna true (single-domain V1 enforce). |
| `vercel_unavailable` | "No pudimos contactar a Vercel para verificar. Probá de nuevo en unos minutos." | Vercel responde 5xx, timeout, o error de red durante `addDomain`. La fila DB se hace rollback (DELETE) para no dejar pending huérfano. |
| `generic` | "No pudimos guardar. Probá de nuevo." | Fallback: error no clasificado (Postgres no-23505, exceptions inesperadas). |

`ArchiveError` es minimal:

| `reason` key | Mensaje al usuario | Cuándo ocurre |
|---|---|---|
| `not_found` | "No encontramos ese dominio." | El UPDATE retorna 0 rows (fila no existe, ya archivada, o no pertenece al place). Caso defensivo. |
| `generic` | "No pudimos remover el dominio. Probá de nuevo." | Excepción inesperada en el UPDATE. |

## Edge cases

### Typo recovery

El owner pega `comunidda.mi-marca.com` (typo: dos `d`), verifica DNS, después se da cuenta del error. **UX V1**: el owner archiva el dominio con typo + re-registra con el dominio corregido. No hay edit in-place. Razón explícita: un dominio es identidad fuerte (cookie del SSO futuro, SSL emitido, propagación DNS); edit-in-place agrega complejidad de migración (¿se mantiene verified_at?, ¿se notifica a Vercel del rename?, ¿se invalida el SSL?) sin valor V1. Archive + re-register es 2 clicks, deja la trazabilidad en DB, y es consistente con cualquier "cambio de identidad".

### Apex vs subdomain

Registrar `empresa.com` (apex) requiere típicamente un A record + ALIAS/ANAME en el DNS provider del owner; registrar `comunidad.empresa.com` (subdomain) usa CNAME. La UI muestra **los records exactos que Vercel devuelve** sin reinterpretarlos ni decidir por el owner. El owner ve la tabla y configura según lo que su DNS provider permita (algunos providers como Cloudflare exponen "CNAME flattening" para apex). Vercel ya cubre ambas configuraciones internamente.

### Propagación DNS lenta

La copia muestra explícitamente "La propagación DNS puede tardar de 1 minuto a 48 horas según tu proveedor". El owner sabe que ver `pending` durante horas es normal y NO un bug. Esto evita tickets de soporte tipo "¿por qué tarda tanto?". El auto-refresh cada 30s cubre el caso de propagación rápida (1-10 min); para propagaciones lentas, el owner vuelve al page horas después y el lazy poll resuelve.

### Cambio de marca

El subdomain `{slug}.place.community` **SIEMPRE funciona**, incluso si el custom domain está `archived`, `pending`, o `verified`. El owner puede archivar `comunidad.marca-vieja.com`, registrar `comunidad.marca-nueva.com`, y mientras tanto los miembros del place siguen entrando por el subdomain canónico sin interrupción. Esta garantía vive en ADR-0001 y se refuerza en el copy del confirm dialog del archive. Forward-compat: cuando Feature B active el routing, el subdomain canónico sigue siendo el fallback siempre disponible.

### Vercel down durante registro

El INSERT en DB pasa (la fila nace pending) pero `vercel.addDomain` falla (5xx, timeout). **Decisión V1**: rollback del INSERT con DELETE + retorno `vercel_unavailable` al owner. Razón: dejar una fila pending sin DNS records (porque Vercel nunca los devolvió) deja al owner sin información accionable; mejor pedirle que retry. Si Vercel sigue caído, los retries fallan igual; si se recupera, el próximo submit funciona limpio.

### Vercel down durante verificación lazy

Distinto al caso anterior: la fila ya existe en pending, el owner abre el page, `getCustomDomainStatus` llama `vercel.getDomainStatus` y falla. **Decisión V1**: no rollback (la fila es válida, sólo no pudimos verificar ahora). El page muestra "Verificando, intentaremos de nuevo en breve" + auto-refresh. El próximo `router.refresh()` (30s después) reintenta. Eventually consistent.

## Decisión: layout NO compartido entre `/settings` y `/settings/domain`

Cada page (`/settings/page.tsx` y `/settings/domain/page.tsx`) mounta su propio `<NavPlaceLayout>`. **NO** se extrae un `src/app/(app)/place/[placeSlug]/settings/layout.tsx` compartido en V1.

**Consecuencia**: navegar entre secciones del settings re-mounta el shell (topbar + sidebar). El sidebar mismo se rebuildea, los íconos se re-importan (tree-shaken por Turbopack/Webpack así que es barato), el active highlight se recomputa server-side.

**Por qué NO es regresión**: es el mismo patrón del `/settings` actual (que también re-mounta `NavPlaceLayout` por page). El user no percibe la diferencia — la nav es server-side rendered con cookie + DB load idénticos en cada page.

**Cuándo extraer layout.tsx compartido** (V1.1+): cuando haya ≥3 sections activas (idioma + dominio + ?). En ese momento, extraer el layout es una refactor mecánico de 1 sesión: mover `<NavPlaceLayout>` al layout.tsx, los pages devuelven solo el contenido de la sección activa. ADR potencial cuando se haga.

## Decisión: `navigator.clipboard.writeText` requiere secure context

La tabla de DNS records expone botones "Copiar" para cada celda (Tipo, Nombre, Valor). Implementación: `navigator.clipboard.writeText(value)`. **Esta API requiere secure context** (HTTPS o `localhost`).

**Dev local**: el dev debe acceder a `mi-slug.localhost:3000`, NO IP literal (`192.168.x.x:3000`) ni `0.0.0.0:3000`. `localhost` es secure context por especificación de browsers. Si el dev navega por IP, el botón Copy falla silenciosamente (no hay API).

**Producción**: HTTPS automático por Vercel sobre `*.place.community`. Cero trabajo extra.

**Fallback elegante**: si el browser no soporta `navigator.clipboard` o el contexto no es secure, la UI muestra el valor de la celda **seleccionable manualmente** (`<span>` con `user-select: all`). El owner puede hacer triple-click + Cmd/Ctrl+C. El botón Copy queda visible pero no funcional; on click silencia el error sin toast intrusivo. Documentar en gotcha si se observa confusión.

## Cableado real (post-S4)

S4 cierra la rebanada vertical: el page Server Component, el item del sidebar y el slice Client `<DomainSection>` quedan cableados end-to-end contra los actions de S3 y los wrappers de S2. Resumen del cableado real, con pointers a los archivos `src/...` que materializan los §"UI states" descritos arriba.

### Page Server Component

`src/app/(app)/place/[placeSlug]/settings/domain/page.tsx`. Mismo guard pattern que `/settings/page.tsx`: slug servible → sesión cross-subdomain → `getPlaceForZone(placeSlug)` → si null, `notFound()`. `export const dynamic = "force-dynamic"` porque el lazy poll a Vercel requiere no-cache: cada carga re-corre `getCustomDomainStatus` para detectar la transición `pending → verified` server-side. El page llama `getCustomDomainStatus(place.id)` (lazy poll a Vercel API si `verified_at IS NULL`) y le pasa el resultado al `<DomainSection state={state} ...>` como prop. Inyecta `registerCustomDomainAction` + `archiveCustomDomainAction` por seam-split (mismo patrón que `LocaleSection` con `updateDefaultLocaleAction`), así el Client recibe los actions como `Function` props testeables con `vi.fn()`.

### Labels resueltas server-side

`getTranslations({ locale: place.defaultLocale, namespace: "placeSettings.domain" })` produce el objeto `DomainSectionLabels` serializable que viaja al Client Component como prop. Mismo patrón que `LocaleSection` con `placeSettings.language.*`. Las ~33 keys del bloque `placeSettings.domain.*` viven en los 6 JSONs de `src/i18n/messages/{es,en,pt,de,fr,it}.json` con paridad 0/0 verificada por `scripts/check-translations.mjs` (S0). El Client nunca llama `useTranslations` directamente para `placeSettings.domain.*` — todas las strings llegan resueltas, lo que mantiene la frontera server/client limpia y permite swap de locale sin re-instanciar al Client.

### Sidebar

El item "Dominio" del grupo **Identidad** del sidebar `src/features/nav-place/ui/nav-place-items.tsx` pasa de `disabled: true` a `href: "/settings/domain"`. El page Server Component setea `activeSection="domain"` en `<NavPlaceLayout>` para que el item se renderice con `aria-current="page"` y el highlight visual. Convive con `activeSection="language"` del page `/settings/page.tsx` sin colisión — cada page mounta su propio `NavPlaceLayout` (decisión §"layout NO compartido").

### Auto-refresh

El Client `<DomainSection>` corre `useEffect` con `setInterval(() => router.refresh(), 30_000)` mientras `state.status === "pending"`. `router.refresh()` invalida el RSC payload del page → re-mount del Server Component → re-corre `getCustomDomainStatus` → si Vercel ya validó, el SSR retorna `status: "verified"` y la UI cambia sola sin acción del owner. El intervalo se limpia en el cleanup del `useEffect` cuando `status` deja de ser `pending` (transición a `verified` o `none`) o cuando el componente se desmonta.

### Copy-to-clipboard fallback

El botón "Copiar" de cada celda de la tabla DNS invoca `navigator.clipboard.writeText(value).catch(() => {})`. En contextos no-secure (HTTP en dev por IP literal, o browsers viejos sin la API) la promise rechaza, el catch silencia el error sin toast intrusivo, y la celda queda seleccionable con `user-select: all` (decisión existente del §"navigator.clipboard"). El owner puede triple-click + Cmd/Ctrl+C como fallback degradado. Sin feature detection explícita: el catch cubre tanto "no existe `navigator.clipboard`" como "existe pero rechaza por contexto inseguro".

### Confirm dialog para archive

El "¿Estás seguro?" del flow F3 es estado local del Client (`useState<boolean>`). El body del dialog resuelve el placeholder client-side: `archiveConfirmBody.replace("{slug}", placeSlug)`. Reusa el shape de `wizard.successBody.replace("{url}", ...)` y `successBody.replace("{language}", ...)` de `LocaleSection` — convención del codebase para placeholders simples en labels server-rendered. El dialog dispara `archiveCustomDomainAction` al confirmar; al cancelar simplemente cierra (`setOpen(false)`) sin side effects.

> **Actualización 2026-05-22 (ADR-0029):** El lazy poll en page-load ahora consume DOS endpoints Vercel — `GET /v6/domains/{domain}/config` (campo `misconfigured`, dinámico) además del `GET /v9/projects/{id}/domains/{domain}` (campo `verified`, sticky/append-only). Estado real = `verified V9 && !misconfigured V6`. Si se detecta `misconfigured: true` con `verified_at IS NOT NULL` en DB, la lógica resetea `verified_at = NULL` y la UI vuelve a estado pending con un banner "tu DNS se rompió" + records del V6 para reconfigurar. Pattern oficial Vercel multi-tenant (`https://vercel.com/docs/multi-tenant/domain-management`). Implementado en sesiones S1-S2 del plan del fix.

## Test plan summary

Detalle por archivo en [`tests.md`](./tests.md). Resumen del scope V1:

- **`validateCustomDomain`** (S2): ≥15 tests pure function (válidos + inválidos por categoría: format, length, IDN, wildcards, IPs, reservados).
- **`isReservedDomain`** (S2): ≥6 tests pure function (apex reservado, suffix reservado, IP literal, casing).
- **`vercel/domains` wrapper** (S2): ≥7 tests con mock `fetch` global (200 valid, 200 partial, 404, 409, 422, 429, 500) + Zod parse failure cleanly + `vi.stubEnv` para `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID`.
- **`mapPgErrorToActionError`** (S3): ≥4 tests pure function (`23505` → `domain_taken`, error sin code → `generic`, error null → `generic`, code distinto → `generic`).
- **Schema partial unique** (S1): ≥2 tests integration contra DB real (insertar → archive → re-insertar permitido; dos owners distintos compitiendo por mismo dominio activo → segundo falla con 23505).
- **`DomainSection` Client Component** (S4, implementada 2026-05-21): **15 tests RTL** distribuidos entre `domain-section.test.tsx` (9: render por estado + submit happy + 3 validaciones cliente — invalid format, IDN, reserved — + server-error mapping `domain_taken`) y `domain-section-interactions.test.tsx` (6: confirm dialog cancel + confirm + copy-to-clipboard con spy + auto-refresh con `vi.useFakeTimers` + idempotencia con `useRef`). El split UI a 3 archivos hermanos (`domain-section.tsx` + `-pending.tsx` + `-archive.tsx`) y tests a 2 archivos mantiene LOC ≤300 por archivo (CLAUDE.md §Límites).

**Server Actions NO tienen tests directos por canon del proyecto** (`update-default-locale.ts:13`): "su correctitud es de tipo/build + smoke vivo en producción, NO vitest (arrastra `next/headers` + Neon Auth + DB real)". La cobertura vive en las piezas puras compuestas (`validateCustomDomain` + `isReservedDomain` + `vercel/domains` + `mapPgErrorToActionError`), la UI test con `vi.fn()` para los actions inyectados, y el smoke vivo manual en S5 (dev local + preview deploy).

**Total esperado**: ~45 tests nuevos. Suite tras S5: ~346 tests verde (baseline 301 + ~45). **Real al cierre de S4 (2026-05-21)**: 396 tests verde (baseline 301 + 95 acumulados: schema + shared/lib + `mapPgErrorToActionError` + 15 RTL `<DomainSection>`).

## Out of scope (textual del plan)

- **Host routing real** (`mi-place.com → place`): Feature B, plan posterior. Sin hooks en este slice. ADR-0026 §"Forward-compat Feature B" documenta el approach con `SECURITY DEFINER`.
- **SSO desde custom domain**: cubierto por Feature C V1 (ADR-0032, Signed Ticket pattern). Slice: `docs/features/custom-domain-sso/`. NO usa Better Auth OIDC Provider plugin (no accesible desde Neon Auth managed). No hay callback handler.
- **OIDC client provisioning** (`oauth_client_id`): **NO aplica**. ADR-0032 deprecó la ruta OIDC canónica. ADR-0027 nunca se escribirá. La columna queda NULL indefinidamente como forward-compat.
- **Multi-domain por place**: V2; el schema lo permite (FK `place_id` no único), la UI/action enforce 1 vía pre-check. V2 es solo quitar el pre-check + ajustar UI. Cero migration.
- **IDN/punycode**: V1 rechaza con mensaje claro `idn_not_supported`. V2+ si los clientes lo piden (requiere normalización ASCII ↔ Unicode bidireccional + decisión UX sobre qué forma mostrar).
- **Wildcards** (`*.empresa.com`): V2+; `validateCustomDomain` rechaza el asterisco. Vercel los soporta pero el use case es enterprise.
- **DNS hijacking entre alta y verificación**: Vercel ya mitiga internamente (verifica el contenido del record, no solo la existencia). No implementamos protecciones extra V1.
- **Botón "Verificar ahora" manual**: el lazy poll en cada carga del page lo equivale; cero costo de espera para el owner que vuelve.
- **Notificaciones al owner** cuando se verifica/expira el dominio: no implementadas V1. Futuro cuando haya canal de notifs.
- **Listing de history de dominios archivados**: archivados se ocultan en UI; quedan en DB para auditoría futura. V1.1+ si aparece use case.
- **Cron continuo `*/15`**: opcional S6, diferible a V1.1 si lazy poll cubre 99% de casos en producción.

## Pointers

- **Decisiones canónicas V1**: [`docs/decisions/0026-custom-domain-v1-lazy-verification.md`](../../decisions/0026-custom-domain-v1-lazy-verification.md).
- **Contexto auth macro**: [`docs/decisions/0001-auth-oidc-custom-domains.md`](../../decisions/0001-auth-oidc-custom-domains.md) (refinada por ADR-0026 sobre el mecanismo de verificación).
- **Schema + invariantes**: [`docs/data-model.md`](../../data-model.md) §`place_domain` (anotación de partial unique post-S0).
- **Routing futuro (Feature B)**: [`docs/multi-tenancy.md`](../../multi-tenancy.md) §"Dominios propios" (actualizado en S0 al estado V1).
- **Wrapper Vercel API**: `src/shared/lib/vercel/domains.ts` (S2 del plan — fetch directo + Zod schemas espejando shape oficial de Vercel REST `/v10/projects/{id}/domains`).
- **Plan de sesiones operativo**: [`plan-sesiones.md`](./plan-sesiones.md).
- **Test checklist por sesión**: [`tests.md`](./tests.md).
