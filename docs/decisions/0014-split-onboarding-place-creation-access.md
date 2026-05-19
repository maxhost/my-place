# 0014 — Split del slice `onboarding` en `place-creation` + `access`

- **Fecha:** 2026-05-18
- **Estado:** Aceptada
- **Alcance:** arquitectura (estructura de vertical slices; sin cambio de comportamiento)
- **Cierra:** la deuda estructural abierta al cerrar S9 (slice `onboarding` = 1885 líneas no-test > 1500, límite duro `CLAUDE.md`). No supersede ninguna ADR; refina la materialización física de ADR-0005/0008/0009 en dos slices.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Al cerrar S9 (vía "Acceso", `docs/features/onboarding/plan-sesiones.md`) se midió el slice y se diagnosticó (disciplina `CLAUDE.md`, evidencia reproducible, no hipótesis):

- `src/features/onboarding/` = **1885 líneas no-test** > **1500** (límite duro de feature, `CLAUDE.md` › Límites de tamaño: "Superar un límite = dividir antes de continuar").
- La regla manda **dividir, no improvisar**, y un cambio estructural es **decisión arquitectónica → ADR antes de implementar** (`CLAUDE.md` › Ante una desviación). Por eso S9 se cerró en verde (`a073c09`, rollback point), se anotó la deuda en `plan-sesiones.md`/`tests.md`, y se elevó la decisión al owner en vez de partir el slice de motu propio.
- El owner eligió **partir en dos slices** (opción A) como **sesión propia con ADR**, antes de S10.

El slice mezcla **dos responsabilidades de dominio distintas** que ya estaban acopladas solo por co-ubicación, no por necesidad:

1. **Crear un place** (wizard place-first, saga `createPlace`, schema/build-place/defaults, ports, `createPlaceAction`). Es el núcleo de ADR-0005.
2. **Acceso de cuenta** (login/signup account-first, `loginAction`/`signUpAccountAction`, `AccessFlow`/`useAccessForm`/`AccessLabels`). Es la vía "Acceso" de ADR-0008/0009.

El grafo de dependencias real (verificado por `grep`, no asumido) ya es **unidireccional y acíclico**:

- `access` consume del wizard solo cuatro símbolos ya públicos: `PlaceWizard`, `WizardLabels`, `WizardSubmit`, `PlaceFirstCredentials`, más `createPlaceAction`/`PALETTE_PRESET_IDS` desde la ruta. Todos ya exportados por `public.ts`.
- Ningún archivo de creación de place importa nada de `access`. No hay ciclo.

Tamaños tras el corte (medidos): `place-creation` = **1370** no-test, `access` = **517** no-test. Ambos < 1500, con margen.

## Decisión

**Partir `src/features/onboarding/` en dos vertical slices**, como reestructura pura (sin cambio de comportamiento; la suite de 162 tests es la red de regresión del refactor):

1. **`src/features/place-creation/`** — dominio + saga + wizard:
   `actions.ts`, `create-place.ts`, `ports.ts`, `domain/{schema,build-place,defaults}.ts`, `ui/{place-wizard,use-place-wizard,wizard-labels,wizard-steps,wizard-success,place-preview,slugify,palettes}` + sus `__tests__`.
   `public.ts` exporta: `createPlaceAction`, `PlaceFirstCredentials`, `CreatePlaceResult`, `CreatePlaceInput`, `PlaceWizard`, `WizardLabels`, `WizardSubmit`, `PALETTE_PRESET_IDS`.
2. **`src/features/access/`** — vía "Acceso":
   `auth-actions.ts`, `ui/{access-flow,use-access-form,access-labels}` + `ui/__tests__/access-flow.test.tsx`.
   `public.ts` exporta: `AccessFlow`, `AccessLabels`, `AccessSubmit`, `loginAction`, `signUpAccountAction`.
3. **`access` depende de `place-creation` solo vía su `public.ts`** (feature→feature unidireccional permitido, `architecture.md` §21/§25). `place-creation` no conoce a `access`. Sin ciclo.
4. Mover con `git mv` (preserva historial; precedente: S7 movió la landing a `(marketing)`). Las rutas `(marketing)/[locale]/crear` y `(marketing)/[locale]/login` se re-apuntan a los nuevos `public.ts` (login importa de **ambos**).
5. **Cierre verde obligatorio:** `pnpm test` (162/162, sin cambio de comportamiento), `pnpm typecheck`, `pnpm lint`, `pnpm build` en verde antes de commitear. Reestructura controlada y reviewable, no rewrite.

## Alternativas rechazadas

- **Dejar el slice en 1885 y seguir con S10.** Viola el límite duro y la regla "dividir antes de continuar". La deuda crecería con S10 (capa LLM). Rechazada.
- **Extraer a `shared/` la parte común.** No hay parte común agnóstica al dominio: el wizard y el form de acceso son dominio puro. `shared/` nunca importa features y no es un cajón de UI de dominio (`architecture.md` §17). Rechazada.
- **Partir solo la UI (un slice de dominio + un slice de UI).** Rompe el paradigma: cada slice es vertical (UI + lógica + datos + tests), no capas horizontales (`architecture.md` §11). Rechazada.
- **Reducir líneas micro-optimizando archivos.** No ataca la causa (dos responsabilidades en un slice); sería un parche que vuelve a romper el límite. Rechazada.

## Consecuencias

- Desaparece `src/features/onboarding/`. Dos slices nuevos, cada uno < 1500 con margen, con su `public.ts` y sus tests.
- Imports externos: `@/features/onboarding/public` → `@/features/place-creation/public` y/o `@/features/access/public` según el símbolo. Hoy solo dos consumidores (`crear/page.tsx`, `login/page.tsx`).
- `access` → `place-creation` queda como **arista feature→feature** documentada (vía `public.ts`, unidireccional, sin ciclo). Es el primer feature→feature del repo; valida el paradigma.
- Cierra la deuda ⚠️ anotada en `plan-sesiones.md`/`tests.md` (S9). El plan pasa a referir dos slices; S0–S9 siguen siendo la misma historia, solo re-ubicada.
- Historial Git preservado por `git mv` (blame/log siguen el archivo).
- Sin cambio de comportamiento ni de tests: la verificación en vivo diferida (Vercel preview) de S4b/S5b/S8b/S9 no se altera.

## Detalle operativo canónico

- Paradigma de slices y dependencias unidireccionales: `architecture.md` §11/§21/§25.
- Límites de tamaño: `CLAUDE.md` › Límites de tamaño.
- Plan de sesiones y estado: `docs/features/onboarding/plan-sesiones.md` (la carpeta de specs conserva el nombre `onboarding` como dominio-paraguas; los slices físicos son `place-creation` y `access`).
- Vías de entrada y modo authed: ADR-0005, ADR-0008, ADR-0009.
