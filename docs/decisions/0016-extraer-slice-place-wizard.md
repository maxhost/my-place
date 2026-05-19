# 0016 — Extraer la UI del wizard a un slice propio `place-wizard`

- **Fecha:** 2026-05-18
- **Estado:** Aceptada
- **Alcance:** arquitectura (estructura de vertical slices; sin cambio de comportamiento)
- **Cierra:** la deuda estructural abierta al cerrar S10b (slice `place-creation` = 1646 líneas no-test > 1500, límite duro `CLAUDE.md`). No supersede ninguna ADR; continúa el precedente de ADR-0014 (split `onboarding`) y ADR-0015 (extraer `style-assist`).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Al cerrar S10b (isla propose-only en el wizard, `docs/features/onboarding/plan-sesiones.md`) se midió el slice y se diagnosticó (disciplina `CLAUDE.md`, evidencia reproducible, no hipótesis):

- `src/features/place-creation/` = **1646 líneas no-test > 1500** (límite duro `CLAUDE.md` § Límites / `architecture.md` §37). "Superar un límite = dividir antes de continuar."
- La UI del wizard es un **concern cohesivo y separable**: ~1177 líneas de las 1646 viven en `ui/` (shell + máquina de estado + pasos + isla + labels + preview + success + palettes + slugify). El core no-UI (dominio Zod + saga + Server Actions + ports + public) es ~469.
- Además dos archivos quedaron clavados en el techo de 300 (`wizard-steps.tsx`, `use-place-wizard.ts`): la UI no tiene margen para crecer dentro de `place-creation`.
- Igual situación exacta que S9 → S9.5 y S10a → S10a.5: el trabajo funcional de S10b se cerró verde (188/188, typecheck/lint/build) y se commiteó como rollback (`4b61c76`); la decisión se elevó al owner, que confirmó **extraer la UI del wizard a un slice propio**, ejecutado como sesión propia ADR-backed (S10b.5).

**Grafo de dependencias (diagnóstico, no asumido).** El wizard es UI pura inyectada por seam-split: nunca importa el Server Action de creación (`createPlaceAction` llega por la prop `onSubmit`) ni el de asistencia (`suggestStyleAction` por `onSuggest`). Lo único que consume de `place-creation` son **tipos** (`CreatePlaceInput`, `CreatePlaceResult`, `PlaceFirstCredentials`) y el **primitivo de dominio `slugSchema`** (clasificación de slug client-side en `use-place-wizard`). Para que las aristas sean **acíclicas** (`architecture.md` §25), `place-creation` NO puede importar `place-wizard`; las rutas componen ambos slices. `slugSchema` se expone por `place-creation/public.ts`: es un primitivo propio de `place-creation` consumido por su interfaz pública (patrón ADR-0014, no un ciclo) — no se duplica ni se mueve a `shared/` porque no hay ciclo que resolver.

## Decisión

1. **Slice nuevo `src/features/place-wizard/`** con su `public.ts` (interfaz pública: `PlaceWizard`, `WizardLabels`, `WizardSubmit`, `WizardSuggest`, `PlaceFirstCredentials`, `PALETTE_PRESET_IDS`). Contiene la UI completa del wizard movida con `git mv` (preserva historial, precedente S7/S9.5/S10a.5): `place-wizard.tsx`, `use-place-wizard.ts`, `wizard-steps.tsx`, `style-assist-island.tsx`, `wizard-labels.ts`, `place-preview.tsx`, `wizard-success.tsx`, `palettes.ts`, `slugify.ts` y sus tests.
2. **`place-creation` conserva** dominio/saga/actions/ports y su `public.ts` (~469 no-test). Su `public.ts` deja de exportar la UI del wizard y pasa a exponer lo que el wizard consume: los tipos (`CreatePlaceInput`, `CreatePlaceResult`, `PlaceFirstCredentials`) y `slugSchema`. Sigue exportando `createPlaceAction` (lo cablean las rutas, no el wizard).
3. **Aristas resultantes** (unidireccionales, vía `public.ts`, acíclicas): `place-wizard → place-creation` (tipos + `slugSchema`); `place-wizard → style-assist` (tipo `StyleSuggestion`, arista de ADR-0015, intacta); `access → place-wizard` (renderiza `PlaceWizard` en modo authed) y `access → place-creation` (`createPlaceAction`). Las rutas `crear` y `login` componen los slices e inyectan los Server Actions vivos. `place-creation` no importa ninguna feature. Tercer ejemplo canónico del patrón de ADR-0014.
4. **Refactor puro, sin cambio de comportamiento.** La suite de 188 tests es la red de regresión: debe seguir 188/188 sin cambiar una aserción. `place-creation` vuelve a ~469 no-test; `place-wizard` ~1177 — ambos con margen sano bajo 1500.

## Alternativas rechazadas

- **Recortar/inline para entrar en 1500.** Dañaría la claridad por ~150 líneas y reventaría el límite la sesión siguiente. No resuelve la causa (la UI del wizard es grande y cohesiva).
- **Mover sólo la isla a `style-assist` (la otra opción evaluada con el owner).** Más cohesivo para la isla, pero ~111 líneas solas no bajan de 1500: arrastraría además labels/preview y dejaría `place-creation` aún UI-pesado, con menos margen. La extracción del wizard completo es la jugada estructural decisiva con margen duradero.
- **`place-creation` importa `place-wizard` (arista inversa).** Formaría un ciclo `place-creation ↔ place-wizard` (prohibido, `architecture.md` §25).
- **Subir el límite duro.** Prohibido por `CLAUDE.md` § Límites.

## Consecuencias

- **+** Frontera de slice restaurada con margen amplio; el wizard pasa a ser un slice autónomo (UI/estado/tests propios) compuesto por las rutas y reusado en modo authed por `access`.
- **+** Aristas acíclicas y sólo vía `public.ts`; el seam-split (Server Actions inyectados) se mantiene intacto — el wizard sigue testeándose con fakes.
- **−** Una arista feature→feature más (la tercera): aceptable y consistente con el precedente ADR-0014/0015. El primitivo `slugSchema` cruza vía `place-creation/public.ts` (consciente: es primitivo propio de `place-creation` expuesto por su interfaz, no duplicado, no en `shared/` porque no hay ciclo).
- **Watch (fuera del alcance de esta ADR):** `use-place-wizard.ts` y `wizard-steps.tsx` quedan en el techo de 300 líneas/archivo. Es una preocupación **por-archivo**, distinta del límite de slice que esta ADR cierra; si cualquiera de los dos crece, se divide el archivo en su propia sesión.

## Detalle operativo canónico

- Procedimiento y cierre verde: `docs/features/onboarding/plan-sesiones.md` §S10b.5.
- Paradigma y límites: `architecture.md` §11 (vertical slices), §21 (seam-split), §25 (aristas acíclicas / extraer lo común), §37 (límites de tamaño).
- Precedente: ADR-0014 (`access → place-creation`), ADR-0015 (`style-assist`). Commit verde de S10b `4b61c76` = punto de rollback.
