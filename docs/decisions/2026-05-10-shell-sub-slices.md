# Split de `features/shell` en sub-slices

**Fecha:** 2026-05-10
**Milestone:** Pre-requisito del rediseño de `/settings/*` desktop.
**Patrón base:** `docs/decisions/2026-05-08-sub-slice-cross-public.md`

## Contexto

`features/shell` acumuló 1382 LOC en 17 archivos no-test, agrupando 5 responsabilidades
distintas:

| Grupo                  | LOC | Cohesión                                    |
| ---------------------- | --- | ------------------------------------------- |
| A — Core shell         | 172 | UI orquestador, mounted desde layout        |
| B — Community switcher | 270 | Cambiar entre places del user               |
| C — Zone navigation    | 531 | Dots + swiper entre zones del place         |
| D — Zone FAB           | 174 | Floating action button para crear contenido |
| E — Settings nav       | 221 | Nav entre settings sub-pages                |

**Margen al cap 1500 LOC: 118.** Una próxima feature (settings desktop redesign agrega
~5 LOC + Frequently Accessed hub agrega más en sesiones futuras) lo empuja al límite.

Las 5 responsabilidades son cohesivamente independientes:

- Community switcher se monta solo en TopBar (1 consumer).
- Zone navigation vive solo en gated zone layout (1 consumer).
- Zone FAB vive solo en zonas root (1 consumer).
- Settings nav vive solo en settings layout (1 consumer).
- Cada uno tiene tests propios y domain isolated.

Splitearlo en sub-slices NO requiere cambiar la API pública (`features/shell/public.ts`
re-exporta), no toca consumers, y cada sub-slice queda <800 LOC (cap shared/módulo).

## Decisión

Splitear `features/shell` en 5 sub-slices internos:

```
features/shell/
├── public.ts              ← re-exports core + 4 sub-slices (backwards compat)
├── core/                  ← Grupo A
│   └── ui/...
├── community-switcher/    ← Grupo B
│   ├── ui/...
│   └── public.ts
├── zone-navigation/       ← Grupo C
│   ├── domain/...
│   ├── ui/...
│   └── public.ts
├── zone-fab/              ← Grupo D
│   ├── ui/...
│   └── public.ts
└── settings-nav/          ← Grupo E
    ├── domain/...
    ├── ui/...
    └── public.ts
```

**Patrón aplicado:** sub-slice cross-public (ADR `2026-05-08-sub-slice-cross-public.md`).
Cada sub-slice expone su propio `public.ts`; otros archivos pueden importar de
`@/features/shell/<sub>/public` directamente. El barrel raíz `features/shell/public.ts`
re-exporta para no romper consumers existentes que importan de `@/features/shell/public`.

**Boundary test:** `tests/boundaries.test.ts` ya valida sub-slice cross-public con regex
que acepta `^[a-z0-9-]+/public(\.ts)?$` y `^[a-z0-9-]+/public\.server(\.ts)?$`. No
requiere cambios al test.

## Alternativas consideradas

### A. Promover sub-grupos a slices hermanas top-level (`features/community-switcher/`, `features/zone-navigation/`, etc.)

Descartada por:

- 4 nuevos paths top-level inflan el árbol `features/`.
- "Shell" pierde valor conceptual como umbrella ("UI del chrome del app").
- Consumers necesitarían update de imports si se quieren tipear como `from '@/features/X/public'`.

Sub-slices internos preservan la noción de "shell" y son menos invasivos.

### B. No splitear, esperar a que un próximo cambio empuje al cap

Descartada por:

- Margen actual (118 LOC) es suficiente para HOY pero no para 2-3 sesiones futuras.
- Splitear bajo presión (cap excedido) es peor que splitear preventivamente.
- El próximo trabajo (settings desktop redesign) toca el sub-slice E (settings-nav)
  específicamente; mejor tenerlo aislado antes.

## Implementación

5 sub-sesiones (refactor mecánico, sin lógica nueva):

1. **SHELL-1** — ADR (este doc) + sub-slice `community-switcher/`
2. **SHELL-2** — sub-slice `zone-navigation/`
3. **SHELL-3** — sub-slice `zone-fab/`
4. **SHELL-4** — sub-slice `settings-nav/`
5. **SHELL-5** — `core/` cleanup + verificación final

Cada sub-sesión:

- MOVE de archivos del grupo a la nueva sub-carpeta.
- Crear `public.ts` del sub-slice.
- Update `features/shell/public.ts` para re-exportar desde el sub-slice.
- Update consumers internos si alguno importaba directamente del path viejo (preferir consumir vía `@/features/shell/public` o `@/features/shell/<sub>/public`).
- Tests existing siguen verde sin cambios funcionales.
- Boundary test sigue verde.
- Commit + push.

Plan completo: `docs/plans/2026-05-10-shell-sub-slices-split.md`.

## Tradeoffs aceptados

- **Tests no se reescriben.** Solo se mueven al nuevo path. Si después queremos sumar
  cobertura específica al sub-slice, sesión separada.
- **`features/shell/public.ts` queda como pure re-export.** No agrega valor además del
  backwards compat. Eventualmente podríamos migrar consumers a importar directamente
  del sub-slice public y deprecar el barrel raíz, pero NO ahora (ruido sin beneficio
  inmediato).
- **`core/` no es un sub-slice formal.** No tiene `public.ts` propio porque sus exports
  son lo que `features/shell/public.ts` exporta como API raíz. Si en el futuro core
  crece, evaluamos darle `public.ts` también.

## Cómo verificarlo

Tras SHELL-5:

```sh
find src/features/shell -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | xargs wc -l
```

Esperado: cada sub-slice <800 LOC, total ~1380 LOC distribuido. `features/shell/public.ts`
re-exporta todo lo que exportaba antes — `pnpm typecheck` confirma que ningún consumer
se rompió.
