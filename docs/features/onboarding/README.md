# Onboarding / registro · spec de feature

Spec de **comportamiento esperado** de la feature de onboarding (alta owner-first: crear place + cuenta). No es implementación ni código. Consolida lo ya decidido en ADR-0001…0007, `architecture.md`, `data-model.md`, `multi-tenancy.md`, `stack.md`, `producto.md` y las ontologías. Donde dos docs canónicos podrían leerse distinto, **no se resuelve acá**: se anota en § "Contradicciones / zonas a confirmar" para que lo decida el humano.

> _Última actualización: 2026-05-17._ Esta carpeta es la spec; los docs canónicos siguen siendo la fuente de verdad. Si un canónico cambia, esta spec se ajusta — nunca al revés. **No** edita ADRs ni canónicos.

> ⚠️ **Pendiente de re-sync con ADR-0008 + ADR-0010 (estado final del modelo).** Esta spec aún describe el flujo place-first de los CTA (ADR-0005 §1). El modelo final, fuente de verdad hasta el re-sync:
> - **Dos vías de entrada (ADR-0008):** CTAs → place-first (cuenta al final, single-submit). Item **"Acceso"** → form login → signup **account-first** → "Crear mi place" (reusa pasos de place SIN el de cuenta; saga **modo authed**) o "Unirme".
> - **RLS por-operación (ADR-0010, refina ADR-0006 §2):** INSERT de place/membership/ownership abierto a autenticado con `WITH CHECK` self-only; SELECT/UPDATE/DELETE owner-only; `app_user` propia fila. **No** hay huevo-y-gallina ni función para crear place.
> - **Invitación SOLO por token-link (ADR-0010, supersede ADR-0009 §1):** `invitation` 100% owner-only; se acepta únicamente entrando por el link con token vía función de confianza `SECURITY DEFINER` (validate → ensureAppUser → membership → test-and-set `accepted_at`). **Sin** lookup por email, **sin** verified-email. "Unirme" en Acceso = solo **directorio** (futuro) → deshabilitado/"próximamente"; las invitaciones no se acceden desde el menú "Acceso".
> El §2 (flujo), §3 (saga: dos modos), §5 (RLS por-operación), §6 (invitación token-link) y `plan-sesiones.md` se re-sincronizan con ADR-0008/0010 antes de implementar. Hasta el re-sync, **ADR-0008 + ADR-0010** son la fuente.

## Índice de esta carpeta

- `README.md` (este archivo) — objetivo, alcance, flujo, saga, auth, RLS, invitación, billing, horario default, riesgos, contradicciones, checklist.
- `plan-sesiones.md` — el plan de implementación dividido en sesiones (corregido y consistente con ADR-0005 §10).
- `tests.md` — mandato TDD, casos críticos y estrategia de DB de test.

---

## 1. Objetivo y alcance

**Objetivo.** Que una persona, desde la CTA de la landing (`place.community` → `/login` → onboarding, decisión 3b de `landingpage/README.md`), cree su place y su cuenta de owner en un solo flujo, y termine con el place **servible en `{slug}.place.community`** y una sesión iniciada. Es la primera feature post-landing (ADR-0005 Contexto).

**Owner-first.** El alta arranca creando el place; la cuenta se pide al final (ADR-0005 §1). El resultado del onboarding es funcional end-to-end: place creado **y** ruteado en su URL canónica (ADR-0005 §10 — esto incluye el routing host-based, ver § "Routing en alcance").

### Qué entra en esta feature (S1)

- Wizard de 3 pasos en el apex, i18n bajo `[locale]`, estado 100% client-side hasta el submit.
- Chequeo de disponibilidad de slug en vivo (único global + reservados).
- Asistencia LLM **propose-only** (paleta + borrador de descripción; **no** horario).
- Saga de creación (signUp Neon Auth → `app_user` + handle → `place`+`place_ownership`+`membership`).
- `ensureAppUser` como primitivo de `shared/lib`.
- Auth email+password v1, cookie apex, login/redirect solo en `auth.place.community`.
- RLS **base** (owner-only) aplicada en S1 a `app_user`, `place`, `membership`, `place_ownership`, `invitation`.
- Routing host-based + estructura `(marketing)`/`(app)` + wildcard DNS/Vercel (ADR-0005 §10).
- Billing trial seteado al crear el place (`OWNER_PAYS`/`ACTIVE`/`trial_ends_at = now()+30d`).
- `opening_hours` default 09:00–20:00 en tz del owner, seteado en la saga.
- Diseño cerrado del flujo de invitación: token capability + vía privilegiada `SECURITY DEFINER` + email-match estricto. La RLS owner-only sobre `invitation` se aplica en S1 sin romper la aceptación.

### Qué NO entra (explícito)

- **Gate de horario** (bloquear fuera de hora): es concern a nivel de place, post-S1 (ADR-0007 §Consecuencias, `architecture.md` § Gate). Que el place tenga `opening_hours` no implica construir el gate ahora.
- **Uploader de avatar/logo**: Storage es TBD (`stack.md`). El avatar del miembro es por ahora **la inicial del nombre con color** (capa universal, `miembros.md` §"Identidad universal" admite "imagen o inicial con color"); `app_user.avatar_url` queda `NULL`. El logo/icono del place se difiere a `/settings` post-signup (`stack.md` § Storage).
- **Join desde directorio**: flujo aparte, posterior, con su propia policy (ADR-0005 §4, `multi-tenancy.md` § RLS — "no se diseña acá").
- **Cobro real / paywall**: solo se setea el arranque del trial; el gate del paywall y el cobro son posteriores (ADR-0005 §3, Pagos TBD).
- **Aceptación de invitación end-to-end como UI de S1**: en S1 se cierra el **diseño** y se aplica la RLS sin romperla; la pantalla de aceptación `/invite/{token}` y su Server Action pueden construirse en la misma tanda o inmediatamente después (ver `plan-sesiones.md`), pero la creación/listado/revocación de invitaciones por el owner sí está cubierta por la base owner-only de S1.
- **Settings del place** (editar horario, theming, activar zonas): post-S1, gateado por email verificado.
- **Social/Google login**: auth v1 = email+password solamente (ADR-0005 §9).
- **Custom domains**: el alta/verificación de dominios propios y su OIDC client son flujo aparte (ADR-0001, `multi-tenancy.md`); el onboarding solo deja al place servible en `{slug}.place.community`. El link de invitación contempla el caso "dominio verificado" como ramificación de host, pero no provisiona dominios.

---

## 2. Flujo del wizard

**Host:** apex `place.community`, i18n bajo `[locale]` (`/es` por ahora; `localePrefix: 'always'`, default `es`, `stack.md`/landing decisión 1). Contenido estático del wizard traducido (`producto.md` § Multi-idioma); lo que escribe el owner (nombre/descr.) no se traduce.

**Estado 100% client-side hasta el submit final** (ADR-0005 §1): no hay draft en server → **cero places huérfanos**. Zustand para el estado del wizard si hace falta (uso mínimo, `stack.md`). React Hook Form + Zod para cada paso.

**Tono:** cozytech — nada grita, sin urgencia, sin contadores (`producto.md` § Principios). Copy de bajo compromiso, coherente con la landing.

### Paso 1 — Identidad del place

- **Nombre del place** (`place.name`, requerido).
- **Slug / subdominio** (`place.slug`):
  - Preview de URL en vivo: `{slug}.place.community`.
  - **Chequeo de disponibilidad en vivo** contra dos fuentes:
    1. Unicidad global: no existe `place.slug` igual (la columna es `UNIQUE`, `data-model.md`).
    2. No es un reservado: no está en `shared/config/reserved-slugs.ts` (**hay que crear** este archivo; lista canónica en `multi-tenancy.md` § Reservados: `app, www, api, admin, staging, dev, test` + cualquiera que el producto use).
  - El chequeo en vivo es UX; la verificación dura corre en la saga (server) — el cliente nunca es autoritativo.
  - **Slug inmutable** una vez creado (`multi-tenancy.md` § Slug inmutable): comunicarlo en el paso (es decisión definitiva, cambiarlo es soporte manual). Formato del slug compatible con subdominio DNS (minúsculas, alfanumérico + guiones, sin espacios) — el validador Zod del slug es canónico en código; documentar el formato exacto al implementar S1 si no estaba.

### Paso 2 — Descripción + colores (+ asistencia LLM)

- **Descripción "para quién es el place"** (texto libre, alimenta al LLM y se persiste como `place.description`).
- **Colores — paleta acotada** (ADR-0005 §7, shape en `data-model.md`):
  - El owner setea **solo 3 tokens**: `--accent`, `--bg`, `--ink` (`theme_config.colors.{accent,bg,ink}`).
  - El resto (`--surface`, `--muted`, `--border`, `--accent-strong`, `--accent-ink`) se **deriva en render**, no se persiste.
  - **Default = paleta "Papel" de marca**, mismos valores que la landing (`landingpage/README.md` decisión 3d): `--bg #FAF7F0`, `--ink #1C1B22`, `--accent #C4632F`. Continuidad visual marca↔place.
  - **Guardrail de contraste = auto-ajustar + avisar** (ADR-0005 §8): si un par no cumple WCAG (mismos umbrales que la landing), el sistema deriva una variante que sí cumple (igual que `--accent-strong #A8501E` en la landing) y **avisa al owner qué ajustó**. Nunca bloquea el guardado ni aplica un place inaccesible en silencio.
- **Asistencia LLM — propose-only** (ADR-0005 §5 ajustado por ADR-0007):
  - A partir de la descripción libre, el LLM **propone**: (a) paleta acotada, (b) borrador de descripción del place. **NO propone horario** (ADR-0007 §1).
  - Vía **Vercel AI Gateway** (`stack.md`; string `"provider/model"`, modelo chico/rápido, salida estructurada validada por **Zod**; modelo concreto se fija al implementar — TBD acotado ADR-0005 §Consecuencias).
  - **Toda salida es propuesta editable y confirmada por el humano; nada se auto-aplica** (ADR-0005 §6, `producto.md` § "Customización activa, no algorítmica"). Si alguna vez se auto-aplicara salida del LLM sin confirmación, se viola el principio — está prohibido.
  - El LLM es opcional: el owner puede ignorarlo y setear todo a mano; el default Papel ya es un punto de partida válido.

### Paso 3 — Cuenta del owner

- **Nombre completo** → `app_user.display_name`.
- **Email** → identidad de login (Neon Auth) + `app_user.email`.
- **Password** (email+password, auth v1).
- **Aceptar términos** (links a `/terminos` y `/privacidad`, que ya existen).
- El **handle** NO se pide: se asigna random no-usado en la saga (ADR-0002 §3, `miembros.md` § Handle); editable luego por el usuario fuera del onboarding.
- **Timezone del owner**: ver § "Default de opening_hours" — se captura/deriva en este paso (punto a confirmar abajo).

Al confirmar el paso 3 → **submit único** que dispara la saga (§3).

---

## 3. Saga de creación

Canónico: ADR-0005 §2 (ajustado por ADR-0006), `architecture.md` § "Onboarding y saga de signup". **No es una transacción única y no hay hook/webhook de Neon Auth** (es servicio gestionado, verificado ADR-0006). El "hook" es **nuestro** Server Action + el guard JIT.

### Orden canónico (al submit)

1. **`auth.signUp.email()`** (Neon Auth / Better Auth) → devuelve la identidad de login **sincrónicamente** (invocable desde Server Action, verificado ADR-0006). Esto crea la fila en `neon_auth.user` (schema library-owned, no lo versiona Drizzle).
2. En la **misma request**, transacción de app (`public`): **upsert idempotente** de `app_user` 1:1 — clave `auth_user_id` = `neon_auth.user.id` (referencia lógica cross-schema, sin FK hard), conflicto → no-op. Incluye `display_name`, `email`, y **handle random no-usado** (ADR-0002).
3. Transacción de app (`public`): `place` + `place_ownership` + `membership` del owner, con los invariantes:
   - `slug` válido (no reservado, único global) — `multi-tenancy.md`.
   - máx 150 miembros (acá es 1, pero el invariante se enforza estructuralmente — `data-model.md`).
   - mínimo 1 owner (la fila `place_ownership` lo garantiza).
   - `billing_mode = 'OWNER_PAYS'`, `subscription_status = 'ACTIVE'`, `trial_ends_at = now() + 30 días` (§7).
   - `theme_config` = los 3 tokens del owner (o default Papel), shape Zod-validado.
   - `opening_hours` = default 09:00–20:00 en tz del owner (§8).
   - `enabled_features = []` (un place nace solo con Discusiones — `data-model.md`).

### Atomicidad y falla parcial

- **Atómico:** los pasos 2 y 3 son cada uno una transacción de app. El paso 3 (place+ownership+membership) es atómico de por sí — o se crean los tres o ninguno. La compensación/cleanup de un place a medio crear se maneja dentro de esa misma transacción (ADR-0005 §2).
- **No atómico cross-system:** paso 1 (Neon Auth, `neon_auth`) vs pasos 2–3 (`public`) — sistemas separados, sin BEGIN/COMMIT común.
- **Falla del paso 1:** nada se persiste (no hay identidad, no hay `app_user`, no hay place).
- **Falla del paso 3:** la cuenta (pasos 1–2) **queda creada**. No es error fatal: el usuario cae en un estado **"creá tu place"** (vacío, no error) y reintenta la creación del place (ADR-0005 §4). Una cuenta sin place es válida solo por esta vía (o por las excepciones invitación/join, fuera de alcance).
- **Idempotencia:** reintentar el submit no duplica identidad (email único en Neon Auth) ni `app_user` (`auth_user_id UNIQUE`, upsert conflicto→no-op). Reintentar tras falla del paso 3 no recrea identidad ni `app_user`; solo reintenta place+ownership+membership.

### Guard JIT `ensureAppUser(authUserId)`

- Primitivo de `shared/lib`, **idempotente**, dedupeable por request vía `React.cache` (ADR-0006 §Consecuencias, `architecture.md`).
- Se invoca en **toda entrada autenticada** antes de cualquier op de dominio: signup, login posterior, invitación, "join", reintentos, edge cases.
- Invariante: **ninguna operación de dominio corre sin `app_user`**. Fuerte consistencia en el punto de uso, sin acoplarse a internals de Neon Auth ni depender de webhooks (no existen).
- Toda query de dominio corre desde `queries.ts`/`actions.ts` del feature, tras `ensureAppUser`, bajo el rol custom no-admin (§5) — nunca con el rol admin.

### Driver

`neon-serverless` (WebSocket): la saga necesita transacción interactiva; `neon-http` no sirve para tx interactivas (`multi-tenancy.md` § RLS, ADR-0006 §Consecuencias).

---

## 4. Auth y sesión

Canónico: `architecture.md` § "Sesión y SSO", `stack.md`, ADR-0005 §9, ADR-0001.

- **Auth v1 = email+password solamente.** Sin social/Google por ahora aunque Neon Auth lo traiga (ADR-0005 §9).
- **Cookie apex.** La sesión del IdP/apex DEBE setear `Domain=place.community` explícito (sin `Domain` en dev local; resuelto desde `NEXT_PUBLIC_APP_DOMAIN`). Mecanismo verificado (2026-05-16, `architecture.md`): el SDK Next.js de Neon Auth instala un route handler **first-party** (`app/api/auth/[...path]/route.ts` = `auth.handler()`) que proxea al server gestionado y emite la cookie **en nuestro dominio**. Se configura con `createNeonAuth({ cookies: { domain: ".place.community", secret: NEON_AUTH_COOKIE_SECRET } })`. El dominio de cookie vive **solo en código** (no en Console/MCP).
- **Test guard de cookie:** debe existir un guard que **falle el build** si la cookie de sesión se emite sin `Domain` apex. Razón: una cookie host-only en un subdomain sobrescribe la del apex (RFC 6265 §5.3). Canónico en `architecture.md`.
- **`trusted_origins` acepta wildcard (corregido 2026-05-16).** El validador de `configure_neon_auth` acepta `https://*.example.com` → **`https://*.place.community` es un único trusted origin válido**, no hay que enumerar subdominios ni hay gap. Concentrar login/redirect en `auth.place.community` queda como buena práctica defensiva, no obligación. Custom domains se allowlistan con su `https://` al verificar el dominio (fuera de S1).
- **Gotcha cookies `__Secure-`.** Neon Auth prefija `__Secure-`; los browsers rechazan esas cookies sobre `http://` plano. **Dev local necesita HTTPS** (mkcert/equivalente). Canónico: `docs/gotchas/neon-auth-secure-cookie-https.md`. Afecta S1 (setup de dev).
- **Email verification NO bloquea el alta** (ADR-0005 §9). El place se crea sin verificar email. `emailVerified` se lee del **claim de sesión** (proviene de `neon_auth.user.emailVerified`) y **gatea las mutaciones de `/settings`** del place (post-S1), no el alta. Lectura/uso del place durante el trial no requiere verificación.
- **Email provider = Resend** (`stack.md`, ADR-0005 §9): verificación de email y avisos de lifecycle. Reemplaza el sender "shared" de Neon Auth. Método exacto de verificación (OTP vs link) = TBD acotado a fijar al implementar (ADR-0005 §Consecuencias).

---

## 5. RLS base aplicada en esta feature

Canónico: ADR-0006 §2–3, `multi-tenancy.md` § RLS. **RLS incremental; la base owner entra en S1.** Esta feature aplica la base; el acceso de miembros NO está en la base (es deliberado) y se agrega por-feature, encima, en specs futuras.

### Policies que se crean en S1

- **`app_user`** — el usuario solo lee/actualiza su propia fila. Predicado:
  ```
  (select auth.user_id()) = app_user.auth_user_id
  ```
- **Tablas con `place_id`** (`membership`, `place_ownership`, `invitation`) — la fila pertenece a un place que el usuario actual ownea:
  ```
  EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = <tabla>.place_id
      AND au.auth_user_id = (select auth.user_id())
  )
  ```
- **`place`** — mismo predicado, referido a `place.id` en lugar de `<tabla>.place_id`.

Owner → CRUD completo solo en su place; places distintos quedan aislados automáticamente. La base **no concede nada a miembros**.

### Modelo rol/JWT (nombres exactos, verificados 2026-05-16)

- Queries de dominio bajo un **rol Postgres custom NO-admin** (sin `BYPASSRLS`), declarado con `pgRole('<rol>').existing()`; las policies se declaran `to`/`for` **ese rol custom**, NO el `authenticatedRole`/`anonymousRole` de la Data API. `neondb_owner` (admin) solo para migraciones `drizzle-kit`, nunca en runtime. Nombre exacto del rol y sus GRANT = TBD acotado a fijar en S1 (ADR-0006 §Consecuencias).
- Token: `await auth.getSession()` → **`session.access_token`** (JWT). Verificación con **`jose`** (`createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL))` + `jwtVerify`); el claim **`sub`** = `neon_auth.user.id`.
- Inyección de claims en la transacción: `select set_config('request.jwt.claims', <claims-json>, true)` dentro de `db.transaction`; las policies leen **`auth.user_id()`** (canónico; `auth.uid()` es de la Data API y no se usa).
- **Verificar empíricamente en S1** que `auth.user_id()` existe en el branch Neon (ver § Riesgos).
- Se expresa en Drizzle con `pgPolicy`/`crudPolicy` + predicados custom (`drizzle-orm/neon`).
- **Sin Data API y sin rol `anon`**: ningún grant a `anon`; todo acceso de dominio es autenticado y verificado server-side.

### Saga vs RLS

La saga (paso 2–3) corre tras `auth.signUp.email()` con la sesión del nuevo usuario: los `INSERT` de `app_user`/`place`/`place_ownership`/`membership` deben pasar las policies bajo el rol custom con los claims inyectados. **Punto a verificar en S1 (ver § Riesgos y `tests.md`):** que las policies base permiten el `INSERT` inicial del owner (en particular el `INSERT` de `place`/`place_ownership` cuando aún no existe la fila en `place_ownership` que el predicado consulta — orden de inserción dentro de la tx y/o `WITH CHECK` apropiados). Esto se diseña y prueba en S1; no se improvisa.

---

## 6. Flujo de invitación (diseño cerrado)

Canónico: ADR-0005 §4, `multi-tenancy.md` § "RLS e invitaciones". **En S1 se cierra el diseño y se aplica la RLS owner-only sobre `invitation` sin romper la aceptación futura.**

- **Creación/listado/revocación por el owner**: permitido por la base owner-only de S1 (la policy de `invitation` con `place_id` — §5). El owner genera invitaciones de su place; cada invitación tiene `email`, `token`, `expires_at`, `invited_by`.
- **`invitation.token` = capability** de alta entropía. La aceptación **NO pasa por la RLS del usuario** (la tabla `invitation` nunca queda expuesta a scan por usuarios): va por una **vía privilegiada server-side de un solo propósito** — `SECURITY DEFINER` o rol controlado acotado a esa operación — que en una tx:
  1. valida el token (existe, no expiró `expires_at`, no usado `accepted_at IS NULL`),
  2. exige que el **email de la cuenta que acepta coincida con `invitation.email`** (estricto — decidido, ADR-0005 §4),
  3. corre `ensureAppUser`,
  4. crea `membership` respetando **máx 150** y `UNIQUE(user_id, place_id)`,
  5. marca `invitation.accepted_at`.
- **Host del link:** `{slug}.place.community/invite/{token}`; si el place tiene **custom domain verificado** (`place_domain.verified_at IS NOT NULL` y `archived_at IS NULL`), `https://{custom-domain}/invite/{token}`.
- **Invariantes que enforza:** máx 150 miembros/place; `UNIQUE(user_id, place_id)` (un usuario no puede tener dos memberships activas en el mismo place); expiración (`expires_at`); revocación (el owner puede revocar; una invitación revocada/expirada no se acepta); `invitation.token UNIQUE`.
- **Importante:** la RLS owner-only sobre `invitation` se aplica desde S1 **sin romper** la aceptación, justamente porque la aceptación va por la vía privilegiada (no por la RLS del usuario invitado). El usuario invitado nunca necesita `SELECT` directo sobre `invitation` bajo su rol.
- **Excepción de diseño del alta:** la cuenta que se crea aceptando una invitación crea cuenta + `membership` **sin** crear place (ADR-0005 §4). La UI de aceptación y su Server Action son trabajo de la tanda de registro o inmediatamente posterior (ver `plan-sesiones.md`); "join desde directorio" es **otro** flujo posterior con su propia policy, no se diseña acá.

---

## 7. Billing trial

Canónico: ADR-0005 §3, `data-model.md` (`place.trial_ends_at`), ADR-0003.

- Al crear el place, en la saga: `billing_mode = 'OWNER_PAYS'`, `subscription_status = 'ACTIVE'`, `trial_ends_at = now() + 30 días`.
- Durante el trial el place es **100% usable** y no se pide nada de pagos.
- El **gate del paywall y el cobro son posteriores** (no S1): al expirar el trial sin pago, el place entra al flujo `PAYMENT_PENDING` de ADR-0003. El mecanismo de cobro sigue TBD (Pagos, `stack.md`). S1 solo deja el arranque del trial y el disparador conceptual del paywall.

---

## 8. Default de `opening_hours`

Canónico: ADR-0007 §2, `data-model.md` § Shapes JSON.

- En la saga, al crear el place, `opening_hours` se setea a **09:00–20:00 todos los días** en el **timezone del owner** (shape: `{ timezone: "<IANA>", weekly: { mon..sun: [{open,close}] } }`).
- **El LLM no propone horario** (ADR-0007 §1).
- **Editable después en `/settings`** por el owner (gateado por email verificado) — no es parte del onboarding ni de S1.
- **Captura/derivación del timezone del owner — propuesta (punto a confirmar):** capturar el timezone del browser del owner en el paso 3 vía `Intl.DateTimeFormat().resolvedOptions().timeZone` (client-side, ya que el wizard es client-side hasta el submit), enviarlo en el payload del submit y persistirlo en `opening_hours.timezone`. Fallback determinístico si el browser no lo provee o es inválido: `America/Argentina/Buenos_Aires` (mismo valor de ejemplo del shape canónico en `data-model.md`). ADR-0007 §2 admite explícitamente "capturado en el onboarding o derivado del browser; a confirmar en la spec de feature" → **se propone derivar del browser con fallback fijo**; queda marcado como punto a confirmar con el humano antes de implementar S1 (ver § Contradicciones).

---

## 9. Riesgos / gaps abiertos a vigilar (no bloqueantes)

De ADR-0005/0006, `architecture.md`, `multi-tenancy.md`:

1. **Cache de sesión vs `exp` del JWT.** El SDK cachea la sesión en cookie firmada (~300s, `cookies.sessionDataTtl`). Validar en S1 que el `exp` del JWT no choque con ese cache (`multi-tenancy.md` § RLS).
2. **`auth.user_id()` a verificar empíricamente** en el branch Neon: confirmar que la función existe y que `set_config('request.jwt.claims', …, true)` la alimenta como se espera (ADR-0006 §3, `multi-tenancy.md`).
3. **Probe empírico de cookie — HECHO y PASÓ (2026-05-16).** Verificado sobre branch Neon de prueba: con `cookies.domain` → `Set-Cookie … Domain=.<apex>`; sin → host-only. ADR-0001 §1 confirmado empíricamente. Ya no es riesgo abierto (`architecture.md` § Sesión y SSO).
4. **Cookies `__Secure-` requieren HTTPS en dev (nuevo).** Browsers rechazan `__Secure-` sobre http plano → dev local debe ser HTTPS. Es un setup de S1, no un bloqueo de diseño. Ver `docs/gotchas/neon-auth-secure-cookie-https.md`.
5. **`conversaciones.md` cross-check del gate (post-S1).** El gate de horario no es S1, pero cuando se construya debe respetar `conversaciones.md` § "Comportamiento por horario" (miembro fuera de horario → `<PlaceClosedView>`; owner exceptuado) y `architecture.md` § Gate (vive en `[placeSlug]/(gated)/layout.tsx`, no por feature). Anotado para no perderlo de vista; no bloquea el onboarding.
6. **`INSERT` inicial del owner bajo RLS base** (ver §5 "Saga vs RLS"): el predicado de `place`/`place_ownership` consulta `place_ownership`; el orden de inserción y los `WITH CHECK` deben permitir el alta del primer owner. Diseñar y probar en S1; no improvisar.

---

## 10. Contradicciones / zonas a confirmar

No se resuelven acá — las decide el humano antes de implementar:

1. **Timezone del owner (ADR-0007 §2 lo deja "a confirmar en la spec").** Propuesta de esta spec: derivar del browser (`Intl…resolvedOptions().timeZone`) con fallback `America/Argentina/Buenos_Aires`. **A confirmar:** ¿se acepta derivar del browser, o se prefiere un selector explícito de timezone en el paso 3 (más fricción, más preciso)? No es contradicción entre docs, es un punto que el canónico delegó explícitamente a esta spec.
2. **Wording legacy "hook transaccional al signup".** ADR-0005 §2, ADR-0001 §2 y notas viejas de `data-model.md` hablan de "hook transaccional". ADR-0006 §1 **reemplaza** ese wording por "Server Action orquestado + guard JIT" y `architecture.md`/`data-model.md` ya están corregidos. **No es contradicción abierta** (ADR-0006 es explícito en que ajusta ADR-0005 §2): esta spec sigue ADR-0006. Se anota solo para que nadie "corrija" la spec hacia el wording viejo de las ADR históricas (las ADR no se editan).
3. **Alcance de la aceptación de invitación en S1.** ADR-0005 §4 trata invitación/join como "flujos aparte, fuera del alcance owner-first de esta tanda", pero `multi-tenancy.md` exige que la RLS owner-only sobre `invitation` se aplique desde S1 sin romper la aceptación. No es contradicción real: en S1 entra **el diseño cerrado + la RLS owner-only sobre `invitation` + creación/listado/revocación por el owner**; la UI de aceptación `/invite/{token}` puede ir en la misma tanda o inmediatamente después. **A confirmar con el humano:** si la pantalla de aceptación se construye dentro de la tanda de registro (S2/S3 del plan) o se difiere a una sesión propia justo después. El plan de sesiones la ubica como sesión opcional al cierre.
4. **`landingpage/README.md` decisión 3b** dice que `/login` "bifurca crear/unirse/invitación". Esta spec cubre **crear** (owner-first) y deja el diseño de **invitación**; **unirse/join desde directorio** es explícitamente posterior (ADR-0005 §4). A confirmar: si la pantalla `/login` de S1 ya debe mostrar la bifurcación visual (crear vs tengo invitación) o solo el camino de creación con la invitación accesible por su link directo. Propuesta: `/login` ofrece "Creá tu place" (onboarding) y reconoce un link de invitación entrante; el "join desde directorio" no aparece (no existe directorio aún).

---

## 11. Checklist de feature (de `architecture.md`) aplicado a onboarding

- [ ] Todos los archivos viven dentro de `src/features/<feature>/` — el onboarding vive en `src/features/onboarding/` (UI del wizard, schemas Zod, Server Action de la saga, queries). El routing host-based + `(marketing)/(app)` son estructura de `src/app/` (rutas delgadas que delegan al feature) + `src/middleware.ts`; `ensureAppUser`, `reserved-slugs`, derivación de paleta y cliente DB/Drizzle viven en `shared/` (agnósticos al dominio o infra). El acceso a auth/Neon Auth puede ser un módulo de `shared/lib` consumido por el feature.
- [ ] No hay imports cruzados hacia archivos internos de otras features — onboarding solo consume `shared/` y `db/`; ninguna otra feature existe aún. `shared/` nunca importa de `features/`.
- [ ] Respeta los límites de tamaño (`CLAUDE.md`: archivo ≤300, función ≤60, feature ≤1500, módulo `shared/` ≤800) — el wizard se divide en componentes por paso; la saga es un servicio acotado.
- [ ] Dependencias externas son solo `db/`, `shared/` y otras features vía `public.ts` — onboarding expone su superficie por `src/features/onboarding/public.ts` (lo que `src/app/` necesite renderizar).
- [ ] Existe spec en `docs/features/onboarding/` — este directorio.
- [ ] Respeta los principios no negociables de experiencia (`producto.md`) — cozytech (nada grita/urgencia/contadores), customización activa no algorítmica (LLM propose-only + confirm), continuidad visual con la landing (paleta Papel default).
- [ ] `pnpm test` y `pnpm typecheck` pasan en verde — TDD obligatorio en el core (ver `tests.md`).

---

## Referencias

- ADR-0001 (OIDC/identidad separada/custom domains), ADR-0002 (roles/handle), ADR-0003 (lifecycle/trial→paywall), ADR-0004 (Drizzle), ADR-0005 (onboarding), ADR-0006 (provisión `app_user`/RLS/rol-JWT), ADR-0007 (LLM sin horario / horario default).
- `architecture.md` §§ Onboarding, Routing multi-tenant, RLS y modelo rol/JWT, Sesión y SSO, Gate de horario, Streaming.
- `data-model.md` (schema, shapes `theme_config`/`opening_hours`, invariantes).
- `multi-tenancy.md` (routing host-based, RLS base + rol/JWT, RLS e invitaciones, slug, reservados).
- `stack.md`, `producto.md`, `ontologia/miembros.md`, `ontologia/conversaciones.md`, `landingpage/README.md`.
- `docs/features/onboarding/plan-sesiones.md`, `docs/features/onboarding/tests.md`.
</content>
</invoke>
