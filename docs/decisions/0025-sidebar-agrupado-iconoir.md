# 0025 — Sidebar agrupado en zonas conceptuales (`shared/ui/app-shell` acepta grupos) + `iconoir-react` como librería canónica de iconos

- **Fecha:** 2026-05-21
- **Estado:** Aceptada
- **Alcance:** arquitectura (extensión del primitivo `shared/ui/app-shell` para soportar grupos de items), UI (refactor de IA del sidebar del settings + sustitución de emojis por iconos line-based consistentes), librería externa (adopción de `iconoir-react` como SoT de iconografía del producto)
- **Habilita:** las sesiones S1a/S1b/S2/S3 del plan de sidebar V1.1 (`docs/features/settings/spec.md`) — refactor de `<AppShell>` para grupos + iconos · `<NavPlaceLayout>` consume 4 grupos · cableado i18n + page del settings con 9 items en lugar de 6
- **Refina:** ADR-0023 (App Shell agnóstico) — el shell pasa de aceptar `sidebarItems: SidebarItem[]` plano a `sidebarGroups: SidebarGroup[]`; la prop `icon` del item se libera de `string` (emoji) a `ReactNode` (componente Iconoir o cualquier React node). Backward-compat: el Hub V1 pasa un grupo con `label: null` que renderea sin header, comportamiento visualmente idéntico al sidebar plano anterior.
- **No supersede:** ADR-0010 (RLS), ADR-0022 (locale del place), ADR-0024 (i18n fallback) — esta decisión es 100% de organización UI + dependencia externa, no toca acceso a datos, seguridad ni i18n core.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

V1 del settings (`docs/features/settings/`, S0a–S7, deployed `c20e842`) entregó un sidebar plano de 6 items: 1 activo (Idioma) + 5 disabled (Apariencia, Miembros, Horario, Billing, Dominio custom). Cada item llevaba un emoji como icono inline (`🌐 👥 🎨 ⏰ 💳 🌍`).

Tres limitaciones aparecieron al ejercer el sidebar contra el roadmap real:

1. **El roadmap del owner es más rico que 6 items planos.** Las features inminentes incluyen "Zonas" (activar Eventos + Biblioteca, `ontologia/`), "Grupos" (permisos granulares, ADR-0002), "Tiers" (monetización de miembros, ADR-0003). Sumarlas al sidebar lo lleva a 9 items, y la lista plana pierde estructura mental: un `<ul>` de 9 cosas sin agrupación no comunica que "Apariencia y Dominio son cosas de identidad" vs "Zonas y Horario son cosas de comportamiento".

2. **Emojis como iconos son inconsistentes y dependientes del SO.** El emoji `🌐` se renderea diferente en macOS / Windows / Linux / Android / iOS; el peso visual varía; el line-width es desigual; algunos emojis (`🎨`) son bitmap-coloridos y rompen el ethos calmo de `producto.md`. Para un producto que valora "cozytech, nada grita" (`producto.md`), un set de iconos line-based consistente es la elección coherente. Decisión consultada el 2026-05-21: instalar una librería de iconos profesional.

3. **El primitivo `<AppShell>` (`shared/ui/app-shell`, ADR-0023) no soporta agrupación.** Su contrato actual es `sidebarItems: SidebarItem[]` — lista plana. Para implementar el sidebar agrupado del settings sin duplicar lógica de drawer/focus-trap/active-state hay que extender el contrato del shell, no del slice consumer. Eso es **refinamiento de ADR-0023**, no negación.

Esta ADR fija las tres decisiones (estructura del sidebar agrupado · adopción de `iconoir-react` · extensión del contrato del `<AppShell>`) antes de implementar las 4 sesiones de código (S1a/S1b/S2/S3 del sidebar V1.1), para que la decisión arquitectónica preceda al refactor.

## Decisión

### 1. El sidebar del settings se reorganiza en **4 grupos conceptuales** con **9 items**

```
Identidad     → Apariencia · Idioma (V1 activa) · Dominio        (cómo el place se ve y se nombra)
Estructura    → Zonas · Horario                                  (cómo el place se comporta)
Suscripción   → Billing                                          (relación owner ↔ producto Place)
Gestión       → Miembros · Grupos · Tiers                        (administración interna del place)
```

**Headers de grupo fijos no-colapsables** en V1.1 — divisores con label en estilo `text-xs uppercase tracking-wider text-muted`, no tap-targets. Si en futuro el sidebar supera 12 items se evalúa colapsables (decisión diferida — no se introduce estado de colapso por adelantado, principio YAGNI).

**Items disabled no clicables** — no tap-target, no link. El badge "Próximamente" es la única afordancia visual; se descartó la idea de un mini-modal "Próximamente, [breve descripción]" por considerarse ruido sin valor agregado.

### 2. **`iconoir-react`** se adopta como librería canónica de iconos del producto

Instalación: `pnpm add iconoir-react`. Import per-icon (tree-shake automático):

```ts
import { Language, Group, ColorPicker, Clock, CreditCard, Internet, ViewGrid, MultiplePages, Layers } from "iconoir-react";
```

Características que justifican la elección:
- **~1500 iconos line-based MIT** — un solo weight, coherencia visual con el ethos "calmo" (`producto.md`).
- **Tree-shakeable** — el bundle del cliente solo incluye los iconos efectivamente importados.
- **TypeScript first** — tipos exportados, autocompletion sólida.
- **Activo y mantenido** — releases regulares, comunidad estable.

Esto es **decisión transversal del producto, no del settings**. Cualquier slice que necesite iconos a partir de aquí los importa de `iconoir-react` sin discutirlo por sesión. Si en algún momento un slice necesita un icono inexistente en Iconoir, se evalúa: (a) usar un fallback de Iconoir; (b) crear un SVG inline custom dentro del slice (sin extender librería); (c) si el caso se repite, una sesión aparte evalúa traer un icono pack complementario. No reemplazar Iconoir a menos que aparezca una limitación estructural.

### 3. El primitivo **`<AppShell>` se extiende para aceptar grupos**

Cambio de contrato:

```ts
// ANTES (ADR-0023):
type AppShellProps = {
  ...
  sidebarItems: SidebarItem[];
  activeKey: string;
  ...
};

// DESPUÉS (ADR-0025):
type SidebarGroup = {
  label: string | null;     // null = no renderea header (compat con sidebar plano)
  items: SidebarItem[];
};

type AppShellProps = {
  ...
  sidebarGroups: SidebarGroup[];
  activeKey: string;
  ...
};
```

**Y la prop `icon` del `SidebarItem` se libera de `string` a `ReactNode`**:

```ts
// ANTES:
type SidebarItem = { ...; icon?: string; ... };  // emoji string

// DESPUÉS:
type SidebarItem = { ...; icon?: ReactNode; ... };  // Iconoir component, SVG, o cualquier ReactNode
```

Backward-compat: `string` ⊂ `ReactNode`, así que `nav-hub` con sus emojis sigue funcionando sin cambios runtime. La adopción de Iconoir en `nav-hub` se difiere (sesión aparte cuando el Hub V2 requiera retoque). `nav-place` usa Iconoir desde día uno.

### 4. **`nav-hub` se adapta para el cambio de contrato del shell sin cambio de comportamiento**

`nav-hub-layout.tsx` envuelve su array existente en un solo grupo sin label:

```ts
<AppShell
  sidebarGroups={[{ label: null, items: hubSidebarItems(labels) }]}
  activeKey={activeSection}
  ...
/>
```

Cuando `label === null`, el shell no renderea el header — el resultado visual es idéntico al sidebar plano anterior. Test de regresión del Hub (`nav-hub-layout.test.tsx`) verifica que el comportamiento observable no cambia post-refactor.

### 5. **`nav-place` consume el contrato nuevo desde día uno**

`nav-place-layout.tsx` arma su `sidebarGroups: SidebarGroup[]` con los 4 grupos del settings V1.1, cada item con su Iconoir component como `icon`. Si los imports de Iconoir crecen mucho en `nav-place-layout.tsx` (≥10 imports), se extrae a `nav-place-icons.ts` para mantener el componente ≤300 LOC (decisión empírica en S2).

### 6. **Las labels de los 4 grupos viven en `placeSettings.sidebar.group*` (i18n)**

```json
"placeSettings": {
  "sidebar": {
    "groupIdentity": "Identidad",
    "groupStructure": "Estructura",
    "groupSubscription": "Suscripción",
    "groupManagement": "Gestión",
    ...
  }
}
```

`navPlaceLabels` consume las 4 keys y las pasa al shell vía cada `SidebarGroup.label`. Mismo patrón i18n→labels→props que el resto de la zona-place (ADR-0023 §6).

### 7. **`NavPlaceActiveSection` se mantiene en `"language"` por ahora**

Sólo "Idioma" es navegable V1; los 8 disabled no necesitan entries en el union type del `activeKey`. Cuando un item disabled se active (S4+ posteriores), se agrega su key al union.

## Alternativas rechazadas

- **Mantener el sidebar plano con 9 items.** Pierde la estructura mental que el roadmap real exige; el owner tiene que parsear 9 items sin pistas de qué van juntos. Rechazada por degradación UX visible a partir de >6 items planos.

- **Hacer los grupos colapsables desde V1.1.** Agrega estado (¿per-render? ¿per-user via localStorage? ¿per-tab?) sin necesidad — con 9 items todos caben expandidos sin scroll. Patrón establecido en SaaS settings (Stripe, Linear, Notion) con N items moderado: grupos visibles fijos. Si crece >12, se reevalúa. Rechazada por YAGNI.

- **Lucide en lugar de Iconoir.** Ambas son válidas (~1500 iconos line-based MIT). Iconoir se eligió por (a) preferencia explícita del owner del producto (señal de aesthetic-fit con el ethos calmo); (b) un solo weight vs Lucide (también un solo weight pero estilo más "geométrico" — Iconoir es más "amistoso"). Rechazada por preferencia subjetiva del producto, no por inferioridad técnica.

- **Heroicons en lugar de Iconoir.** Sólo ~300 iconos — corto plazo se queda chico. El producto va a necesitar muchos iconos a futuro (events / library / messaging / billing). Rechazada por restricción de cobertura.

- **Phosphor Icons en lugar de Iconoir.** ~1300 iconos con 6 weights. El multi-weight tienta a inconsistencia visual (un slice usa "regular", otro usa "bold", el ojo nota). Rechazada por riesgo de drift visual.

- **Mantener emojis sin librería.** Inconsistencia cross-OS, no escala visualmente, rompe ethos calmo. Rechazada — la limitación es estructural.

- **`<AppShell>` con dos props alternativas (`sidebarItems` y `sidebarGroups`) por backward-compat.** Genera un contrato de prop dual confuso (¿cuál tiene precedencia?). Cambio único de contrato + adapter en `nav-hub` (3-4 líneas) es más limpio. Rechazada por evitar acoplamientos espurios en la API del shell.

- **Mover Billing fuera del sidebar al account menu del topbar.** Propuesta del análisis técnico — Billing es del owner-usuario, no del place. Owner del producto decidió mantener Billing en el sidebar bajo el grupo "Suscripción" por discoverability (consulta del 2026-05-21). Rechazada por preferencia del producto, registrada como decisión consciente.

- **Naming del grupo de Billing como "Sistema".** Propuesta del owner, descartada por análisis: "Sistema" en contexto SaaS sugiere logs/seguridad/infra, no facturación. Se acordó "Suscripción" como label canónico — alineado con ADR-0003 que ya usa el término "suscripción del owner". Decisión consultada el 2026-05-21.

- **Renderizar items disabled como tap-targets con modal "Próximamente".** Agrega ruido sin valor (el badge ya es suficiente afordancia). Rechazada por consulta del 2026-05-21. Si en futuro emerge la necesidad de telemetría de demanda ("¿cuántos owners hacen click en Tiers disabled?"), se evalúa como feature separado.

## Consecuencias

- **`<AppShell>` extiende su contrato** sin romper el Hub. El test del Hub (`nav-hub-layout.test.tsx`) sigue verde post-refactor — verificación de regresión. Si rompe, S1b se revierte.

- **`nav-place` se reescribe internamente** para consumer el nuevo shape — el cambio es estructural (helper interno devuelve grupos en lugar de items planos) pero las tests del slice se reformulan TDD (verifican grupos, items por grupo, sólo Idioma activa).

- **Bundle del cliente crece por los iconos de Iconoir importados.** Estimación: ~9 iconos × ~0.8 KB/icon (tree-shaken) ≈ 7 KB adicionales en el bundle del settings page. Negligible comparado con el page de marketing (≥ varios cientos de KB). El Hub no agrega bundle porque sigue con emojis (no importa Iconoir).

- **Paridad i18n preservada.** Las 7 keys nuevas (4 group labels + 3 item names) se agregan a los 6 locales en una sola sesión (S3), `scripts/check-translations.mjs` confirma 0 missing / 0 extras.

- **El roadmap del producto se vuelve más visible al owner.** Los 8 items disabled con badge "Próximamente" funcionan como afordancia del roadmap real — el owner ve el alcance del producto que viene sin tener que leer docs externos. Es información, no ruido (cada item lleva su rol semántico claro por agrupación).

- **Pattern reusable**: cualquier futuro slice de navegación (e.g. un `nav-admin` si entra zona admin, o el Hub cuando agregue DMs/Actividad) consume `sidebarGroups` con sus propios grupos. La separación shell ↔ slice se preserva (ADR-0023 §3, sin cambios).

- **Decisión de Iconoir aplica a todo el repo**, no sólo al settings. Si una feature futura (DMs UI, biblioteca UI, eventos UI) necesita iconos, se importa de `iconoir-react`. Sin discusión per-sesión.

- **Sin cambios en RLS, auth, pipeline de migraciones, schema DB.** Esta ADR es 100% de organización UI + dependencia externa.

- **Tests esperados**: +1-2 tests del AppShell (`sidebarGroups` con/sin labels) + +3-5 tests del NavPlaceLayout (4 grupos, 9 items, sólo Idioma activa, 8 disabled). Suite total: ~296 → ~302 tests.

## Detalle operativo canónico

- Estructura del sidebar V1.1: ver § Decisión punto 1.
- Sesiones que implementan el refactor: S0 (docs) · S1a (install + icon prop) · S1b (sidebarGroups) · S2 (nav-place + Iconoir) · S3 (i18n + page wire). Plan completo en `docs/features/settings/spec.md` § "Sidebar (mobile-first) — V1.1 agrupado".
- Tests del shell con grupos: `src/shared/ui/app-shell/__tests__/app-shell.test.tsx` (extensión en S1a + S1b).
- Tests del nav-place agrupado: `src/features/nav-place/__tests__/nav-place-layout.test.tsx` (refactor en S2).
- Tests del nav-hub: `src/features/nav-hub/__tests__/nav-hub-layout.test.tsx` (regresión en S1b — debe seguir verde).
- Verificación de paridad i18n post-S3: `node scripts/check-translations.mjs` → 6 locales con 0 missing / 0 extras vs `es.json`.

## Notas

- Cuando entren features de Zonas / Grupos / Tiers (Roadmap, sin ETA), cada una agregará su Server Action + Client Component dentro del slice `place-settings` (paralelo a `<LocaleSection>` para Idioma). El sidebar V1.1 deja el routing y la i18n preparados — sumar una nueva sección activa requiere sólo: (a) el slice de la feature, (b) cambiar el `activeKey` del item correspondiente y agregar su key al `NavPlaceActiveSection` union, (c) reemplazar el placeholder del settings page en su sub-ruta.

- La librería `iconoir-react` se trackea como dependencia del producto en `package.json`. Versionado pinneable; bumps mayores se evalúan por riesgo de cambio visual en iconos. No es deuda — es decisión transversal.

- Si en futuro el owner cambia de opinión y prefiere `lucide-react` o similar, la migración es factible (cada slice importa Icon components — un find/replace per-icon basta). Decisión documentada acá por si emerge la duda; por ahora, **Iconoir es canónica**.
