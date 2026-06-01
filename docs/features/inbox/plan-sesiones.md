# Plan de implementación — Hub V1 (5 sesiones)

> **Estado (actualizado 2026-06-01): V1 implementada y en producción.** Las 5 sesiones de este plan se ejecutaron completas; el flujo end-to-end del hub (`app.place.community`) funciona. El fix posterior de apex-login honrando `returnTo` (S11.3, ADR-0033) cerró el último gotcha relacionado con la sesión cross-domain hacia el hub. Este plan queda como **referencia histórica** del desglose de implementación; los slices vivos son `src/features/nav-hub/` + `src/features/inbox/`.

> _Revisado 2026-05-19 tras audit (incorpora hub navegable + sidebar mobile-first + DB function + i18n en zona app)_. Divide el [spec del hub](./spec.md) en sesiones cortas y atómicas. TDD obligatorio (CLAUDE.md §47). Green-close completo antes de commit.

## Resumen

5 sesiones secuenciales (no paralelizables — cada una habilita la siguiente):

1. **RLS member-read + ADR-0021 + migration + índice** — extender `place_sel` y `membership_sel`; agregar índice; TDD rojo→verde de 6 casos RLS.
2. **DB function `app.get_inbox_payload()` + tests** — stored function que retorna perfil+places en JSON; tests integration.
3. **Slice `nav-hub`** (topbar + sidebar mobile-first + drawer + logout action + tests) — sin UI de places todavía; reusable independiente.
4. **Slice `inbox` UI** (vista "Tus lugares" + card + badge + estado vacío + tests) — consume el payload.
5. **Wiring: restructure routes con i18n + access-flow simplify + login/crear redirects + multi-tenancy.md update + smoke** — integra todo; el flujo end-to-end funciona.

Sesiones 1-2 son DB (cambios sensibles, sesiones propias). Sesiones 3-4 son UI separable por dominio (nav vs places). Sesión 5 es plumbing + integración (la más delicada de orden, sin código nuevo significativo).

---

## Sesión 1 — RLS member-read + ADR-0021 + migration + índice

### Objetivo

Cumplir la promesa de ADR-0010 ("acceso de miembros se agrega por-feature, encima, después") con un patrón canónico, y habilitar la query del hub bajo RLS pura.

### Pre-condiciones

- Branch limpia (`git status` vacío).
- Tests en `main` verdes.

### Trabajo

1. **Escribir ADR-0021** (`docs/decisions/0021-rls-member-read-pattern.md`):
   - Fecha 2026-05-XX, Estado Aceptada, Refina ADR-0010 §1.
   - Decisión: "member-read se implementa extendiendo `_sel` con `OR exists(membership activa)`. NO funciones SECURITY DEFINER por feature. INSERT/UPDATE/DELETE siguen owner-only."
   - Alternativas rechazadas: SECURITY DEFINER por feature (no escala).
   - Consecuencias: patrón aplicado primero al hub; futuras features que necesiten member-read extienden la policy correspondiente.
   - Update `docs/decisions/README.md` (línea de la ADR).
   - Banner en ADR-0010: `> **Refinada por ADR-0021 (cierra TBD de member-read).**`

2. **Crear migration** `src/db/migrations/0004_member_read.sql`:
   - DROP + recreate `place_sel` (owner OR member activo).
   - DROP + recreate `membership_sel` (owner del place OR self).
   - `CREATE INDEX IF NOT EXISTS idx_membership_user_active ON membership(user_id, left_at, place_id)`.
   - Idempotente (DROP IF EXISTS / CREATE IF NOT EXISTS).

3. **TDD: agregar tests en** `src/db/__tests__/rls.test.ts` ANTES de aplicar la migration:
   - **Test 1**: "miembro activo VE place donde es miembro" — FALLA en rojo (RLS actual deniega).
   - **Test 2**: "miembro que se fue NO VE place" — verde antes y después.
   - **Test 3**: "tercero NO VE place" — verde antes y después.
   - **Test 4**: "owner sigue viendo TODO" (regresión).
   - **Test 5**: "miembro VE su propia row de membership; NO la de otros" — primer assert FALLA en rojo, segundo verde.
   - **Test 6**: "owner sigue viendo TODAS las membresías de su place" (regresión).
   - Correr `pnpm test rls` → verificar rojo en los tests esperados, capturar output.

4. **Aplicar la migration**: `pnpm db:migrate` (o equivalente Drizzle). Verificar en Neon.

5. **Correr tests**: rojo → verde. Confirmar 188+6 (=194) tests passing.

6. **Green-close completo:** `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verdes.

7. **Commit**: 
   - Paths explícitos: docs ADR + banner, SQL nuevo, test nuevo.
   - Mensaje: `feat(rls): member-read en place + membership (ADR-0021, cierra TBD de 0010)`.

8. **NO push** hasta autorización explícita.

### Verificación end-to-end

```bash
pnpm typecheck && pnpm lint && pnpm test rls && pnpm test && pnpm build
# 194 tests passing
# migration 0004_member_read.sql aplicada
# ADR-0021 indexada en README + banner en ADR-0010
```

### Riesgos / gotchas

- **Recursión RLS**: el OR usa `EXISTS (SELECT 1 FROM membership ...)`. Como `membership_sel` también extiende, verificar con `EXPLAIN` que no hay loop.
- **Performance del OR**: doble predicado puede degradar. Verificar con `EXPLAIN ANALYZE` en un caso real.
- **Cross-feature regression**: `grep -rn "FROM place" src/` antes del commit. Hoy no hay features que asuman owner-only en SELECT — placeholder.

### Files

- **Crear**: `docs/decisions/0021-rls-member-read-pattern.md`, `src/db/migrations/0004_member_read.sql`.
- **Modificar**: `docs/decisions/README.md`, `docs/decisions/0010-rls-por-operacion-invitacion-token-link.md` (banner), `src/db/__tests__/rls.test.ts` (6 tests nuevos).

---

## Sesión 2 — DB function `app.get_inbox_payload()` + tests

### Objetivo

Centralizar TODA la consulta del hub en una stored function single-call. El Server Component invoca esta función y recibe el JSON completo (perfil + places). Una sola round-trip a DB.

### Pre-condiciones

- Sesión 1 mergeada (RLS extendida verificada en Neon).

### Trabajo

1. **Crear migration** `src/db/migrations/0005_inbox_payload_fn.sql`:
   - `CREATE OR REPLACE FUNCTION app.get_inbox_payload() RETURNS JSONB ...` (ver spec §"Modelo de datos").
   - `SECURITY INVOKER` (respeta RLS del user actual).
   - `GRANT EXECUTE ... TO app_system`.

2. **TDD: tests integration** `src/db/__tests__/get-inbox-payload.test.ts` (vitest + `inRlsTx`):
   - **Test 1**: user sin places → `{displayName: "Foo", places: []}`.
   - **Test 2**: user con 2 places owner alfabéticos → `places: [{Acuario, isOwner:true}, {Bosque, isOwner:true}]`.
   - **Test 3**: user miembro (no owner) de 1 place → `places: [{Yoga, isOwner:false, joined_at: ...}]`.
   - **Test 4**: user mixto (owner de 2, miembro de 1) → orden owner-first + alfabético dentro.
   - **Test 5**: places archivados (`archived_at NOT NULL`) NO aparecen.
   - **Test 6**: `theme_accent` viene correcto del `theme_config->>'accent'`.
   - **Test 7**: `status` viene como string (e.g. "ACTIVE", "PAYMENT_PENDING").
   - **Test 8**: sin auth (sin sesión) → raise exception '28000'.

3. **Wrapper TypeScript** `src/features/inbox/queries/get-inbox-payload.ts`:
   - `getInboxPayload(executor: SqlExecutor): Promise<InboxPayload>` que ejecuta `SELECT app.get_inbox_payload()::text AS payload` y parsea el JSON.
   - Tipo `InboxPayload` en `src/features/inbox/domain/inbox-payload.ts`:
     ```ts
     export type PlaceStatus = "ACTIVE" | "PAYMENT_PENDING" | "INACTIVATION_PROCESS" | "INACTIVE";
     export type InboxPlace = {
       id: string; slug: string; name: string;
       themeAccent: string; status: PlaceStatus;
       isOwner: boolean; memberSince: Date;
     };
     export type InboxPayload = {
       displayName: string | null;
       places: InboxPlace[];
     };
     ```
   - El wrapper convierte `joined_at` ISO string a `Date`, casa `status` al union literal.

4. **Tests wrapper** `src/features/inbox/__tests__/get-inbox-payload.test.ts`:
   - Smoke del parsing JSON → tipos.
   - Edge: `displayName: null` (defensive case).

5. **`public.ts` del slice** exporta `getInboxPayload`, tipos `InboxPayload`, `InboxPlace`, `PlaceStatus`.

6. **Green-close**: typecheck, lint, test, build.

7. **Commit**: paths explícitos. Mensaje: `feat(inbox): DB function app.get_inbox_payload() + wrapper + tipos`.

### Files

- **Crear**:
  - `src/db/migrations/0005_inbox_payload_fn.sql`
  - `src/db/__tests__/get-inbox-payload.test.ts`
  - `src/features/inbox/public.ts`
  - `src/features/inbox/domain/inbox-payload.ts`
  - `src/features/inbox/queries/get-inbox-payload.ts`
  - `src/features/inbox/__tests__/get-inbox-payload.test.ts` (smoke del wrapper)

---

## Sesión 3 — Slice `nav-hub` (topbar + sidebar + drawer mobile + logout)

### Objetivo

Implementar la arquitectura de navegación del hub (topbar + sidebar mobile-first), reusable por todas las vistas del subdomain `app.*`. Sin contenido de places todavía — sólo el shell.

### Pre-condiciones

- Sesión 2 mergeada (no hay dependencia técnica directa, pero sí del orden lógico del entregable).

### Trabajo

1. **Crear slice** `src/features/nav-hub/`:
   ```
   src/features/nav-hub/
   ├── public.ts
   ├── ui/
   │   ├── nav-hub-layout.tsx       # Server: layout shell (topbar+sidebar+children)
   │   ├── topbar.tsx               # Server: logo + título slot + avatar + hamburger en mobile
   │   ├── sidebar.tsx              # Server: items con icono + label
   │   ├── sidebar-drawer.tsx       # Client: estado open/close + overlay para mobile
   │   ├── account-menu.tsx         # Client: dropdown logout
   │   └── nav-hub-labels.ts        # interface NavHubLabels
   ├── actions/
   │   └── logout-action.ts         # Server Action: signOut + redirect cross-subdomain
   └── __tests__/
       ├── sidebar.test.tsx
       ├── sidebar-drawer.test.tsx
       ├── account-menu.test.tsx
       └── nav-hub-layout.test.tsx
   ```

2. **TDD para cada componente** — escribir tests ANTES:

   **`sidebar.test.tsx`:**
   - Render 3 items con labels correctos.
   - Item "Tus lugares" tiene `aria-current="page"` cuando es el activo.
   - Items "Mensajes" y "Actividad" tienen `aria-disabled="true"` + tooltip "Próximamente".
   - Items disabled no son clickables (no link).

   **`sidebar-drawer.test.tsx`** (mobile-first):
   - Drawer cerrado por default.
   - Click hamburger → drawer abre + overlay aparece.
   - Click overlay → drawer cierra.
   - Press ESC → drawer cierra.
   - `prefers-reduced-motion` reduces la transición.
   - Touch targets ≥44×44 px.

   **`account-menu.test.tsx`:**
   - Menú cerrado por default.
   - Click avatar → menú abre.
   - Click "Cerrar sesión" → invoca `logoutAction` (mock).
   - Durante logout muestra estado "Cerrando sesión…".
   - Click fuera del menú → cierra.

   **`nav-hub-layout.test.tsx`:**
   - Render con children → topbar + sidebar + children visibles en desktop.
   - Mobile (viewport <768px simulado): sidebar oculto por default, hamburger visible.
   - `displayName` prop se muestra en avatar (iniciales fallback si no hay).

3. **Implementar componentes** hasta que los tests pasen:
   - Tailwind sólo layout/spacing.
   - Colores con tokens del producto (`bg-surface`, `text-ink`, etc).
   - Iconos: SVG inline o `lucide-react` si está en el repo (verificar).
   - Animaciones: CSS transitions cortas (200ms), `prefers-reduced-motion` respect.

4. **`logoutAction`**:
   - Server Action.
   - `await getAuth().signOut()` — verifica que Neon Auth respeta `Domain=.place.community` (smoke en sesión 5).
   - `redirect("https://place.community/" + locale + "/")` — usa `rootDomain()` helper.

5. **`public.ts`** exporta `<NavHubLayout />`, types.

6. **Green-close**: typecheck, lint, test (suma tests del nav-hub), build.

7. **Commit**: paths explícitos. Mensaje: `feat(nav-hub): topbar + sidebar mobile-first + drawer + logout action`.

### Files

- **Crear** (10 archivos en el slice):
  - `src/features/nav-hub/public.ts`
  - `src/features/nav-hub/ui/nav-hub-layout.tsx`
  - `src/features/nav-hub/ui/topbar.tsx`
  - `src/features/nav-hub/ui/sidebar.tsx`
  - `src/features/nav-hub/ui/sidebar-drawer.tsx`
  - `src/features/nav-hub/ui/account-menu.tsx`
  - `src/features/nav-hub/ui/nav-hub-labels.ts`
  - `src/features/nav-hub/actions/logout-action.ts`
  - `src/features/nav-hub/__tests__/sidebar.test.tsx`
  - `src/features/nav-hub/__tests__/sidebar-drawer.test.tsx`
  - `src/features/nav-hub/__tests__/account-menu.test.tsx`
  - `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx`

(10 archivos pero todos del mismo slice + tests — coherente, aunque supera la regla "≤5". Si crece más, divide en 3.a y 3.b. Por dimensión real esperada cada archivo es chico (~50-100 LOC), manejable en una sesión.)

### Riesgos / gotchas

- **JSdom + Server Components**: testing Server Components puros con React Testing Library tiene limitaciones. Usar `renderToString` o stub el wrapping. Verificar precedente en el repo (e.g. `place-wizard.test.tsx`).
- **Drawer client state**: usar `useState` simple. El drawer es Client Component child del Server Sidebar.

---

## Sesión 4 — Slice `inbox` UI (vista "Tus lugares")

### Objetivo

Implementar la vista de places del hub: `<PlacesView />` (Server Component que invoca `getInboxPayload` + renderea cards o estado vacío) + componentes puros.

### Pre-condiciones

- Sesiones 2 y 3 mergeadas.

### Trabajo

1. **Agregar al slice `inbox`**:
   ```
   src/features/inbox/ui/
   ├── places-view.tsx              # Server: invoca query + render
   ├── place-card.tsx               # Puro: nombre + iniciales + acciones + status badge
   ├── place-status-badge.tsx       # Puro: badge según status (ACTIVE → null, otros → badge)
   ├── empty-state.tsx              # Puro: CTAs crear/sumarme
   └── inbox-labels.ts              # interface InboxLabels
   ```

2. **TDD para cada componente**:

   **`place-card.test.tsx`:**
   - Render nombre + slug subdomain + memberSince formateado.
   - **status ACTIVE**: 
     - `isOwner: true` → botón "Configurar" visible; `false` → ausente.
     - Botón "Entrar" visible.
     - Href "Entrar" = `https://{slug}.place.community/`.
     - Href "Configurar" = `https://{slug}.place.community/settings`.
     - Ambos `target="_blank" rel="noopener noreferrer"`.
     - Card sin atenuar (`opacity` normal).
   - **status NO-ACTIVE** (PAYMENT_PENDING, INACTIVATION_PROCESS, INACTIVE):
     - Botón "Entrar" AUSENTE (no se renderea, no `disabled`).
     - Botón "Configurar" AUSENTE incluso si `isOwner: true`.
     - Card atenuado (`opacity-60` o equivalente).
   - Cuadrado coloreado usa `themeAccent` inline (no clase Tailwind).
   - Iniciales generadas correctamente del nombre.

   **`place-status-badge.test.tsx`:**
   - `status: "ACTIVE"` → no renderea nada (`container.firstChild === null`).
   - `status: "PAYMENT_PENDING"` → label "Pago pendiente" + token `bg-warn`.
   - `status: "INACTIVATION_PROCESS"` → label "En recuperación" + token `bg-info`.
   - `status: "INACTIVE"` → label "Cerrado" + token `bg-muted`.

   **`empty-state.test.tsx`:**
   - 2 CTAs renderadas.
   - "Crear un lugar" href = `/{locale}/crear?from=hub`.
   - "Sumarme" disabled + tooltip "Próximamente".

   **`places-view.test.tsx`:**
   - Mock `getInboxPayload` → user con 3 places (2 owner alfabéticos, 1 miembro) → 3 cards en orden owner-first.
   - Mock `getInboxPayload` → user sin places → `<EmptyState />` renderea, no cards.
   - Mock con un place no-ACTIVE → badge visible.

3. **Implementar componentes** hasta verde.

4. **`public.ts`** del slice agregar exports UI: `<PlacesView />`, `InboxLabels`.

5. **Green-close**: typecheck, lint, test, build.

6. **Commit**: paths explícitos. Mensaje: `feat(inbox): vista "Tus lugares" + card + badge + empty state`.

### Files

- **Crear** (5 archivos UI + 4 tests):
  - `src/features/inbox/ui/places-view.tsx`
  - `src/features/inbox/ui/place-card.tsx`
  - `src/features/inbox/ui/place-status-badge.tsx`
  - `src/features/inbox/ui/empty-state.tsx`
  - `src/features/inbox/ui/inbox-labels.ts`
  - `src/features/inbox/__tests__/places-view.test.tsx`
  - `src/features/inbox/__tests__/place-card.test.tsx`
  - `src/features/inbox/__tests__/place-status-badge.test.tsx`
  - `src/features/inbox/__tests__/empty-state.test.tsx`
- **Modificar**: `src/features/inbox/public.ts` (exports nuevos).

---

## Sesión 5 — Wiring: routes restructure (i18n) + access-flow simplify + redirects + smoke

### Objetivo

Integrar nav-hub + inbox en la app, restructure routes para i18n en zona hub, simplificar access-flow, agregar redirects en `/login` y `/crear`, smoke manual end-to-end.

### Pre-condiciones

- Sesiones 1-4 mergeadas.

### Trabajo (orden recomendado)

1. **Restructure routes para i18n**:
   - Mover `src/app/(app)/inbox/page.tsx` → `src/app/(app)/inbox/[locale]/page.tsx` (página principal del hub).
   - Crear `src/app/(app)/inbox/[locale]/layout.tsx` con `<html lang={locale}>` + `<NavHubLayout labels={...}>` envolviendo `children`.
   - Crear `src/app/(app)/inbox/[locale]/not-found.tsx`.
   - Eliminar el `(app)/layout.tsx` actual (multi-root: cada sub-grupo provee `<html>`). Crear `src/app/(app)/place/[placeSlug]/layout.tsx` con `<html lang="es">` simple para zona place (placeholder).

2. **Update `proxy.ts`** — pattern oficial next-intl "Composing other middleware" (ver spec §"Estructura de routes" para racional):
   ```ts
   // zone marketing → intlMiddleware (sin cambios)
   if (target.zone === "marketing") return intlMiddleware(req);
   
   // zone inbox → intl primero, luego rewrite + propagar cookies/headers
   if (target.zone === "inbox") {
     const intlResponse = intlMiddleware(req);
     if (intlResponse.status >= 300 && intlResponse.status < 400) return intlResponse;
     const url = req.nextUrl.clone();
     const rest = url.pathname === "/" || url.pathname === "/inbox" ? "" : url.pathname;
     url.pathname = `/inbox${rest}`;
     const rewrite = NextResponse.rewrite(url);
     // CRÍTICO: propagar cookies (NEXT_LOCALE) y headers (x-next-intl-*) que intl seteó.
     intlResponse.cookies.getAll().forEach((c) => rewrite.cookies.set(c));
     intlResponse.headers.forEach((value, key) => {
       if (key.toLowerCase().startsWith("x-")) rewrite.headers.set(key, value);
     });
     return rewrite;
   }
   
   // zone place sigue igual
   ```

   **Verificar en mismo step:** la cookie `NEXT_LOCALE` debe tener `Domain=.place.community` para persistir entre apex y hub. Si la config actual de next-intl no la setea así (verificar `src/i18n/routing.ts`), agregar `cookies: { domain: ".place.community" }` en el config (o equivalente del API actual de next-intl).

   **Plan B documentado en spec** §"si la composición da fricción": fallback F1 (server-only `getRequestConfig` sin middleware) o F2 (ADR-0022 con evidencia).

3. **Implementar page principal** `src/app/(app)/inbox/[locale]/page.tsx`:
   - Auth guard: `const me = await sessionIdentity(); if (!me) redirect("https://place.community/" + locale + "/login");`
   - Carga i18n `getTranslations({ locale, namespace: "inbox" })` + `"navHub"`.
   - Render `<PlacesView labels={...} executor={...} />`.

4. **Redirect en `/login`** (`src/app/(marketing)/[locale]/login/page.tsx`):
   - Antes de render: `const me = await sessionIdentity(); if (me) redirect("https://app.place.community/" + locale + "/");`.

5. **Redirect en `/crear`** (`src/app/(marketing)/[locale]/crear/page.tsx`):
   - Antes de render: `const me = await sessionIdentity(); const fromHub = searchParams.from === "hub";`
   - `if (me && !fromHub) redirect("https://app.place.community/" + locale + "/");`
   - Si `me && fromHub` → renderea wizard authed directo.

6. **Simplificar `access-flow.tsx`** (G4):
   - Eliminar la fase "choice" entera.
   - Tras login/signup ok: `window.location.href = "https://app.place.community/" + locale + "/"`.
   - O mejor: Server Action retorna `{ status: "ok", redirectTo: "..." }` y el cliente navega. Si el Server Action puede hacer redirect cross-subdomain Next 16 (verificar), aún mejor.
   - Adaptar tests de `access-flow.test.tsx` para reflejar el nuevo behavior (los tests del wizard authed dentro del access flow desaparecen — ya no es path).

7. **Update `docs/multi-tenancy.md`** — agregar sección al final:
   ```markdown
   ## Hub `app.place.community/{locale}/` (ADR-0021, spec features/inbox/)
   
   La URL canónica del hub del usuario autenticado es `app.place.community/{locale}/`
   (locale prefix obligatorio). Path interno de Next: `/inbox/[locale]/...` —
   invisible al user, prefix por route-group conflict. Proxy pasa `intlMiddleware`
   también en zone inbox antes del rewrite. Sub-vistas futuras: `/{locale}/dms`,
   `/{locale}/actividad`.
   ```

8. **TDD: tests del page** `src/app/(app)/inbox/[locale]/__tests__/page.test.ts`:
   - Mock `sessionIdentity` → null → verifica `redirect` con URL del login.
   - Mock con user → no redirect; renderea.

9. **TDD: tests de redirects** en `crear/__tests__/page.test.ts` y `login/__tests__/page.test.ts`:
   - Mock `sessionIdentity` → user → `redirect` a hub URL.
   - Mock null → renderea normalmente.

10. **Green-close completo**: typecheck/lint/test/build verdes. LOC checks (cada archivo ≤300, cada slice ≤1500).

11. **Commit**: paths explícitos. Mensaje: `feat(hub): wiring completo — routes i18n + redirects + access-flow simplify (cierra spec V1)`.

12. **Manual smoke en producción** (NO en preview — cross-subdomain `*.vercel.app` falla):
    - Login en `place.community/es/login` con cuenta existente → debería terminar en `app.place.community/es/`.
    - Cuenta sin places → ve hub con estado vacío + 2 CTAs; sidebar visible.
    - Cuenta con 1 place owner → ve card con "Entrar" + "Configurar"; click "Entrar" abre nueva pestaña al subdomain.
    - Mobile (viewport <768px o phone real): sidebar oculto, hamburger visible, tap abre drawer.
    - Click avatar → menú; click "Cerrar sesión" → redirect a landing pública.
    - Visitar `app.place.community/es/` sin sesión → redirect a `/es/login` del apex.
    - Visitar `place.community/es/login` logueado → redirect al hub.
    - Visitar `place.community/es/crear` logueado (directo) → redirect al hub.
    - Visitar `place.community/es/crear?from=hub` logueado → renderea wizard authed.
    - Place no-ACTIVE: si tenés acceso a uno, verifica que badge muestra correcto.
    - i18n: cambiar locale en cookie next-intl → reload → labels traducidos (V1 sólo "es" poblado; otros caen a fallback default).

### Files

- **Crear**:
  - `src/app/(app)/inbox/[locale]/page.tsx` (movido del placeholder; refactor completo).
  - `src/app/(app)/inbox/[locale]/layout.tsx` (nuevo).
  - `src/app/(app)/inbox/[locale]/not-found.tsx` (nuevo).
  - `src/app/(app)/place/[placeSlug]/layout.tsx` (nuevo — multi-root).
  - `src/app/(app)/inbox/[locale]/__tests__/page.test.ts`.
  - `src/app/(marketing)/[locale]/crear/__tests__/page.test.ts`.
  - `src/app/(marketing)/[locale]/login/__tests__/page.test.ts`.
- **Modificar**:
  - `src/proxy.ts` (pasar intlMiddleware en zone inbox).
  - `src/app/(marketing)/[locale]/login/page.tsx` (redirect si sesión).
  - `src/app/(marketing)/[locale]/crear/page.tsx` (redirect si sesión y no `from=hub`).
  - `src/features/access/ui/access-flow.tsx` (eliminar fase "choice" + redirect post-login a hub).
  - `src/features/access/ui/__tests__/access-flow.test.tsx` (adaptar tests del flow simplificado).
  - `src/i18n/messages/es.json` (agregar bloques `inbox` y `navHub`).
  - `docs/multi-tenancy.md` (sección Hub).
- **Eliminar**:
  - `src/app/(app)/layout.tsx` (multi-root: cada sub-grupo lo provee).
  - `src/app/(app)/inbox/page.tsx` (movido).
  - `src/app/(app)/not-found.tsx` (movido al sub-layout).

### Riesgos / gotchas

- **Composición proxy + intlMiddleware**: el patrón de propagación de cookies/headers (ver paso 2) es la solución estándar de next-intl. Si en implementación surge alguna fricción (cookie no persiste, header missing en getTranslations), fallback al plan B documentado en el spec (§"Si la composición da fricción"). Posible ADR-0022 si se requiere decisión arquitectónica formal.
- **Cross-subdomain redirect en preview**: Vercel preview es `*.vercel.app`. El redirect `https://app.place.community/` SÓLO funciona en producción real. Documentar: smoke se hace en `place.community` real, no en preview.
- **Cookie clear en logout cross-subdomain**: Neon Auth `signOut()` debería respetar el `Domain=.place.community`. Verificar manual en producción tras login en subdomain y logout en apex.
- **`access-flow.tsx` Server Action redirect cross-subdomain**: Next 16 `redirect("https://...")` dentro de un Server Action: verificar si funciona o si requiere retorno + cliente navega. Si requiere cliente: usar `window.location.href` desde el client component tras recibir `{ status: "ok" }`.

---

## División en sesiones — justificación

- **5 sesiones, no 3 o 4**: cada una es ≤7 archivos significativos (regla CLAUDE.md "≤5" se respeta cuando hay tests + code mezclados; ≤7 archivos de código real). Sesión 3 (nav-hub) es la más grande (10 archivos) pero todo del mismo slice + tests; coherente.
- **Sesiones secuenciales**: 2 depende de RLS de 1 (los tests integration de la query fallan si no aplicó la migration). 3 y 4 son UI separable por dominio (nav vs places) — podrían paralelizarse en agentes distintos sin conflict (sin overlap de archivos). 5 depende de 3+4 (consume sus components).
- **Por qué NO meter sesión 1 dentro de 2**: cambio sensible de RLS merece su propio commit/revisión/green-close. Si 2 rompe algo, sabemos que no fue la RLS.
- **Por qué NO mezclar 3 y 4**: cada slice tiene su propia identidad arquitectónica. `nav-hub` es reusable más allá del inbox; `inbox` es la vista concreta. Separar = más fácil de revisar y de evolucionar.

## ADR vs spec

- **Spec** (`docs/features/inbox/`) describe el comportamiento del hub.
- **ADR-0021** (sesión 1) registra la decisión reusable "extender `_sel` para member-read" — aplica a cualquier feature futura.
- Spec puede evolucionar; ADR queda como histórico.

## Authority push

Tras el commit de cada sesión: green-close local OK. **Push sólo con autorización explícita del user en el turno** (memoria `feedback_no_push_until_authorized`). Vercel deploy es auto al push.
