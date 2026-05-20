# Hub post-login (`app.place.community`) — V1: lista de tus lugares

> _Spec creado 2026-05-19, revisado 2026-05-19 (audit + sidebar/mobile-first)_. Status: V1 listo para implementar. Cierra los gaps que `multi-tenancy.md:10`, `architecture.md:49+54` y ADR-0001 §36 dejaron prometidos pero no especificados.

## Contexto

`app.place.community` es el **hub del usuario autenticado** en la plataforma: el punto de aterrizaje natural tras "me identifico desde place.community". Hoy es un placeholder estático (`src/app/(app)/inbox/page.tsx` → "Tu espacio · Acá vas a ver…"). Esta spec lo convierte en un hub navegable que en V1 entrega **una vista funcional** (lista de tus lugares) y la **arquitectura del navegador** (topbar + sidebar mobile-first) preparada para las próximas vistas.

El hub no es un dashboard. Sigue los principios de `producto.md`: nada grita, sin métricas competitivas, sin notificaciones agresivas. Es un **selector explícito** donde el owner/miembro elige qué hacer.

## Alcance V1 (esta spec)

**Arquitectura del hub (mobile-first):**
- **Topbar** superior — logo placeholder + título de la vista actual + (mobile) botón hamburger + avatar a la derecha con menú "logout".
- **Sidebar** lateral izquierda — 3 ítems de navegación con icono + label:
  - "Tus lugares" — activo, V1.
  - "Mensajes" — disabled con badge "Próximamente" (cubre DMs, `ontologia/miembros.md:161-177`).
  - "Actividad" — disabled con badge "Próximamente" (cubre futura "gestión multi-place").
- **Main content** — la vista actual ocupa el resto.
- **Mobile** (<768px): el sidebar colapsa a drawer; el hamburger del topbar lo abre/cierra; main content full width; tap fuera del drawer lo cierra.

**Vista "Tus lugares" (única implementada en V1):**
- Lista de places donde el usuario es **owner o miembro activo** (`membership.left_at IS NULL` + `place_ownership` cuando aplica).
- Por cada place: ícono coloreado (theme.accent + iniciales del nombre) + nombre + subdomain (texto secundario) + acción "Entrar" + acción "Configurar" (sólo si owner) + "Miembro desde {fecha}" + badge de estado si el place NO está ACTIVE.
- Orden: **owner-first + alfabético** dentro de cada grupo.
- Click "Entrar" → abre `https://{slug}.place.community/` en **nueva pestaña**.
- Click "Configurar" → abre `https://{slug}.place.community/settings` en **nueva pestaña**.
- Estado vacío (cuenta sin places): dos CTAs — "Crear un lugar" (link a `place.community/{locale}/crear` — abre misma pestaña, el user está creando) + "Sumarme a un lugar" (V1 disabled con "Próximamente", `features/README.md:75` lo marca Roadmap).

**Auth + redirects (per G1 del audit, nueva estrategia):**
- **Landing pública (`place.community/{locale}/`)** sigue 100% static — sin auth check, sin redirect. El user logueado puede visitarla normalmente.
- **`/login`** (apex marketing) chequea sesión ANTES de renderizar el form. Si hay sesión válida → `redirect("https://app.place.community/{locale}/")`. Si no → muestra form normal.
- **`/crear`** (apex marketing, wizard) chequea sesión ANTES de renderizar. Si hay sesión válida y el path es entrada directa (no proveniente del wizard authed) → `redirect("https://app.place.community/{locale}/")`. Esto previene que un user logueado caiga en el wizard place-first por accidente.
  - **Excepción:** desde el estado vacío del hub, el CTA "Crear un lugar" lleva a `/crear` con un query param o flag que indica "autenticado, mostrar wizard authed". La página detecta y muestra el wizard en modo authed (skip Paso 3 cuenta).
- **Hub (`app.place.community/{locale}/`)** chequea sesión PRIMERO. Si null → `redirect("https://place.community/{locale}/login")`.

**i18n del hub:**
- Path prefix obligatorio en zona hub: `app.place.community/es/`, `/en/`, `/fr/`, `/pt/`.
- Cookie de next-intl persiste la preferencia entre sesiones.
- V1 sólo `es` poblado en messages; otros locales caen a `defaultLocale: "es"` per config existente. EN/FR/PT entran cuando la traducción se ejecute (Roadmap, `features/README:58`).

## Fuera de V1 (diferido a V2)

- **Vista "Mensajes" (DMs)** — `ontologia/miembros.md:161-177`. V1 sólo el ítem del sidebar disabled. V2 implementa la vista.
- **Vista "Actividad" (gestión multi-place)** — Parked per `features/README:72` (Gestión multi-place centralizada). V1 sólo el ítem del sidebar disabled.
- **Custom domains** en "Entrar" — V1 sólo subdomain `{slug}.place.community`. V2 prefiere el custom verificado cuando exista `place_domain.verified_at`.
- **Branding del place** (logo/imagen real) — V1 muestra cuadrado de color con iniciales. V2 cuando Storage TBD entre.
- **Switch de cuenta** (multi-identity) — no V1.
- **Búsqueda/filtro** de la lista — V1 sin búsqueda (el usuario típico tendrá <10 places).
- **Botón "Volver al hub" dentro de un place** — entra con la spec de "place miembro UI" (no esta spec).
- **Logout SSO cross-RP global** — V1 logout del apex desautentica subdomains (cookie compartida); custom domains no aplica todavía.
- **Tombstoned/purged places (12m+ INACTIVE)** — no aparecen físicamente (purga real per ADR-0003).

## Journeys

### A) Desde el apex `place.community` (multi-place — flujo principal)

```
1. User visita https://place.community/{locale}/ → landing pública (sin cambios, static).
2. Click "Iniciar sesión" → /{locale}/login.
3. Server-side check: ¿hay sesión? No → renderiza form.
4. Completa email + password → submit → cookie Domain=.place.community se establece.
5. Server Action de login retorna ok → cliente navega a https://app.place.community/{locale}/
   (cross-subdomain — la cookie apex aplica).
6. Server-side del hub: ¿hay sesión? Sí (cookie válida) → renderiza hub con vista "Tus lugares".
7. Click "Entrar" en un place → nueva pestaña a {slug}.place.community/
8. (Si owner) Click "Configurar" → nueva pestaña a {slug}.place.community/settings
9. El hub sigue abierto en la pestaña original.
```

**Variantes:**
- A.1 — User logueado visita `/login` directo → server-side redirect a hub.
- A.2 — User logueado visita `/crear` directo (no desde estado vacío del hub) → redirect a hub.
- A.3 — User logueado visita `place.community/` (landing) → ve la landing igual (landing no hace check de sesión).
- A.4 — Cuenta sin places → ve estado vacío con CTAs.

### B) Desde subdomain o custom domain (un place puntual — sin pasar por hub)

```
1. User visita https://mi-lugar.place.community/{locale}/login (o https://mi-lugar.com/...).
2. Completa login → cookie cross-subdomain (apex .place.community) o SSO OIDC (custom).
3. Server-side: redirect a https://mi-lugar.place.community/{locale}/ (home del place).
4. Listo. El hub no se atraviesa.
```

**Variantes:**
- B.1 — User ya logueado visita el subdomain directo → SSO automático (cookie apex aplica), entra al home del place sin login.
- B.2 — User logueado visita el `/login` del subdomain → redirect al home del mismo place.

**Nota:** journey B describe el comportamiento target. La spec del "place miembro UI" lo implementa; esta spec del hub sólo lo documenta para cerrar la matriz.

## Estructura de routes (cambio relevante)

```
src/app/
├── (marketing)/
│   └── [locale]/
│       ├── page.tsx           # landing (static, sin auth check) ✓
│       ├── login/
│       │   └── page.tsx       # check sesión → redirect a hub si logueado
│       └── crear/
│           └── page.tsx       # check sesión → redirect a hub si logueado (con excepción del estado vacío)
└── (app)/
    ├── layout.tsx              # multi-root <html> SIN lang fijo (lo provee el sublayout)
    ├── inbox/                  # prefix INTERNO invisible al user (proxy rewrite a este path)
    │   └── [locale]/
    │       ├── layout.tsx     # <html lang={locale}> + <NavHub /> (topbar + sidebar) + outlet
    │       ├── page.tsx       # vista principal: lista de places
    │       ├── not-found.tsx
    │       └── (futuro dms/, actividad/)
    └── place/
        └── [placeSlug]/
            ├── layout.tsx     # multi-root distinto, sin NavHub (es zona place, chrome propia)
            └── page.tsx
```

**Cambio en `proxy.ts`** — pasar `intlMiddleware` también en zone inbox + propagar cookies/headers (patrón oficial next-intl "Composing other middleware"):

```ts
if (target.zone === "marketing") return intlMiddleware(req);

if (target.zone === "inbox") {
  // 1. next-intl corre primero: resuelve locale, agrega prefix (302) si falta,
  //    setea cookie `NEXT_LOCALE` si cambió.
  const intlResponse = intlMiddleware(req);

  // 2. Si intl redirigió (302), propagamos tal cual — la cookie va con el redirect.
  if (intlResponse.status >= 300 && intlResponse.status < 400) return intlResponse;

  // 3. intl pasó (200/next). Aplicamos el rewrite al prefix interno /inbox/,
  //    PROPAGANDO cookies/headers que intl pudo setear (NEXT_LOCALE, etc).
  const url = req.nextUrl.clone();
  const rest = url.pathname === "/" || url.pathname === "/inbox" ? "" : url.pathname;
  url.pathname = `/inbox${rest}`;
  const rewriteResponse = NextResponse.rewrite(url);
  intlResponse.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie));
  intlResponse.headers.forEach((value, key) => {
    // Headers que next-intl setea por compatibilidad con el server (e.g. x-next-intl-locale)
    if (key.toLowerCase().startsWith("x-")) rewriteResponse.headers.set(key, value);
  });
  return rewriteResponse;
}

// zone place sigue igual
```

**Por qué la propagación importa:** next-intl setea `NEXT_LOCALE` cookie + headers `x-next-intl-*` que su contexto server-side consume. Sin propagar, el `getTranslations({ locale })` del page no recibe el locale correcto.

**Edge case del rewrite:** el path literal `/inbox` (typo o bookmark del user) se trata como raíz, evita el 404 `/inbox/inbox` interno.

**Cookie `NEXT_LOCALE` cross-subdomain:** debe tener `Domain=.place.community` para que la preferencia de locale persista entre apex (donde el user setea inicial) y hub. Verificar en sesión 5 si la config actual de next-intl la setea así; si no, agregar `cookies: { domain: ".place.community" }` en el config.

**Si la composición da fricción en implementación:** dos fallbacks production-grade:
- **F1:** Configurar next-intl con `getRequestConfig` server-only (sin middleware en zone inbox); el locale se extrae del path manualmente en el layout. Pierde la cookie auto-set pero es más simple.
- **F2:** Crear ADR-0022 con la decisión técnica final del compose pattern, basada en la evidencia de sesión 5.

**Eliminar `src/app/(app)/layout.tsx`** o convertirlo a un fragment vacío que no provea `<html>` — el `<html>` ahora vive en los sublayouts (`(app)/inbox/[locale]/layout.tsx` y `(app)/place/[placeSlug]/layout.tsx`) para soportar `lang` dinámico/propio por zona.

## Pantalla — comportamiento detallado

### Topbar (mobile-first)

**Desktop (≥768px):** logo izquierda + título de vista al centro/izquierda + avatar derecha. Click avatar → dropdown calmo con "Cerrar sesión".

**Mobile (<768px):** hamburger izquierda + título centrado + avatar derecha. Click hamburger → drawer del sidebar slide-in desde la izquierda con overlay semitransparente. Click overlay o swipe-left → cierra drawer.

El avatar muestra iniciales sobre cuadrado de color del producto (no del place — el hub no tiene "color" propio del place, usa la paleta del producto). V1 sin storage de avatar real (Storage TBD per `features/README:80`).

### Sidebar (mobile-first)

**Desktop:** ancho fijo ~240px, fondo `surface`, items con icono + label, item activo con fondo `accent-strong` (color del producto, no del place).

**Mobile:** drawer overlay (no push), ancho ~280px, slide-in/out animation calma (200ms, prefers-reduced-motion respect).

**Items V1:**
1. **Tus lugares** — icono ✚, label en `inbox.sidebar.places`. Activo por default (única vista implementada).
2. **Mensajes** — icono ✉︎, label `inbox.sidebar.messages`. `aria-disabled="true"`, tooltip "Próximamente".
3. **Actividad** — icono 📊, label `inbox.sidebar.activity`. `aria-disabled="true"`, tooltip "Próximamente".

**Diseño visual:** Tailwind sólo layout/spacing; colores con tokens del producto (`bg-surface`, `text-ink`, `border-border`, `bg-accent-strong`, `text-muted`). NO clases de color hardcoded (`producto.md`).

### Lista de places — "Tus lugares"

**Orden V1:**
1. Owner primero, miembro después.
2. Alfabético `lower(p.name)` dentro de cada grupo (case-insensitive).

**Card layout (mobile-first):**
- Cuadrado color (theme.accent del place) + iniciales del nombre — 48px en mobile, 64px en desktop.
- Texto principal: nombre del place (font-medium).
- Texto secundario: `{slug}.place.community`.
- Pequeño: "Miembro desde {mes año}".
- Badge si status ≠ ACTIVE (ver §"Badges de estado" abajo).
- Acciones: 
  - "Entrar" — primario calmo, full-width en mobile, inline en desktop.
  - "Configurar" — secundario, sólo si `isOwner`. Inline siempre.
  - Ambos `<a target="_blank" rel="noopener noreferrer">`.

**Badges + acciones por estado (G7 + G4 refinado):**

| `subscription_status` | Badge | "Entrar" | "Configurar" | Visual |
|---|---|---|---|---|
| `ACTIVE` | (ninguno) | ✓ | ✓ (si owner) | Normal |
| `PAYMENT_PENDING` | "Pago pendiente" | ✗ | ✗ | Atenuado |
| `INACTIVATION_PROCESS` | "En recuperación" | ✗ | ✗ | Atenuado |
| `INACTIVE` | "Cerrado" | ✗ | ✗ | Atenuado |

**Decisión clave (G4):** sólo los places **ACTIVE** tienen acciones de entrada. Los demás se muestran (el user sabe que existen) **pero NADA sugiere que se puede entrar** — sin botón "Entrar", sin botón "Configurar", el card entero está visualmente atenuado (opacity reducida, sin hover de "clickable"). Sólo nombre + slug + miembro desde + badge.

**Por qué no mostrar acciones disabled** (vs. ocultarlas): mostrar un botón disabled invita a clickearlo y frustra ("¿por qué no puedo?"). Ocultarlo elimina la fricción: el estado lo cuenta el badge, sin promesa rota. Coherente con `producto.md` §25 ("sin urgencia artificial") y §29 ("nada grita").

**Tokens visuales:** `bg-muted` (gris suave) para badge "Cerrado"; `bg-warn` (cálido) para "Pago pendiente"; `bg-info` (frío) para "En recuperación". Si los tokens `bg-warn`/`bg-info` no existen en el design system del producto, se agregan en sesión 4. Card atenuado: `opacity-60` Tailwind utility (sólo para affordance visual, no para color del place).

**Regularización de pagos (futuro):** cuando exista la feature `/settings/billing`, el owner verá un link "Regularizar" o similar en su card PAYMENT_PENDING. V1 no incluye link — el owner tiene que ir por otro lado (TBD). El badge le indica el estado; la acción de pago vive en su propia spec.

### Estado vacío

Centrado, calmo:

> **Todavía no tenés ningún lugar.**
> Podés crear el tuyo o sumarte a uno con una invitación.

Dos botones:
- **"Crear un lugar"** — link a `place.community/{locale}/crear?from=hub` (query param avisa al wizard que el user ya está authed → muestra wizard authed directo, sin Paso 3 cuenta).
- **"Sumarme a un lugar"** — disabled con tooltip "Próximamente".

### Loading + error

- **Loading**: hub es Server Component, render sync con la query. Sin spinner V1 (la query única bien indexada va <100ms en `iad1`).
- **Error de carga**: si la query/DB function falla, render calmo: "No pudimos cargar tus lugares. Probá recargar." + botón. Loggea server-side el error real. No expone detalles técnicos.

### Menú de cuenta (logout)

Click avatar → dropdown con un solo ítem V1: "Cerrar sesión".

Submit → Server Action `logoutAction`:
1. `await getAuth().signOut()` (Neon Auth — invalida la cookie apex `Domain=.place.community`).
2. `redirect("https://place.community/{locale}/")` (landing pública).

La invalidación de la cookie apex desautentica TODOS los subdomains que comparten esa cookie. Custom domains (futuros) no se desautentican automáticamente — ver §Diferidos.

## Auth guard mechanism

El page del hub (`src/app/(app)/inbox/[locale]/page.tsx`) es Server Component. Su primer línea es el guard de autenticación, idéntico al patrón actual de los Server Actions authed (ADR-0018):

```ts
// Pseudocódigo del page principal del hub.
export default async function HubPage({ params }: { params: { locale: string } }) {
  const { locale } = await params;

  // 1. Obtener JWT JWKS-verificable de la sesión actual (ADR-0018 §"acquireSessionJwt").
  //    Si no hay sesión → null → redirect al login del apex.
  const token = await acquireSessionJwt();
  if (!token) {
    redirect(`https://place.community/${locale}/login`);
  }

  // 2. Cargar i18n del namespace del hub + nav-hub.
  const t = await getTranslations({ locale, namespace: "inbox" });
  const tNav = await getTranslations({ locale, namespace: "navHub" });

  // 3. Invocar la stored function con el token verificado (RLS-safe).
  //    `getAuthenticatedDb` setea las claims tx-local antes de la query.
  const payload = await getAuthenticatedDb(token, async (executor) => {
    return getInboxPayload(executor);
  });

  // 4. Render: layout shell (topbar+sidebar) + vista de places.
  return (
    <NavHubLayout labels={navHubLabelsFrom(tNav)} displayName={payload.displayName}>
      <PlacesView labels={inboxLabelsFrom(t)} payload={payload} />
    </NavHubLayout>
  );
}
```

**Helper `acquireSessionJwt()`**: ya existe en `src/shared/lib/` (per ADR-0018) — extrae el JWT verificable de la sesión del Neon Auth `auth().token()`. Retorna `string | null`. Si null, no hay sesión válida y el guard redirige.

**Helper `getAuthenticatedDb(token, fn)`**: ya existe en `src/shared/lib/db.ts:22-44` — verifica el JWT, abre una TX con `app_system` rol, setea claims, ejecuta `fn(executor)`, commit/rollback. La stored function `app.get_inbox_payload()` corre dentro de esa TX y lee `app.current_user_id()` de los claims inyectados.

**Sin caché de sessionIdentity necesaria en V1**: el page sólo invoca `acquireSessionJwt` una vez. Si en V2 el topbar también lo necesita (para mostrar email u otro dato no incluido en `displayName`), envolver en `React.cache()` para deduplicar en el mismo render.

---

## Modelo de datos + query centralizada (G6 — DB function)

**Decisión: una única stored function `app.get_inbox_payload()` que retorna el shape completo del hub** — perfil del user + lista de places. Una sola query, una sola fila resultante (JSON), planeada óptimo por Postgres.

```sql
-- Migration de la sesión 2.
CREATE OR REPLACE FUNCTION app.get_inbox_payload()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth text := app.current_user_id();
  v_user_id text;
  v_display_name text;
  v_places jsonb;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Perfil (RLS-safe: app_user.sel ya filtra a self)
  SELECT id, display_name INTO v_user_id, v_display_name
  FROM app_user WHERE auth_user_id = v_auth;

  IF v_user_id IS NULL THEN
    -- Cuenta legítima sin app_user (no debería pasar tras ADR-0018, pero defensivo)
    RETURN jsonb_build_object(
      'displayName', NULL,
      'places', '[]'::jsonb
    );
  END IF;

  -- Places del user (owner OR member activo, ordenados owner-first + alfabético)
  -- Visible bajo RLS post-ADR-0021 (place_sel + membership_sel extendidos)
  SELECT coalesce(jsonb_agg(row_to_jsonb(p) ORDER BY p.is_owner DESC, lower(p.name) ASC), '[]'::jsonb)
  INTO v_places
  FROM (
    SELECT
      p.id,
      p.slug,
      p.name,
      p.theme_config->>'accent' AS theme_accent,
      p.subscription_status::text AS status,
      EXISTS (
        SELECT 1 FROM place_ownership po
        WHERE po.place_id = p.id AND po.user_id = v_user_id
      ) AS is_owner,
      m.joined_at
    FROM membership m
    JOIN place p ON p.id = m.place_id
    WHERE m.user_id = v_user_id
      AND m.left_at IS NULL
      AND p.archived_at IS NULL
    -- Sin filtro de subscription_status: incluye ACTIVE, PAYMENT_PENDING,
    -- INACTIVATION_PROCESS, INACTIVE. El frontend filtra ACCIONES por status
    -- (ver §"Badges + acciones por estado"). Sólo TOMBSTONED/purgado queda
    -- fuera, y eso ya no existe físicamente.
  ) p;

  RETURN jsonb_build_object(
    'displayName', v_display_name,
    'places', v_places
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.get_inbox_payload() TO app_system;
```

**Por qué `SECURITY INVOKER` (no DEFINER):**
- Respeta la RLS extendida del ADR-0021 (member-read). El user ve sus filas sin bypass.
- Permite que la función sea testeable bajo el patrón actual de `inRlsTx`.

**Por qué `JSONB` como retorno:**
- Una sola row al wire (vs N rows que requieren parseo cliente).
- Shape estable y autodocumentado.
- Postgres lo construye eficiente (jsonb_agg).

**Por qué stored function (no view):**
- Necesita conocer el `auth_user_id` (depende de la sesión vía `app.current_user_id()`).
- Hace 2 lookups (user + places) en una sola call atómica.
- Versionada con migrations.

**Performance target — 200ms p50:**

| Etapa | Target | Cómo |
|---|---|---|
| JWT verify (JWKS cached) | <5ms | `jose` library, JWKS cache en módulo |
| DB function (1 round-trip, indexed) | <30ms | índices: `membership(user_id, left_at)`, `app_user(auth_user_id)`, `place_ownership(user_id, place_id)`, `place(id)` |
| React Server render | <100ms | Server Component puro |
| Network al cliente | <50ms | gzip on |
| **Total p50** | **~185ms** | Fluid Compute `iad1` ↔ Neon `iad1` |

**Índices necesarios** (verificar/agregar en migration sesión 1):
- `membership(user_id, left_at, place_id)` — el filtro principal.
- `place_ownership(user_id, place_id)` — ya hay UNIQUE; suficiente.
- `app_user(auth_user_id)` — ya hay UNIQUE; suficiente.

## RLS — cierra el TBD de ADR-0010 (member-read)

ADR-0010 declaró: *"El acceso de miembros se agrega por-feature, encima, después."* Esta spec es la primera implementación. La decisión arquitectónica reusable va en **ADR-0021** (a crear en sesión 1):

> "Member-read se implementa **extendiendo la policy `_sel` con `OR exists(membership activa)`** en la tabla correspondiente, no creando funciones SECURITY DEFINER por feature. INSERT/UPDATE/DELETE siguen owner-only."

**Cambios concretos en RLS (migration sesión 1):**

```sql
-- 1. Extender place_sel: owner OR member activo
DROP POLICY "place_sel" ON place;
CREATE POLICY "place_sel" ON place FOR SELECT TO app_system USING (
  EXISTS (SELECT 1 FROM place_ownership po
          JOIN app_user au ON au.id = po.user_id
          WHERE po.place_id = place.id
            AND au.auth_user_id = (select app.current_user_id()))
  OR
  EXISTS (SELECT 1 FROM membership m
          JOIN app_user au ON au.id = m.user_id
          WHERE m.place_id = place.id
            AND m.left_at IS NULL
            AND au.auth_user_id = (select app.current_user_id()))
);

-- 2. Extender membership_sel: owner del place OR self
DROP POLICY "membership_sel" ON membership;
CREATE POLICY "membership_sel" ON membership FOR SELECT TO app_system USING (
  EXISTS (SELECT 1 FROM place_ownership po
          JOIN app_user au ON au.id = po.user_id
          WHERE po.place_id = membership.place_id
            AND au.auth_user_id = (select app.current_user_id()))
  OR
  EXISTS (SELECT 1 FROM app_user au
          WHERE au.id = membership.user_id
            AND au.auth_user_id = (select app.current_user_id()))
);

-- 3. Índice nuevo para el filtro principal del inbox
CREATE INDEX IF NOT EXISTS idx_membership_user_active
  ON membership(user_id, left_at, place_id);
```

**`place_ownership_sel` no cambia:** ya es self-only (`po_sel` checks `au.auth_user_id = po.user_id`). El `EXISTS(...)` dentro de la stored function resuelve el `is_owner` flag correctamente.

**INSERT/UPDATE/DELETE no cambian:** miembros sólo ganan SELECT.

## Slice + arquitectura

**Dos slices nuevos verticales** (paradigma `architecture.md` §17-25 — acíclicas, comunicación sólo vía `public.ts`):

```
src/features/inbox/                       # slice del dominio "lista de places del user"
├── public.ts
├── domain/
│   └── inbox-payload.ts                  # type InboxPayload, InboxPlace, PlaceStatus
├── queries/
│   └── get-inbox-payload.ts              # wrapper de la stored function
├── ui/
│   ├── places-view.tsx                   # Server Component: invoca query + render lista o empty
│   ├── place-card.tsx                    # componente puro (presentacional)
│   ├── place-status-badge.tsx            # componente puro: badge según status
│   ├── empty-state.tsx                   # componente puro: CTAs crear/sumarme
│   └── inbox-labels.ts                   # interface InboxLabels
└── __tests__/
    ├── get-inbox-payload.test.ts         # DB integration
    ├── places-view.test.tsx              # RTL
    ├── place-card.test.tsx
    ├── place-status-badge.test.tsx
    └── empty-state.test.tsx

src/features/nav-hub/                     # slice del navegador (topbar + sidebar + layout shell)
├── public.ts
├── ui/
│   ├── nav-hub-layout.tsx                # Server Component: layout shell (topbar+sidebar+children)
│   ├── topbar.tsx                        # Server Component: avatar + slot + hamburger
│   ├── sidebar.tsx                       # Server Component: items (Server) + drawer state (Client child)
│   ├── sidebar-drawer.tsx                # Client Component: estado abierto/cerrado en mobile
│   ├── account-menu.tsx                  # Client Component: dropdown logout
│   └── nav-hub-labels.ts                 # interface NavHubLabels
├── actions/
│   └── logout-action.ts                  # Server Action: signOut + redirect cross-subdomain
└── __tests__/
    ├── sidebar.test.tsx                  # items, disabled state
    ├── sidebar-drawer.test.tsx           # toggle, overlay, esc/click-outside
    ├── account-menu.test.tsx             # menu open/close, logout submit
    └── nav-hub-layout.test.tsx           # render integración
```

**Por qué `nav-hub` aparte de `inbox`:** el nav-hub es transversal — reusado por toda la zona `app.place.community/*` (V1: una vista; futuro: DMs, actividad). El slice `inbox` es sólo la vista de "tus lugares". Separación de concerns = ambos crecen independientes.

**Dependencias acíclicas:**
- `inbox` → `shared/lib` (db helpers, sessionIdentity).
- `nav-hub` → `shared/lib` (sessionIdentity, signOut wrapper).
- Route `src/app/(app)/inbox/[locale]/page.tsx` → `inbox/public.ts` + `nav-hub/public.ts` (vía layout).
- `inbox` y `nav-hub` NO se conocen entre sí.

## i18n keys

V1 sólo `es` poblado. Otros locales caen al default. Estructura en `src/i18n/messages/es.json`:

```json
{
  "inbox": {
    "viewTitle": "Tus lugares",
    "cardEnter": "Entrar",
    "cardSettings": "Configurar",
    "cardMemberSince": "Miembro desde {date}",
    "statusPaymentPending": "Pago pendiente",
    "statusInactivationProcess": "En recuperación",
    "statusInactive": "Cerrado",
    "emptyTitle": "Todavía no tenés ningún lugar.",
    "emptyBody": "Podés crear el tuyo o sumarte a uno con una invitación.",
    "emptyCreateAction": "Crear un lugar",
    "emptyJoinAction": "Sumarme a un lugar",
    "emptyJoinComingSoon": "Próximamente",
    "errorLoad": "No pudimos cargar tus lugares. Probá recargar.",
    "errorReload": "Recargar"
  },
  "navHub": {
    "sidebarToggleOpen": "Abrir menú",
    "sidebarToggleClose": "Cerrar menú",
    "sidebarPlaces": "Tus lugares",
    "sidebarMessages": "Mensajes",
    "sidebarActivity": "Actividad",
    "sidebarComingSoon": "Próximamente",
    "accountMenuLabel": "Menú de cuenta",
    "logout": "Cerrar sesión",
    "logoutConfirming": "Cerrando sesión…"
  }
}
```

`cardMemberSince` con `{date}` placeholder (resuelto client con `.replace`) — mismo patrón que `wizard.terms`. El formato de fecha por locale ("marzo 2024" en es, "March 2024" en en) lo resuelve un helper `formatMemberSince(date, locale)` que usa `Intl.DateTimeFormat`.

## Tests / TDD plan

Detalle en [`tests.md`](./tests.md). Resumen del scope V1: ~35 tests nuevos cubriendo RLS, stored function, query wrapper, components UI (places + nav-hub + sidebar + drawer mobile), redirects en `/login` y `/crear`, integration end-to-end.

## Mobile-first checklist

- Layout viewport responsive: 320px mínimo, breakpoint `md` (768px) cambia de drawer a sidebar fijo.
- Touch targets mínimo 44×44 px en mobile (botones, cards clickables, items del sidebar).
- `prefers-reduced-motion` respect: drawer slide-in usa transition reducida si está activo.
- Avatar + dropdown: tap-friendly en mobile (44×44 al menos), no hover (no funciona touch).
- Cards: full-width en mobile, stack vertical; en desktop grid 2 cols si hay espacio (>1024px).
- Sidebar drawer: cierre por tap-overlay + swipe-left + ESC key.

## Multi-tenancy.md update

Cuando se ejecute la sesión 5, agregar sección en `docs/multi-tenancy.md` que documente:
- URL canónica del hub: `app.place.community/{locale}/`
- Path interno de Next: `(app)/inbox/[locale]/` (invisible al user, detalle de implementación por route-group conflict de Next).
- Proxy: pasa `intlMiddleware` también en zone inbox.
- Sub-vistas futuras del hub: `app.place.community/{locale}/dms`, `/{locale}/actividad`.

## Decisiones del producto cerradas (con cita)

| # | Decisión | Origen |
|---|---|---|
| G1 | Verificación de sesión en `/login` y `/crear` (no en landing) | User §G1 |
| G2 | URL canónica = root del subdomain (path interno `/inbox/` invisible) | User §G2 |
| G3 | i18n con path prefix + cookie en zona hub | User §G3 |
| G4 | `access-flow.tsx` choice desaparece; post-login → redirect a hub | User §G4 |
| G5 | Topbar + sidebar sólo en hub; NO en places ni settings | User §G5 |
| G6 | DB stored function centraliza payload completo | User §G6 |
| G7 | Mostrar todos los places con badge de estado para no-ACTIVE | User §G7 |
| G8 | theme.accent siempre presente (preset o custom) | User §G8 |
| NEW | Hub con sidebar + topbar mobile-first | User §"sidebar como en las imagenes" |
| NEW | Sidebar V1: 3 items (Tus lugares activo, Mensajes/Actividad disabled) | User §"para ver places + DMs + gestionar multi-place futuro" |
