# Plan — Split de `features/shell` en sub-slices

**Fecha:** 2026-05-10
**Pre-requisito de:** `docs/plans/2026-05-10-settings-desktop-redesign.md`
**Patrón canonizado en:** `docs/decisions/2026-05-08-sub-slice-cross-public.md`

## Context

`features/shell` está en **1382 LOC sin tests** (cap 1500, margen 118 LOC). Antes de
empezar el plan de settings desktop (que agrega ~5 LOC al shell + abre la puerta a
expansiones futuras), splitearlo en sub-slices para liberar margen y mejorar
mantenibilidad.

**Audit del estado actual:**

| Grupo                  | LOC      | Archivos                                                       | Cohesión                                    |
| ---------------------- | -------- | -------------------------------------------------------------- | ------------------------------------------- |
| A — Core shell         | 172      | app-shell, top-bar, shell-chrome, search-trigger               | UI orquestador, mounted desde layout        |
| B — Community switcher | 270      | community-switcher, community-row                              | Cambiar entre places del user               |
| C — Zone navigation    | 531      | zone-swiper, swiper-viewport, swiper-snap, section-dots, zones | Dots + swiper entre zones del place         |
| D — Zone FAB           | 174      | zone-fab, zone-fab-client                                      | Floating action button para crear contenido |
| E — Settings nav       | 221      | settings-nav-fab, settings-trigger, settings-sections          | Nav entre settings sub-pages                |
| **Total**              | **1382** | **17**                                                         | —                                           |

**Outcome:** después del split, `features/shell/` queda como umbrella con sub-slices
independientes:

```
features/shell/
├── public.ts              ← re-exports core + sub-slices (backwards compat)
├── core/                  ← Grupo A (~172 LOC)
│   └── ui/...
├── community-switcher/    ← Grupo B (~270 LOC)
│   ├── ui/...
│   └── public.ts
├── zone-navigation/       ← Grupo C (~531 LOC)
│   ├── domain/...
│   ├── ui/...
│   └── public.ts
├── zone-fab/              ← Grupo D (~174 LOC)
│   ├── ui/...
│   └── public.ts
└── settings-nav/          ← Grupo E (~221 LOC)
    ├── domain/...
    ├── ui/...
    └── public.ts
```

Cada sub-slice queda <800 LOC (cap shared/módulo) y la feature root queda fragmentada
en piezas auditables. Si alguno crece, fácil mover a top-level.

## Sub-sesiones

Total: **5 sub-sesiones**, ~4h. Cada una independiente y deployable sola.

### SHELL-1 — ADR + sub-slice `community-switcher/`

**Goal:** documentar la decisión + extraer el primer sub-slice (el menos riesgoso, sin domain).

**Files:**

- **NEW** `docs/decisions/2026-05-10-shell-sub-slices.md` (~80 LOC) — ADR:
  - Contexto: shell en 1382/1500 LOC.
  - Decisión: split en 5 sub-slices (core + 4 sub-slices feature).
  - Patrón: sub-slice cross-public (ADR `2026-05-08`).
  - Backwards compat: `features/shell/public.ts` re-exporta para no romper consumers.
  - Plan de implementación: 5 sub-sesiones (este plan).
- **MOVE** `src/features/shell/ui/community-switcher.tsx` → `src/features/shell/community-switcher/ui/community-switcher.tsx`
- **MOVE** `src/features/shell/ui/community-row.tsx` → `src/features/shell/community-switcher/ui/community-row.tsx`
- **MOVE** tests análogos.
- **NEW** `src/features/shell/community-switcher/public.ts` (~10 LOC) — exports.
- `src/features/shell/public.ts` — re-export desde sub-slice (mantiene API pública igual).
- Update consumers internos: si `app-shell.tsx` o algún otro file importaba directamente de `./ui/community-switcher`, ajustar al nuevo path.
- Boundary test sigue verde.

**Verificación:** `pnpm typecheck` + suite verde. Sin cambios funcionales.

**LOC delta:** ~+90 (ADR + public.ts; el resto son moves sin cambios). Shell pasa 1382 → 1112 net.

**Riesgo deploy:** bajo (refactor mecánico, sin lógica nueva).

**Commit final:** `refactor(shell): community-switcher sub-slice + ADR` + push.

---

### SHELL-2 — Sub-slice `zone-navigation/`

**Goal:** extraer el sub-slice más voluminoso (531 LOC con domain + UI).

**Files:**

- **MOVE** `src/features/shell/ui/zone-swiper.tsx` → `src/features/shell/zone-navigation/ui/`
- **MOVE** `src/features/shell/ui/swiper-viewport.tsx` → `src/features/shell/zone-navigation/ui/`
- **MOVE** `src/features/shell/ui/section-dots.tsx` → `src/features/shell/zone-navigation/ui/`
- **MOVE** `src/features/shell/domain/swiper-snap.ts` → `src/features/shell/zone-navigation/domain/`
- **MOVE** `src/features/shell/domain/zones.ts` → `src/features/shell/zone-navigation/domain/`
- **MOVE** tests análogos.
- **NEW** `src/features/shell/zone-navigation/public.ts` (~15 LOC) — exports `ZoneSwiper`, `ZONES`, `deriveActiveZone`, types.
- `src/features/shell/public.ts` — re-export desde sub-slice.
- Update consumers internos.

**Verificación:** typecheck + suite verde.

**LOC delta:** ~+15. Shell pasa 1112 → 596 net.

**Riesgo deploy:** medio (zone navigation es muy usado en gated zone, regression risk).

**Commit final:** `refactor(shell): zone-navigation sub-slice` + push.

---

### SHELL-3 — Sub-slice `zone-fab/`

**Goal:** extraer el FAB de zonas (174 LOC).

**Files:**

- **MOVE** `src/features/shell/ui/zone-fab.tsx` → `src/features/shell/zone-fab/ui/zone-fab.tsx`
- **MOVE** `src/features/shell/ui/zone-fab-client.tsx` → `src/features/shell/zone-fab/ui/zone-fab-client.tsx`
- **MOVE** tests análogos.
- **NEW** `src/features/shell/zone-fab/public.ts` (~10 LOC).
- `src/features/shell/public.ts` — re-export.

**Verificación:** typecheck + suite verde.

**LOC delta:** ~+10. Shell pasa 596 → 432 net.

**Riesgo deploy:** bajo.

**Commit final:** `refactor(shell): zone-fab sub-slice` + push.

---

### SHELL-4 — Sub-slice `settings-nav/`

**Goal:** extraer settings nav (221 LOC). **Importante:** próximas sesiones del plan
settings desktop (1c y 6) van a tocar este sub-slice; mejor extraerlo antes para
tocar área limpia.

**Files:**

- **MOVE** `src/features/shell/ui/settings-nav-fab.tsx` → `src/features/shell/settings-nav/ui/`
- **MOVE** `src/features/shell/ui/settings-trigger.tsx` → `src/features/shell/settings-nav/ui/`
- **MOVE** `src/features/shell/domain/settings-sections.ts` → `src/features/shell/settings-nav/domain/`
- **MOVE** tests análogos.
- **NEW** `src/features/shell/settings-nav/public.ts` (~10 LOC) — exports `SettingsNavFab`, `SettingsTrigger`, `SETTINGS_SECTIONS` (si aplica).
- `src/features/shell/public.ts` — re-export.

**Verificación:** typecheck + suite verde.

**LOC delta:** ~+10. Shell pasa 432 → 221 net.

**Riesgo deploy:** medio (settings layout consume `SettingsNavFab`).

**Commit final:** `refactor(shell): settings-nav sub-slice` + push.

---

### SHELL-5 — Cleanup `features/shell/core/` + verificación final

**Goal:** mover lo que queda en `features/shell/ui/` raíz a `features/shell/core/ui/`,
verificar LOC final, actualizar docs.

**Files:**

- **MOVE** `src/features/shell/ui/app-shell.tsx` → `src/features/shell/core/ui/app-shell.tsx`
- **MOVE** `src/features/shell/ui/top-bar.tsx` → `src/features/shell/core/ui/top-bar.tsx`
- **MOVE** `src/features/shell/ui/shell-chrome.tsx` → `src/features/shell/core/ui/shell-chrome.tsx`
- **MOVE** `src/features/shell/ui/search-trigger.tsx` → `src/features/shell/core/ui/search-trigger.tsx`
- **MOVE** tests análogos.
- `src/features/shell/public.ts` — final shape: re-exports desde core/ + 4 sub-slices.
- Update `docs/architecture.md` § "Estructura de directorios" si aplica (mencionar patrón sub-slice como canonizado).

**Verificación:**

- `pnpm typecheck` + suite verde.
- `find src/features/shell -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | xargs wc -l` confirma LOC distribution.
- LOC esperado por sub-slice: core ~172, community-switcher ~270, zone-navigation ~531, zone-fab ~174, settings-nav ~221. **Cada uno bien bajo cap 1500.** Cap shared/módulo 800 también respetado por todos.

**LOC delta:** ~+10. Shell core en `features/shell/core/` queda ~172 LOC.

**Riesgo deploy:** bajo (mecánico).

**Commit final:** `refactor(shell): core sub-slice + final cleanup` + push.

---

## Resumen total

| Sub-sesión                            | LOC delta | Riesgo | Tiempo     |
| ------------------------------------- | --------- | ------ | ---------- |
| SHELL-1 — ADR + community-switcher    | +90       | Bajo   | 1h         |
| SHELL-2 — zone-navigation             | +15       | Medio  | 1h         |
| SHELL-3 — zone-fab                    | +10       | Bajo   | 30min      |
| SHELL-4 — settings-nav                | +10       | Medio  | 45min      |
| SHELL-5 — core cleanup + verificación | +10       | Bajo   | 30min      |
| **Total**                             | **+135**  | —      | **~3.75h** |

**Cumplimiento CLAUDE.md / architecture.md:**

- ✅ Una sesión = una cosa: cada sub-sesión extrae UN sub-slice.
- ✅ LOC: archivo más grande post-split es `community-switcher.tsx` con 167 LOC (cap 300).
- ✅ Vertical slices: cada sub-slice tiene su propio `public.ts`, sin imports cross-sub.
- ✅ Backwards compat: `features/shell/public.ts` mantiene API pública intacta — consumers no se enteran.
- ✅ TDD: tests existing siguen verde sin modificación funcional.
- ✅ Idioma: ADR + comentarios en español, código en inglés.

**Reglas de trabajo agente:**

- Sin sub-agentes (refactor mecánico, fácil de seguir en thread).
- Commit local antes de empezar cada sub-sesión.
- Tests verdes antes de push.
- No revertir cambios anteriores.
- Si un sub-slice se rompe (e.g. import path olvidado), revertir SOLO ese commit y rehacer.

## Pre-requisito antes de empezar

Verificar que NO hay trabajo en progreso (`git status` clean) — sino primero commit/stash el WIP.

## Después del split

Continuar con `docs/plans/2026-05-10-settings-desktop-redesign.md` — Sesión 1 (Sub-sesiones 1a, 1b, 1c).
