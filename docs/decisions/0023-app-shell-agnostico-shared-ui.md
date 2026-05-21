# 0023 — App Shell agnóstico extraído a `shared/ui/app-shell` (consumido por `nav-hub` y `nav-place`)

- **Fecha:** 2026-05-20
- **Estado:** Aceptada
- **Alcance:** arquitectura (regla de aislamiento `shared/` ↔ `features/`, división de responsabilidades shell vs feature), UI (mobile-first shell reusable: topbar + sidebar + drawer), refactor de `nav-hub` (deja de ser dueño del shell)
- **Habilita:** la sesión S4 del feature settings (`docs/features/settings/plan-sesiones.md`) — refactor del shell + nav-hub consumer, sin romper el Hub V1 en producción
- **Refina:** ADR-0014 / ADR-0015 / ADR-0016 (split de slices acíclicos) extendiendo el mismo principio a un primitivo UI compartido entre dos slices peer
- **No supersede:** ADR-0010 ni el modelo de RLS (esta decisión es puramente de organización de UI, sin tocar acceso a datos)

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El Hub V1 (S5a–S5c, 2026-05-20) construyó un shell mobile-first dentro del slice `nav-hub`: `<NavHubLayout>` compone topbar (con menú de cuenta + logout) + sidebar (con items navegables) + drawer (que abre la sidebar en mobile). La lógica del drawer (estado abierto/cerrado, focus-trap, swipe gestures, cierre por backdrop/Escape) es no trivial y vive embebida en el slice.

El feature settings (`docs/features/settings/`, V1 post-ADR-0022) necesita un shell análogo para la zona place — mobile-first idéntico — pero con:

- Otros `sidebarItems` (las 6 secciones del settings: Idioma, Identidad, Apariencia, Membresía, Acceso, Avanzado — solo "Idioma" funcional en V1).
- Otro `activeKey` (cuál ítem está activo).
- Otro `title` (nombre del place vs "Hub").
- La misma topbar con menú de cuenta + logout, alimentada por la misma cookie cross-subdomain (`Domain=.place.community`).

Tres caminos posibles sin esta ADR:

1. **Duplicar el componente** en `nav-place`. Divergiría el comportamiento mobile en cuestión de semanas (un bug fix del drawer en uno no se replica al otro; un swipe gesture mejorado solo aparece en uno). Production-grade lo descarta de entrada.
2. **`nav-place` importa de `nav-hub`** (vía su `public.ts`). Viola el espíritu de las reglas de aislamiento entre features (ADR-0014/0015/0016): el shell no es producto del Hub, es un primitivo UI compartido. Si `nav-hub` un día cambia su `public.ts` por necesidades del Hub, rompe `nav-place` sin razón semántica. Acíclico hoy, frágil mañana.
3. **Extraer el shell a `shared/ui/`** como primitivo agnóstico al dominio, con `nav-hub` y `nav-place` como consumers thin-wrapper. Es el patrón canónico del repo (`shared/` agrupa primitivos sin dominio; ADR-0014/0015/0016 ya aplicaron este principio al extraer `palette-schema` a `shared/lib/`).

Esta ADR fija el camino 3 antes de implementar la S4 del feature settings, para que el refactor del Hub V1 quede registrado como decisión arquitectónica y no como cambio oportunista de una sesión.

## Decisión

1. **Crear `src/shared/ui/app-shell/`** con la siguiente forma:

   ```
   src/shared/ui/app-shell/
   ├── app-shell.tsx          # componente React (Server o Client según drawer state)
   ├── app-shell-labels.ts    # interfaz TypeScript con los strings i18n del shell
   ├── public.ts              # exports: AppShell, AppShellLabels, SidebarItem, etc.
   └── __tests__/
       └── app-shell.test.tsx # tests del shell agnóstico (mobile drawer, focus-trap, items disabled)
   ```

2. **El componente recibe props agnósticas al dominio**:

   ```ts
   type SidebarItem = {
     key: string;
     label: string;
     href?: string;       // si está activo / disabled, sin href
     icon?: ReactNode;
     disabled?: boolean;  // tooltip "Próximamente" + aria-disabled
   };

   type AppShellProps = {
     title: string;                    // "Hub" o nombre del place
     sidebarItems: SidebarItem[];
     activeKey: string;                // el key del SidebarItem activo
     displayName?: string;             // del user logueado (para topbar)
     onLogout: () => Promise<{ redirectTo: string }>;  // Server Action bound por el consumer
     labels: AppShellLabels;           // i18n del shell ("Cerrar sesión", "Próximamente", etc.)
     children: ReactNode;              // el contenido de la zone (Hub V1 o settings page)
   };
   ```

3. **`shared/ui/app-shell` NO importa de `src/features/`** (regla canónica de `docs/architecture.md` § "Reglas de aislamiento entre módulos"). Verificable: `grep -rn 'from "@/features/' src/shared/` retorna vacío. Si en el futuro algún consumer necesita un primitivo más rico (e.g. quick-search en topbar), se evalúa: (a) hacerlo más agnóstico y subirlo al shell, o (b) renderlo como `children` en el slot que ya existe; pero **nunca** acoplar el shell a una feature.

4. **`nav-hub/ui/nav-hub-layout.tsx` se vuelve un thin wrapper** que llama `<AppShell sidebarItems={hubSidebarItems(labels)} activeKey={activeSection} title="Hub" ... />`. La función `hubSidebarItems(labels)` traduce el contrato del `nav-hub` (sección activa = `"places" | "dms" | "actividad"`) al shape genérico del shell. Esa función vive en `nav-hub/ui/` (es lógica del Hub, no del shell).

5. **`nav-place/ui/nav-place-layout.tsx` se construye desde día uno como consumer** del shell. Su `placeSidebarItems(labels)` lista las 6 secciones del settings con sus respectivos `disabled: true` excepto "language" (V1).

6. **Los labels del shell viven en `AppShellLabels`** — `nav-hub` y `nav-place` cada uno arma su `AppShellLabels` desde su namespace i18n (`navHub`, `navPlace`) y lo pasa como prop. El shell no conoce namespaces ni `next-intl`. Inversión de dependencia clásica.

7. **Tests del shell viven con el shell** (`shared/ui/app-shell/__tests__/`). Cubren: render con N items, marcado `aria-current="page"` del activo, `aria-disabled="true"` + tooltip "Próximamente" de los disabled, abrir/cerrar drawer en mobile, focus-trap dentro del drawer abierto, cierre con `Escape` y backdrop click. Los tests del Hub V1 (`nav-hub/__tests__/nav-hub-layout.test.tsx`) siguen verdes verificando la integración (que los items correctos se pasan al shell).

## Alternativas rechazadas

- **Duplicar el componente en `nav-place`.** Divergencia garantizada en mantenimiento. Cualquier fix del drawer en uno no se replica al otro. La duplicación viola "lo que cambia junto, vive junto" (architecture.md § "Principios de organización"). Rechazada por razones de calidad a 6 meses.

- **`nav-place` importa de `nav-hub` (vía `public.ts`).** El shell no es producto semántico del Hub — es UI primitiva que ambos slices necesitan. Si `nav-hub` un día actualiza su `public.ts` (e.g. exporta otro componente, cambia firma de `NavHubLayout`), `nav-place` se rompe sin que el cambio tenga ninguna relación con el settings. Acoplamiento espurio. Rechazada por viabilidad arquitectónica a largo plazo.

- **Mover el shell a `shared/ui/` pero solo el presentacional (markup + tailwind), dejando la lógica del drawer en cada feature.** El drawer (estado, focus-trap, swipe, backdrop, body-scroll-lock) **es el shell** — es lo que distingue un shell mobile-first de un layout estático. Separar UI de lógica acá deja la parte difícil duplicada. Rechazada por no resolver el problema.

- **Crear un slice nuevo `shell` en `src/features/`.** Los slices son features (con dominio, queries, actions). Un shell agnóstico no tiene dominio — es UI primitiva. Meterlo en `features/` sería romper la ontología de los slices del repo. Rechazada por inconsistencia con el paradigma.

- **Hacer el shell un Client Component completo y delegar todo al cliente.** Pierde server-rendering del shell (topbar/sidebar son markup estable, ideales para SSR/SSG). El drawer state es Client (correcto), pero el shell entero no — sería regresión performance. La decisión: shell es Server Component compose-de-todo, con un sub-componente Client para el drawer (`<DrawerToggle>` o equivalente).

- **No extraer ahora; duplicar para el settings y refactor después si la duda persiste.** Rechazada por la regla "diagnosticar antes de implementar" + production-grade. El shell duplicado a hoy es código zombi inminente; extraer es bajo costo (1 sesión, S4) y cero regresión si los tests del Hub V1 siguen verdes.

## Consecuencias

- **Refactor del Hub V1 sin downtime.** S4 del plan de settings (`docs/features/settings/plan-sesiones.md`) extrae el shell + actualiza `nav-hub` como consumer. Los tests del Hub (`nav-hub/__tests__/nav-hub-layout.test.tsx`) cubren la regresión: el comportamiento observable del Hub V1 no cambia.

- **Habilita el slice `nav-place`** (S5 del settings) como thin wrapper consumer — sin duplicar nada.

- **LOC del Hub disminuye, no aumenta.** `nav-hub/ui/nav-hub-layout.tsx` pasa de ~150 LOC a ~50 LOC (sólo el cableado de items + bind del Server Action). El delta va a `shared/ui/app-shell/` donde es reusable.

- **`shared/ui/` se vuelve directorio activo del repo** (hoy sólo existe `shared/lib/` y `shared/config/`). El patrón se extiende: futuros primitivos UI agnósticos (e.g. un `<Modal>` ad-hoc) viven acá si los necesita más de un slice.

- **Tests nuevos: +N tests del AppShell** (estimación ~5: render basic, items disabled, abrir/cerrar drawer, focus-trap, aria-current). Los tests del Hub V1 reducen levemente (los del comportamiento del drawer se mueven al shell), pero ganan tests de integración (verificar que `nav-hub` pasa los items correctos).

- **Acíclico verificable**: el green-close de S4 incluye `grep -rn 'from "@/features/' src/shared/` → vacío. Si esa búsqueda devuelve algo, el refactor está mal hecho y se revierte.

- **Pattern reusable**: cualquier futuro slice de navegación (e.g. `nav-admin` si entra una zona admin) consume `AppShell` con sus items. No se repite el código del drawer ni una sola vez.

- **El `onLogout` Server Action es bound por cada consumer**. `nav-hub` hace `logoutAction.bind(null, locale)` y lo pasa al shell; `nav-place` haría `logoutAction.bind(null, place.defaultLocale)` (o el redirectTo equivalente al apex). El shell sólo invoca `onLogout()` y respeta el `redirectTo` del resultado.

- **Sin cambios en RLS, auth, o pipeline de migraciones.** Esta ADR es 100% de organización UI.

## Detalle operativo canónico

- Estructura del directorio: ver § Decisión punto 1.
- Sesión que implementa el refactor: S4 (`docs/features/settings/plan-sesiones.md` § "S4 — Refactor `<AppShell>` agnóstico + nav-hub consumer").
- Tests del shell: `src/shared/ui/app-shell/__tests__/app-shell.test.tsx` (nuevo).
- Tests del consumer nav-hub: `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx` (existente — se ajusta para verificar la integración con AppShell sin re-testear el drawer).
- Tests del consumer nav-place: `src/features/nav-place/__tests__/nav-place-layout.test.tsx` (S5).
- Verificación acíclico: `grep -rn 'from "@/features/' src/shared/` debe retornar vacío post-S4.

## Notas

- Si en el futuro la topbar o la sidebar necesitan un slot distinto entre Hub y settings (e.g. el settings quiere un "Volver al place" prominente en mobile que el Hub no tiene), se resuelve via `children` adicional en props del shell (e.g. `topbarLeftSlot?: ReactNode`). El shell se mantiene agnóstico; cada consumer decide qué meter en sus slots. Si emerge la necesidad antes de S4, se ajusta el contrato en ese commit; si emerge después, se hace en ADR refinante.
- Esta ADR no rompe nada en producción al merge — solo planea el refactor de S4. La implementación es atómica y testeada antes de cualquier deploy.
