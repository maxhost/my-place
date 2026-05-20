# Tests del Hub V1 — TDD plan

> _Revisado 2026-05-19_. Compañía del [spec del hub](./spec.md). Detalla los tests que cubren genuinamente el comportamiento (no internals). Cada test responde a "¿qué dejaría de funcionar si esto no estuviera?"

## Mandato TDD (CLAUDE.md §47)

**Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core.**

## Lo que SÍ probamos (y por qué importa)

### 1. RLS member-read — el cambio más sensible (sesión 1)

**Por qué importa:** la base del aislamiento entre places. Si la extensión rompe `place_sel`, un tercero podría ver places ajenos (security incident).

**Tests** (en `src/db/__tests__/rls.test.ts`):

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| 1 | miembro activo VE place donde es miembro | 🔴 | 🟢 |
| 2 | miembro que se fue (`left_at NOT NULL`) NO VE place | 🟢 | 🟢 |
| 3 | tercero (ni owner ni miembro) NO VE place | 🟢 | 🟢 |
| 4 | owner sigue viendo TODO (regresión SELECT) | 🟢 | 🟢 |
| 5 | miembro VE su propia row de membership; NO la de otros | 🔴 (la primera assertion) | 🟢 |
| 6 | owner sigue viendo TODAS las membresías del place (regresión) | 🟢 | 🟢 |

**Patrón:** `inRlsTx` + `tx.seed` (con `RESET ROLE neon_owner`) + `tx.as("authX")` + assertion. Igual al patrón actual.

**Anti-regresión adicional:** correr la suite completa antes y después — confirma que ningún test existente se rompe.

### 2. Stored function `app.get_inbox_payload()` — DB integration (sesión 2)

**Por qué importa:** el hub renderea lo que esta función devuelve. Bugs aquí = users ven places ajenos, faltan los suyos, orden mal, shape incorrecto.

**Tests** (en `src/db/__tests__/get-inbox-payload.test.ts`, vitest + `inRlsTx`):

1. **`user sin places retorna {displayName: <name>, places: []}`** — seed sólo app_user; payload tiene displayName correcto + places vacío.
2. **`user con 2 places owner alfabéticos`** — seed "Bosque" y "Acuario" del mismo owner; payload.places en orden `[Acuario, Bosque]`, ambos `isOwner: true`.
3. **`user miembro (no owner) de 1 place lo ve, isOwner=false`** — seed pA owner uA, membership de uB; payload de uB ve `[{name: pA.name, isOwner: false, memberSince}]`.
4. **`user mixto (owner de 2, miembro de 1) — orden owner-first + alfabético DENTRO`** — uA owner de [Acuario, Zoom], miembro de Bosque; payload.places = `[Acuario, Zoom, Bosque]`.
5. **`places archivados (archived_at NOT NULL) NO aparecen`** — seed un place archivado; no está en el output.
6. **`memberSince viene como Date correcto`** — verifica parsing del joined_at desde JSON.
7. **`themeAccent extrae correctamente del theme_config.accent`** — seed con `theme_config = {"accent": "#aabbcc", ...}`; payload `themeAccent === "#aabbcc"`.
8. **`status viene como string del enum`** — seed places con distintos status; payload status correcto ("ACTIVE", "PAYMENT_PENDING", etc).
9. **`places no-ACTIVE aparecen (incluye PAYMENT_PENDING, INACTIVATION_PROCESS, INACTIVE)`** — sólo `archived_at NOT NULL` filtra.
10. **`sin auth (sesión inválida) → función lanza excepción 28000`** — `tx.as(null)` o equivalente; expect throw.

**Wrapper tests** (en `src/features/inbox/__tests__/get-inbox-payload.test.ts`):

11. **`parseo de JSON → InboxPayload`** — mock executor que retorna el JSON crudo; verifica que el wrapper convierte fechas y casa status al union.
12. **`displayName: null defensive`** — payload con `displayName: null` (caso defensivo del defensive branch); wrapper retorna tipo correcto sin throw.

### 3. UI components puros (sesión 3 nav-hub + sesión 4 inbox)

**Por qué importa:** componentes presentacionales son los que el user toca. Bugs = clicks rotos, settings visible para miembros, orden visual incorrecto, badges incorrectos.

#### Sidebar (sesión 3)

**Tests** (en `src/features/nav-hub/__tests__/sidebar.test.tsx`):

1. **Render 3 items con labels correctos del prop labels.**
2. **Item activo (prop `activeItem="places"`) tiene `aria-current="page"` y estilos visuales (clase activa).**
3. **Items disabled (`messages`, `activity`) tienen `aria-disabled="true"`.**
4. **Hover/focus sobre item disabled muestra tooltip "Próximamente" (accesible vía `getByRole("tooltip")` o `aria-describedby`).**
5. **Click en item disabled NO navega (no es `<a>` ni cambia URL).**
6. **Items habilitados son `<a>` con `href` correcto.**

#### Sidebar drawer (mobile-first, sesión 3)

**Tests** (en `src/features/nav-hub/__tests__/sidebar-drawer.test.tsx`):

1. **Drawer cerrado por default (no visible en DOM o `display: none`).**
2. **Click hamburger → drawer abre (visible) + overlay visible.**
3. **Click overlay → drawer cierra.**
4. **Press ESC → drawer cierra.**
5. **Touch targets de los items del sidebar ≥44×44 px (verificar via `getComputedStyle`).**
6. **`prefers-reduced-motion: reduce` → transición es instantánea (verificar via `matchMedia` mock).**

#### Account menu (sesión 3)

**Tests** (en `src/features/nav-hub/__tests__/account-menu.test.tsx`):

1. **Menú cerrado por default; click avatar lo abre.**
2. **Click "Cerrar sesión" → mock de `logoutAction` invocado exactamente 1 vez.**
3. **Durante logout (action pendiente) → muestra texto "Cerrando sesión…".**
4. **Click fuera del menú → cierra.**
5. **Avatar muestra iniciales correctas (prop `displayName="Ana López"` → "AL").**
6. **Avatar fallback si `displayName` es null → "?" o similar consistent.**

#### Nav-hub layout (sesión 3)

**Tests** (en `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx`):

1. **Render con children → topbar + sidebar + children visibles en desktop (viewport ≥768px simulado).**
2. **Mobile (viewport <768px): sidebar oculto por default, hamburger visible en topbar.**
3. **Title prop renderea en el centro del topbar.**

#### Place card (sesión 4)

**Tests** (en `src/features/inbox/__tests__/place-card.test.tsx`):

1. **Renderea nombre + subdomain `{slug}.place.community` + memberSince formateado.**
2. **Status ACTIVE + `isOwner: true` → botones "Entrar" Y "Configurar" visibles.**
3. **Status ACTIVE + `isOwner: false` → botón "Entrar" visible; "Configurar" AUSENTE (`queryByText("Configurar") === null`).**
4. **Status PAYMENT_PENDING → botón "Entrar" AUSENTE; botón "Configurar" AUSENTE (incluso si isOwner).**
5. **Status INACTIVATION_PROCESS → idem (sin acciones de entrada).**
6. **Status INACTIVE → idem (sin acciones de entrada).**
7. **Cards no-ACTIVE están visualmente atenuadas (clase `opacity-60` o equivalente).**
8. **Cards ACTIVE NO atenuadas (sin clase opacity).**
9. **Href "Entrar" (cuando existe) = `https://{slug}.place.community/`** (sin locale prefix — el subdomain del place gestiona su propio i18n).
10. **Href "Configurar" (cuando existe) = `https://{slug}.place.community/settings`.**
11. **Ambos links cuando renderean: `target="_blank" rel="noopener noreferrer"`.**
12. **Cuadrado coloreado usa `themeAccent` inline (`style.background` con hex).**
13. **Iniciales generadas correctamente: `name="Mi Club"` → "MC", `name="Yoga"` → "Y", `name="A B C"` → "AB" (max 2 chars).**

#### Place status badge (sesión 4)

**Tests** (en `src/features/inbox/__tests__/place-status-badge.test.tsx`):

1. **`status: "ACTIVE"` → no renderea nada (`container.firstChild === null`).**
2. **`status: "PAYMENT_PENDING"` → label "Pago pendiente" + clase de color cálido.**
3. **`status: "INACTIVATION_PROCESS"` → label "En recuperación" + clase de color frío.**
4. **`status: "INACTIVE"` → label "Cerrado" + clase de color muted.**

#### Empty state (sesión 4)

**Tests** (en `src/features/inbox/__tests__/empty-state.test.tsx`):

1. **Renderea las 2 CTAs.**
2. **"Crear un lugar" → href = `/{locale}/crear?from=hub`.**
3. **"Sumarme a un lugar" → `aria-disabled="true"` + tooltip "Próximamente".**
4. **Click en "Sumarme" NO navega.**

#### Places view (sesión 4)

**Tests** (en `src/features/inbox/__tests__/places-view.test.tsx`):

1. **Mock `getInboxPayload` retorna 3 places ordenados → DOM lista en ese orden.**
2. **Mock retorna `places: []` → `<EmptyState />` visible, no cards.**
3. **Mock retorna 1 place no-ACTIVE → badge visible.**
4. **Labels prop se propagan a children (smoke).**

### 4. Integration end-to-end (sesión 4)

**Por qué importa:** une todo (query + UI + orden). Si pasa, la pieza funciona.

**Test** (en `src/features/inbox/__tests__/places-view-integration.test.tsx`):

1. **`user con 3 places (2 owner Acuario+Zoom, 1 miembro Bosque) — flow completo`**:
   - Seed real en DB (vía `inRlsTx`).
   - Render `<PlacesView labels={LABELS} executor={fakeExecutorFromTx} />`.
   - Assert: 3 cards visibles, orden `[Acuario, Zoom, Bosque]`.
   - Acuario y Zoom tienen "Configurar"; Bosque no.
   - Href de Entrar de Acuario es `https://acuario.place.community/`.
   - "Miembro desde {mes año}" en Bosque con la fecha del seed.

### 5. Page routes — auth guards + redirects (sesión 5)

**Por qué importa:** evitar que el hub renderee sin sesión (vuln). Y evitar mostrar `/login` o `/crear` a alguien ya logueado (UX).

**Tests** (en `src/app/(app)/inbox/[locale]/__tests__/page.test.ts`):

1. **`sessionIdentity null → redirect a /es/login del apex`** — mock `sessionIdentity` returns null; verifica `redirect("https://place.community/es/login")` llamado.
2. **`sessionIdentity user → no redirect; renderea`** — mock con user válido; verifica `redirect` NO llamado; renderiza component tree.

**Tests** (en `src/app/(marketing)/[locale]/login/__tests__/page.test.ts`):

1. **`sessionIdentity user → redirect a hub`** — verifica `redirect("https://app.place.community/es/")` llamado.
2. **`sessionIdentity null → renderea form`** — `redirect` NO llamado, form visible.

**Tests** (en `src/app/(marketing)/[locale]/crear/__tests__/page.test.ts`):

1. **`sessionIdentity user, sin from=hub → redirect a hub`** — `redirect("https://app.place.community/es/")` llamado.
2. **`sessionIdentity user, with from=hub → renderea wizard authed`** — no redirect; wizard authed render.
3. **`sessionIdentity null, sin from=hub → renderea wizard place-first`** — no redirect; wizard placefirst.

**Nota:** los tests usan `vi.mock("next/navigation", () => ({ redirect: vi.fn(...) }))` pattern estándar de Next 16.

### 6. Access-flow simplificado (sesión 5)

**Tests** (adaptar `src/features/access/ui/__tests__/access-flow.test.tsx`):

**Eliminar tests obsoletos:**
- Tests de la fase "choice" (Crear / Unirme) — ya no existe.
- Tests del wizard authed dentro del access-flow — ya no path.

**Agregar tests:**
1. **`post-login ok → redirect cross-subdomain a hub`** — mock `loginAction` returns ok; verifica que el componente navega a `https://app.place.community/es/`.
2. **`post-signup ok → redirect cross-subdomain a hub`** — análogo para signup.
3. **`post-login error → muestra notice, NO redirect`** — mock returns error; notice visible, sin nav.

### 7. Proxy.ts update (sesión 5)

**Tests** (extender los existentes en `src/__tests__/proxy.test.ts` si existen, o crear):

1. **`zone marketing /` → pasa intlMiddleware`** (regresión).
2. **`zone inbox /es/` → rewrite a `/inbox/es/`.**
3. **`zone inbox / (sin locale) → intl redirect a /es/`** (verifica que intlMiddleware corre primero).
4. **`zone inbox /inbox (path literal) → tratado como root → rewrite a `/inbox/es/` o redirect a root con locale`.**
5. **`zone place /es/ → rewrite a `/place/mi-slug/es/`.**
6. **`zone inbox: cookies de intlMiddleware se propagan al rewrite`** — mock intlResponse que setea `NEXT_LOCALE` cookie; verifica que el rewrite final también la tiene. Sin propagación, el page del hub no recibiría el locale correcto.
7. **`zone inbox: headers x-next-intl-* se propagan al rewrite`** — análogo, mock intlResponse con `x-next-intl-locale` header; verifica preservado.

## Lo que NO probamos (decisión)

- **Performance 200ms** — variable por entorno. Se mide en producción con Vercel Speed Insights / manual. Spec lo registra como target.
- **SSO cross-domain (custom domain)** — V1 sólo subdomain; manual smoke en producción.
- **Logout cross-subdomain end-to-end** — manual en producción (jsdom no reproduce cookies cross-subdomain).
- **Cookie cross-subdomain en preview de Vercel** — preview = `*.vercel.app`, sin DNS real; smoke sólo en producción.
- **Visual regression** — no usamos snapshot tests salvo casos críticos. RTL `getByText`/`getByRole` cubre el contrato.
- **Animación visual del drawer** — no se valida en jsdom (no hace layout). Smoke manual en mobile real.

## Smoke manual (post-implementación, EN PRODUCCIÓN — no en preview)

Lista para ejecutar tras el push de la sesión 5:

### Flujos críticos

1. **Login apex con places existentes**:
   - Crear cuenta nueva en `place.community/es/login` (signup tab).
   - Login → debería terminar en `app.place.community/es/`.
   - Ver hub vacío con CTAs.
   - Click "Crear un lugar" (con `?from=hub`) → wizard authed → crea place.
   - Volver al hub (`app.place.community/es/`).
   - Ver 1 card del place creado.
   - Click "Entrar" → nueva pestaña al subdomain.
   - Click "Configurar" → nueva pestaña al subdomain `/settings` (404 esperado por ahora; URL correcta).

2. **Topbar logout**:
   - Click avatar → menú abre con "Cerrar sesión".
   - Click → redirect a landing pública.
   - Visitar `app.place.community/es/` directo → redirect a `/es/login` del apex.

3. **Redirects post-login**:
   - Logueado, visitar `place.community/es/login` → redirect a hub.
   - Logueado, visitar `place.community/es/crear` (sin `?from=hub`) → redirect a hub.
   - Logueado, visitar `place.community/es/crear?from=hub` → wizard authed.

4. **Cross-subdomain SSO**:
   - Logueado en apex, visitar `mi-club.place.community/es/` directo → SSO automático (cookie apex aplica).
   - Logueado en apex, visitar `mi-club.place.community/es/login` → redirect home del place.

### Mobile-first

5. **Mobile viewport (<768px, simulado en DevTools o phone real)**:
   - Hub: sidebar oculto por default, hamburger visible.
   - Tap hamburger → drawer slide-in desde la izquierda.
   - Tap overlay → drawer cierra.
   - Swipe-left en drawer → cierra (verificar — depende de gesture lib si la hay).
   - Touch targets ≥44×44 px (verificar visual + Lighthouse audit).
   - Cards stack vertical, full-width.

### Estados visuales

6. **Owner-first ordering**:
   - Cuenta con 2 places owner ("Bosque", "Acuario") + 1 miembro ("Yoga"). Orden `[Acuario, Bosque, Yoga]`.

7. **Acción "Configurar" sólo en owner**:
   - Place donde sos miembro NO muestra "Configurar".

8. **Badges de status**:
   - Si tenés acceso a un place PAYMENT_PENDING o INACTIVATION_PROCESS, verificar badge visible con texto correcto.
   - INACTIVE también visible.

### Sidebar (V1)

9. **Sidebar items**:
   - "Tus lugares" activo (highlighted).
   - "Mensajes" disabled con tooltip "Próximamente".
   - "Actividad" disabled con tooltip "Próximamente".
   - Tap en disabled NO navega.

### i18n (V1 sólo `es` poblado)

10. **Locale fallback**:
    - Cambiar cookie `NEXT_LOCALE=en` → reload `app.place.community/en/` → labels caen al `defaultLocale: "es"` (V1).
    - O mensaje "Translation missing" si next-intl está configurado así. Verificar.

### Performance

11. **Lighthouse en producción**:
    - Score Performance ≥90 en hub.
    - LCP <2.5s.
    - CLS = 0 (sin layout shift).
    - Total TTFB <300ms (200ms es nuestro target server-side; el resto es network).

## Métricas de cobertura

V1 esperado:
- ~6 tests RLS nuevos (sesión 1).
- ~10 tests DB function + wrapper (sesión 2).
- ~14 tests nav-hub components (sesión 3).
- ~18 tests inbox UI components (sesión 4 — sube por los casos por status en place-card).
- ~7 tests page routes (redirects + auth guards) (sesión 5).
- ~3 tests access-flow simplificado (sesión 5).
- ~7 tests proxy.ts (sesión 5 — incluye propagación de cookies/headers).

**Total esperado: ~65 tests nuevos**.

**Deltas en suite existente** (sesión 5):
- `access-flow.test.tsx`: drop ~5 tests obsoletos (fase choice + wizard authed dentro del flow).

**Total proyectado final:** ~248 tests (188 actuales + 65 nuevos − 5 obsoletos).
